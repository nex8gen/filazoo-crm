import test from "node:test";
import assert from "node:assert/strict";
import { readResearchResponse, researchStreamType, withResearchProgress, type ResearchProgress } from "../lib/ai/research-progress.ts";

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
