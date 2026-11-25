import test from "node:test";
import assert from "node:assert/strict";
import { readResearchResponse, researchStreamType, withResearchProgress, type ResearchProgress, type AssistantActivity } from "../lib/ai/research-progress.ts";

const source = { id: "W1", label: "Official site", url: "https://3dnearyou.com/", recordedAt: "2026-11-06T08:00:00Z" };
const progress: ResearchProgress = { phase: "reading", sources: [source], queries: ['"3D Near You"'], visitedUrls: [] };
const req = () => new Request("https://crm.test/api/ai/assistant", { headers: { Accept: researchStreamType } });

test("source progress reaches the client before final answer generation completes", async () => {
  let finish: () => void = () => {};
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let answerComplete = false;
  const response = await withResearchProgress(req(), async report => {
    report(progress);
    await finished; answerComplete = true;
    return Response.json({ output: "They sell filament [W1].", research: { sources: [source] } });
  });
  assert.equal(answerComplete, false);
  const seen: ResearchProgress[] = [];
  const result = readResearchResponse<{ output: string }>(response, update => { seen.push(update); finish(); });
  assert.match((await result).output, /\[W1\]/);
  assert.deepEqual(seen, [progress]);
  assert.equal(answerComplete, true);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
});

test("authentication errors and old JSON clients retain their original HTTP status and body", async () => {
  const denied = await withResearchProgress(req(), async () => Response.json({ error: "Sign in" }, { status: 401 }));
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "Sign in" });
  const json = await withResearchProgress(new Request("https://crm.test"), async report => { report(progress); return Response.json({ output: "Saved reply" }); });
  assert.match(json.headers.get("content-type")!, /application\/json/);
  assert.deepEqual(await readResearchResponse(json, () => assert.fail("No fabricated progress")), { output: "Saved reply" });
});

test("stream errors and unfinished answers cannot masquerade as successful replies", async () => {
  const response = await withResearchProgress(req(), async report => { report(progress); return Response.json({ error: "Provider unavailable" }, { status: 502 }); });
  await assert.rejects(readResearchResponse(response, () => {}), /Provider unavailable/);
  const truncated = new Response(JSON.stringify({ type: "progress", progress }) + "\n", { headers: { "Content-Type": researchStreamType } });
  await assert.rejects(readResearchResponse(truncated, () => {}), /before the answer was complete/);
});

test("split UTF-8 chunks preserve source titles and the final answer", async () => {
  const wire = new TextEncoder().encode(JSON.stringify({ type: "progress", progress: { ...progress, sources: [{ ...source, label: "公司网站" }] } }) + "\n" + JSON.stringify({ type: "result", status: 200, data: { output: "已核实 [W1]" } }));
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of wire) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { "Content-Type": researchStreamType } });
  const seen: ResearchProgress[] = [];
  assert.deepEqual(await readResearchResponse(response, update => seen.push(update)), { output: "已核实 [W1]" });
  assert.equal(seen[0].sources[0].label, "公司网站");
});

test("closing the browser stream does not turn final research completion into an unhandled failure", async () => {
  let finish: () => void = () => {};
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const response = await withResearchProgress(req(), async report => { report(progress); await finished; report({ ...progress, phase: "writing" }); return Response.json({ output: "Complete" }); });
  await response.body!.cancel(); finish();
  await finished;
});

test("ordinary chat exposes the active work before the provider finishes and retains completed stages", async () => {
  let finish: () => void = () => {};
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let finished = false;
  const response = await withResearchProgress(req(), async (_report, track, activity) => {
    await track("Loading workspace context", async () => ({ loaded: true }));
    const output = await track("Preparing your answer", async () => { await waiting; finished = true; return "Answer"; });
    return Response.json({ output, activity });
  });
  const seen: AssistantActivity[][] = [];
  const result = await readResearchResponse<{ output: string; activity: AssistantActivity[] }>(response, () => assert.fail("Chat must not invent web research"), steps => {
    seen.push(steps);
    if (steps.some(step => step.label === "Preparing your answer" && step.status === "active")) {
      assert.equal(finished, false);
      finish();
    }
  });
  assert.equal(result.output, "Answer");
  assert.deepEqual(seen.at(-1)?.map(step => step.status), ["complete", "complete"]);
  assert.deepEqual(result.activity.map(step => step.label), ["Loading workspace context", "Preparing your answer"]);
  assert.ok(result.activity.every(step => typeof step.durationMs === "number"));
});

test("parallel record lookups keep independent statuses and failures never expose internal exception text", async () => {
  let finish: () => void = () => {};
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  const response = await withResearchProgress(req(), async (_report, track) => {
    await Promise.allSettled([
      track("Looking up saved records", async () => { await waiting; return []; }, "companies"),
      track("Looking up saved records", async () => { throw new Error("PRIVATE_DATABASE_ERROR"); }, "products"),
    ]);
    return Response.json({ error: "Unable to load records" }, { status: 503 });
  });
  const seen: AssistantActivity[][] = [];
  await assert.rejects(readResearchResponse(response, () => {}, steps => {
    seen.push(steps);
    if (steps.some(step => step.status === "failed")) finish();
  }), /Unable to load records/);
  assert.equal(new Set(seen.at(-1)?.map(step => step.id)).size, 2);
  assert.deepEqual(seen.at(-1)?.map(step => step.status), ["complete", "failed"]);
  assert.doesNotMatch(JSON.stringify(seen), /PRIVATE_DATABASE_ERROR/);
});

test("web research adds real search and reading stages without duplicating phase updates", async () => {
  const response = await withResearchProgress(req(), async report => {
    report({ ...progress, phase: "searching" });
    report({ ...progress, phase: "searching", queries: ["Another query"] });
    report(progress);
    report({ ...progress, phase: "writing" });
    return Response.json({ output: "Answer" });
  });
  let latest: AssistantActivity[] = [];
  await readResearchResponse(response, () => {}, steps => { latest = steps; });
  assert.deepEqual(latest.map(step => step.label), ["Searching the web", "Reading company websites"]);
  assert.equal(latest[0].detail, "Another query");
  assert.ok(latest.every(step => step.status === "complete"));
});
