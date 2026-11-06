import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve("tmp/agent-soak-20261105");
if (!existsSync(resolve(directory, "progress.json"))) {
  console.log("The 24-hour agent evaluation has not started.");
  process.exit(0);
}
const progress = JSON.parse(readFileSync(resolve(directory, "progress.json"), "utf8"));
const budget = JSON.parse(readFileSync(resolve(directory, "budget.json"), "utf8"));
let workerAlive = false;
if (existsSync(resolve(directory, "worker.lock"))) {
  const pid = Number(readFileSync(resolve(directory, "worker.lock"), "utf8"));
  try { process.kill(pid, 0); workerAlive = true; } catch (error) { workerAlive = error.code === "ESRCH" ? false : "unknown: process access restricted"; }
}
const usedMicros = budget.chargedMicros + Object.values(budget.pending).reduce((sum, value) => sum + value, 0);
const format = timestamp => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "long", timeZone: "Asia/Shanghai" }).format(timestamp);
const rows = existsSync(resolve(directory, "results.jsonl")) ? readFileSync(resolve(directory, "results.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
const current = rows.filter(row => row.suiteVersion === progress.suiteVersion && !row.repair && !row.skippedReason);
const latest = new Map(current.map(row => [`${row.model}:${row.case}`, row]));
console.log(JSON.stringify({
  workerAlive, pid: progress.pid, status: progress.status, timezone: "Asia/Shanghai",
  heartbeatAt: progress.updatedAt,
  startedAt: format(budget.startedAt), endsAt: format(budget.endsAt),
  enforcedMaximumUsd: budget.limitMicros / 1e6, conservativeChargedUsd: budget.chargedMicros / 1e6,
  chargedPlusOutstandingUsd: usedMicros / 1e6, remainingUsd: Math.max(0, budget.limitMicros - usedMicros) / 1e6,
  providerCalls: budget.calls, originalPassed: progress.passed, originalFailed: progress.failed,
  coachedRecoveries: progress.recovered, offlineRuns: progress.offlineRuns, offlineFailures: progress.offlineFailures,
  coverage: [...new Set(rows.filter(row => !row.repair).map(row => `${row.model}:${row.case}`))].length,
  currentSuite: progress.suiteVersion, currentSuitePassed: current.filter(row => row.passed).length, currentSuiteFailed: current.filter(row => !row.passed).length,
  latestCovered: latest.size, latestPassed: [...latest.values()].filter(row => row.passed).length, latestFailed: [...latest.values()].filter(row => !row.passed).length,
  originalFailures: current.filter(row => !row.passed).map(row => ({ case: row.case, model: row.model, reasons: row.reasons })),
  evidence: directory,
}, null, 2));
