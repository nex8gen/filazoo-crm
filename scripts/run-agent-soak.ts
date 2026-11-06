import { mkdirSync, openSync, closeSync, existsSync, readFileSync, unlinkSync, appendFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { evaluationBudget, evaluationRate, atomicEvaluationJson } from "../lib/ai/evaluation-budget.ts";
import { generateCrmPlan, nativeGatewayModels } from "../lib/ai/native-agent.ts";
import { conversationMemory, memoryPrompt } from "../lib/ai/chat-history.ts";
import { STANDARD_AI_MODEL, COMPLEX_AI_MODEL } from "../lib/ai/model-routing.ts";
import { agentCapabilities, AGENT_CONTRACT_VERSION } from "../lib/ai/capabilities.ts";
import { evaluationCases, checkEvaluation, syntheticServerData, syntheticRead, syntheticId, type EvaluationCase } from "./agent-evaluation-cases.ts";
import type { BudgetRate } from "../lib/ai/budget.ts";
import { aiTextEvaluationCases } from "./ai-text-evaluation-cases.ts";
import { generateGatewayText } from "../lib/ai/gateway.ts";

const directory = resolve("tmp/agent-soak-20261105");
const suiteVersion = "2026-11-06.2";
const scenarios = [...evaluationCases(), ...aiTextEvaluationCases()];
const models = [STANDARD_AI_MODEL, COMPLEX_AI_MODEL];
if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ live: false, durationHours: 24, userMaximumUsd: 5, enforcedMaximumUsd: 4.75, models, capabilities: agentCapabilities().length, cases: scenarios.map(value => ({ name: value.name, kind: value.kind })), directory }, null, 2));
  process.exit(0);
}
const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
if (!token) throw new Error("Gateway credentials are required for live evaluation.");
mkdirSync(directory, { recursive: true });
const lock = resolve(directory, "worker.lock");
// Recover only when the recorded owner has actually exited. Never run two budgets.
if (existsSync(lock)) {
  const owner = Number(readFileSync(lock, "utf8"));
  if (!Number.isSafeInteger(owner) || owner < 1) throw new Error("Invalid worker lock; inspect before resuming.");
  let alive = true;
  try { process.kill(owner, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw error; }
  if (alive) throw new Error("The evaluation worker is already running.");
  unlinkSync(lock);
}
const lockFd = openSync(lock, "wx");
appendFileSync(lockFd, String(process.pid)); closeSync(lockFd);
const budget = evaluationBudget(resolve(directory, "budget.json"));
const progressPath = resolve(directory, "progress.json");
const resultsPath = resolve(directory, "results.jsonl");
type Progress = { suiteVersion?: string; paidStopped?: boolean; averageCaseMicros?: number; pendingRechecks?: Array<{ case: string; model: string }>; contract: string; next: number; passed: number; failed: number; recovered: number; rounds: number; offlineRuns: number; offlineFailures: number; lastOfflineAt: number; lastOfflinePassed: boolean; nextRoundAt: number; lastResult?: unknown; status: string };
const progress: Progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : { contract: AGENT_CONTRACT_VERSION, next: 0, passed: 0, failed: 0, recovered: 0, rounds: 0, offlineRuns: 0, offlineFailures: 0, lastOfflineAt: 0, lastOfflinePassed: false, nextRoundAt: 0, status: "starting" };
if (progress.contract !== AGENT_CONTRACT_VERSION || !Number.isSafeInteger(progress.next) || progress.next < 0) throw new Error("Evaluation contract or progress changed; inspect before resuming.");
progress.paidStopped ||= budget.snapshot().halted;
if (process.argv.includes("--recheck-offline")) { progress.lastOfflineAt = 0; progress.lastOfflinePassed = false; }
progress.lastOfflineAt = 0; // Always verify the current source when resuming.
if (progress.suiteVersion !== suiteVersion) {
  appendFileSync(resolve(directory, "suite-revisions.jsonl"), JSON.stringify({ at: new Date().toISOString(), from: progress.suiteVersion ?? "initial-fixtures", to: suiteVersion, note: "Correct duplicate/new-customer and no-op-city fixtures; add scoped synthetic reads and live AI text cases. Retain all original evidence, costs and deadline." }) + "\n");
  progress.suiteVersion = suiteVersion; progress.next = 0; progress.lastOfflineAt = 0;
}
const manifestFiles = ["scripts/run-agent-soak.ts", "scripts/agent-evaluation-cases.ts", "scripts/ai-text-evaluation-cases.ts", "lib/ai/evaluation-budget.ts", "lib/ai/native-agent.ts", "lib/ai/request-context.ts", "lib/ai/workspace-assistant.ts", "lib/ai/capabilities.ts", "lib/ai/model-routing.ts", "lib/ai/email-reply.ts", "lib/task-workflows.ts", "lib/ai/gateway.ts"];
const runId = new Date().toISOString();
const manifestPath = resolve(directory, "manifest.json");
if (existsSync(manifestPath)) appendFileSync(resolve(directory, "manifests.jsonl"), JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) + "\n");
atomicEvaluationJson(manifestPath, { suiteVersion, runId, contract: AGENT_CONTRACT_VERSION, capturedAt: runId, files: Object.fromEntries(manifestFiles.map(path => [path, createHash("sha256").update(readFileSync(path)).digest("hex")])) });
if (process.argv.includes("--recheck-failures") && existsSync(resultsPath)) {
  const rows = readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const latest = new Map(rows.filter(row => row.suiteVersion === suiteVersion && !row.repair && !row.skippedReason).map(row => [`${row.model}:${row.case}`, row]));
  progress.pendingRechecks = [...latest.values()].filter(row => !row.passed).map(row => ({ case: row.case as string, model: row.model as string }));
}
let stopping = false;
process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });
const snapshot = () => atomicEvaluationJson(progressPath, { ...progress, updatedAt: new Date().toISOString(), pid: process.pid, budget: budget.snapshot() });
function report() {
  const rows = existsSync(resultsPath) ? readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const current = rows.filter(row => row.suiteVersion === suiteVersion);
  const baselines = current.filter(row => !row.repair && !row.skippedReason);
  const latest = new Map(baselines.map(row => [`${row.model}:${row.case}`, row]));
  const gaps = models.flatMap(model => scenarios.filter(scenario => !latest.has(`${model}:${scenario.name}`)).map(scenario => ({ model, case: scenario.name })));
  const failures = baselines.filter(row => !row.passed);
  atomicEvaluationJson(resolve(directory, "failure-replay.json"), { suiteVersion, failures: failures.map(row => ({ ...row, originalConversation: scenarios.find(scenario => scenario.name === row.case)?.messages })), warning: "Coached retries do not establish a production fix. Diagnose fixtures versus agent defects and verify changes with an uncoached rerun." });
  atomicEvaluationJson(resolve(directory, "report.json"), { suiteVersion, contract: AGENT_CONTRACT_VERSION, status: progress.status, updatedAt: new Date().toISOString(), syntheticOnly: true, models, expectedModelCases: models.length * scenarios.length, coveredModelCases: latest.size, latestPassed: [...latest.values()].filter(row => row.passed).length, latestFailed: [...latest.values()].filter(row => !row.passed).length, originalAttemptsPassed: baselines.filter(row => row.passed).length, originalAttemptsFailed: failures.length, coachedRecoveries: current.filter(row => row.repair && row.passed).length, gaps, failures: failures.map(row => ({ model: row.model, case: row.case, reasons: row.reasons })), budget: budget.snapshot(), offlineRuns: progress.offlineRuns, offlineFailures: progress.offlineFailures });
}
function offlineChecks() {
  const files = readdirSync("tests").filter(name => /^(agent-|ai-|native-agent|chat-history|chat-usage|quotation-selection|provider-credentials|evaluation-|request-context|research-).*\.test\.ts$/.test(name)).map(name => `tests/${name}`);
  const childEnv = { ...process.env };
  for (const name of Object.keys(childEnv)) if (/KEY|TOKEN|SECRET|PASSWORD|SUPABASE|DATABASE_URL/.test(name) || /^AI_GATEWAY_.*_MODEL$/.test(name)) delete childEnv[name];
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=2", ...files], { encoding: "utf8", timeout: 120_000, env: childEnv, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  appendFileSync(resolve(directory, "offline-tests.log"), `\n${new Date().toISOString()}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  progress.offlineRuns++; if (result.status !== 0) progress.offlineFailures++;
  progress.lastOfflineAt = Date.now();
  progress.lastOfflinePassed = result.status === 0;
  return result.status === 0;
}
let prices: { expires: number; values: Map<string, BudgetRate> } | undefined;
async function rateFor(model: string) {
  if (!prices || prices.expires <= Date.now()) {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { signal: AbortSignal.timeout(15_000), redirect: "error" });
    if (!response.ok) throw new Error("Current evaluation pricing unavailable.");
    const catalog = await response.json() as { data: Array<{ id: string } & Parameters<typeof evaluationRate>[0]> };
    prices = { expires: Date.now() + 60_000, values: new Map(catalog.data.filter(item => models.includes(item.id)).map(item => [item.id, evaluationRate(item)])) };
  }
  const rate = prices.values.get(model);
  if (!rate) throw new Error("Evaluation model is absent from current pricing.");
  return rate;
}
const guardedFetch = budget.fetch(rateFor);
async function evaluate(scenario: EvaluationCase, model: string, repair = false) {
  const startedAt = Date.now();
  const diagnostics: Array<{ kind: string; tools: string[]; message?: string }> = [];
  const data = syntheticServerData(scenario.inject);
  if (/request_customer_information|wait_for_customer_reply/.test(scenario.name)) data.emailHistory = [{ ...data.currentEmail, id: "synthetic-outbound", direction: "outbound", subject: "Artwork approval", body: "Please confirm your approval of the sample artwork." }];
  const memory = conversationMemory(scenario.messages);
  // Financial routing deliberately ignores an ordinary model hint. Pin both
  // tiers inside this isolated worker so reported qualification matches reality.
  process.env.AI_GATEWAY_STANDARD_MODEL = model;
  process.env.AI_GATEWAY_COMPLEX_MODEL = model;
  process.env.AI_GATEWAY_SIMPLE_MODEL = model;
  const modelOptions = await nativeGatewayModels({ token: token!, userId: syntheticId, userText: scenario.messages.map(value => value.content).join("\n"), model, fetcher: guardedFetch });
  if (modelOptions.model.modelId !== model || modelOptions.repairModel.modelId !== model) throw new Error("Evaluation model routing mismatch.");
  const run = (messages: EvaluationCase["messages"], expected?: unknown) => {
    const currentMemory = conversationMemory(messages);
    return generateCrmPlan({ ...modelOptions, messages: currentMemory.messages, prompt: JSON.stringify({ CONVERSATION: currentMemory.messages, SERVER_DATA: data }) + memoryPrompt(currentMemory.summary),
      onDiagnostic: event => { diagnostics.push(event); },
      ...(repair ? { behavior: `Evaluation correction: preserve the user's exact fields and document intent. Stage proposals only. The trusted expected action for this synthetic exercise is ${JSON.stringify(expected ?? scenario.expected)}. This correction applies to this test only.` } : {}),
      pathname: "/companies", language: "en", signal: AbortSignal.timeout(Math.max(1, Math.min(60_000, budget.snapshot().endsAt - Date.now()))),
      validateAction: action => { if (scenario.deny) throw new Error("Workspace policy denies this action."); if (JSON.stringify(action).includes("attacker@example.com")) throw new Error("Untrusted recipient."); },
      read: async input => syntheticRead(input, data, scenario.name),
      searchEmails: async input => {
        const records = input.emailId ? data.emailHistory.filter(email => email.id === input.emailId) : data.emailHistory;
        return { records, coverage: { included: records.length, nextOffset: null } };
      },
    });
  };
  try {
    if (scenario.text) {
      const output = await generateGatewayText({ token: token!, task: scenario.text.task, model, systemInstruction: scenario.text.instruction, prompt: scenario.text.prompt, responseJsonSchema: scenario.text.responseJsonSchema, maxOutputTokens: 1600, fetcher: guardedFetch, signal: AbortSignal.timeout(Math.max(1, Math.min(60_000, budget.snapshot().endsAt - Date.now()))) });
      const passed = scenario.text.check(output);
      return { at: new Date().toISOString(), case: scenario.name, kind: "ai-text", model, repair, passed, reasons: passed ? [] : ["AI text output failed its production parser or grounded behavior check."], output, elapsedMs: Date.now() - startedAt };
    }
    const plan = await run(scenario.messages);
    const reasons = checkEvaluation(plan, scenario);
    let followup;
    if (scenario.followup && !reasons.length) {
      const messages: EvaluationCase["messages"] = [...scenario.messages, { role: "assistant", content: JSON.stringify({ output: plan.output, proposals: plan.actions, status: "pending review, not executed" }) }, { role: "user", content: scenario.followup.content }];
      followup = await run(messages, scenario.followup.expected);
      reasons.push(...checkEvaluation(followup, { ...scenario, expected: scenario.followup.expected, followup: undefined }));
    }
    return { at: new Date().toISOString(), case: scenario.name, model, repair, passed: !reasons.length, reasons, plan, followup, diagnostics, elapsedMs: Date.now() - startedAt, historyMessages: scenario.messages.length, recentMessages: memory.messages.length, summaryChars: memory.summary.length };
  } catch (error) {
    return { at: new Date().toISOString(), case: scenario.name, model, repair, passed: false, reasons: [error instanceof Error ? `${error.name}: ${error.message.replace(/(?:sk-|vck_|eyJ)[A-Za-z0-9._-]+/g, "[redacted]").slice(0, 400)}` : "Evaluation request failed"], diagnostics, elapsedMs: Date.now() - startedAt };
  }
}
try {
  while (!stopping && Date.now() < budget.snapshot().endsAt) {
    if (existsSync(resolve(directory, "STOP"))) { progress.status = "stopped by STOP file"; break; }
    if (Date.now() - progress.lastOfflineAt >= 60 * 60 * 1000) {
      progress.status = "offline regression checks"; snapshot();
      if (!offlineChecks()) { progress.status = "offline checks failed; paid tests paused"; snapshot(); await delay(30_000); continue; }
    }
    if (!progress.lastOfflinePassed) { progress.status = "offline checks failed; paid tests paused"; snapshot(); await delay(30_000); continue; }
    if (progress.paidStopped) { progress.status = "paid tests stopped at budget limit; hourly offline checks continue"; snapshot(); await delay(30_000); continue; }
    // Initial complete coverage of both configured agent models, then four cases per 15 minutes.
    const baseline = progress.next < scenarios.length * models.length;
    if (!progress.pendingRechecks?.length && !baseline && Date.now() < progress.nextRoundAt) { progress.status = "waiting for next evaluation round"; snapshot(); await delay(Math.min(30_000, progress.nextRoundAt - Date.now())); continue; }
    progress.rounds++;
    for (let index = 0; index < (baseline ? 1 : 4) && !stopping && Date.now() < budget.snapshot().endsAt; index++) {
      if (existsSync(resolve(directory, "STOP"))) { stopping = true; break; }
      const recheck = progress.pendingRechecks?.[0];
      const scenario = recheck ? scenarios.find(value => value.name === recheck.case)! : scenarios[progress.next % scenarios.length];
      const model = recheck?.model ?? models[Math.floor(progress.next / scenarios.length) % models.length];
      if (!scenario || !models.includes(model)) throw new Error("Saved evaluation replay is invalid.");
      progress.status = `evaluating ${scenario.name}`; snapshot();
      const beforeCost = budget.snapshot().usedMicros;
      const result = await evaluate(scenario, model);
      const budgetBlocked = result.reasons.some(reason => /time or total cost limit reached/.test(reason));
      appendFileSync(resultsPath, JSON.stringify({ ...result, suiteVersion, runId, recheck: Boolean(recheck), ...(budgetBlocked ? { skippedReason: "total budget or deadline" } : {}) }) + "\n");
      if (budgetBlocked) { progress.paidStopped = true; progress.status = "paid tests stopped at budget limit; hourly offline checks continue"; snapshot(); report(); break; }
      if (result.passed) progress.passed++; else progress.failed++;
      if (!result.passed && !scenario.text && !/cost limit|pricing|credential|auth|401|403|connect|fetch failed/i.test(result.reasons.join(" "))) {
        const retry = await evaluate(scenario, model, true);
        appendFileSync(resultsPath, JSON.stringify({ ...retry, suiteVersion, runId }) + "\n");
        if (retry.passed) progress.recovered++;
      }
      if (recheck) progress.pendingRechecks!.shift(); else progress.next++;
      const caseCost = budget.snapshot().usedMicros - beforeCost;
      progress.averageCaseMicros = progress.averageCaseMicros ? Math.ceil(progress.averageCaseMicros * .8 + caseCost * .2) : caseCost;
      progress.lastResult = result;
      snapshot(); report();
      console.log(JSON.stringify({ at: result.at, case: result.case, model, passed: result.passed, usedUsd: budget.snapshot().usedMicros / 1e6, passedTotal: progress.passed, failedTotal: progress.failed, recovered: progress.recovered }));
      if (budget.snapshot().halted || result.reasons.some(reason => /cost limit/.test(reason))) {
        progress.paidStopped = true;
        progress.status = "paid tests stopped at budget limit; offline checks continue";
        progress.nextRoundAt = budget.snapshot().endsAt; snapshot(); break;
      }
    }
    if (!baseline && !progress.paidStopped) {
      const remainingTime = Math.max(0, budget.snapshot().endsAt - Date.now());
      const pacedInterval = Math.ceil(remainingTime * 4 * Math.max(1000, progress.averageCaseMicros ?? 30_000) * 1.25 / Math.max(1, budget.snapshot().remainingMicros));
      progress.nextRoundAt = Date.now() + Math.max(15 * 60 * 1000, Math.min(remainingTime, pacedInterval));
    }
  }
  if (Date.now() >= budget.snapshot().endsAt) progress.status = "completed 24-hour evaluation";
  else if (stopping) progress.status = "stopped; resume preserves budget and deadline";
  snapshot(); report();
} finally { unlinkSync(lock); }
