// Read-only database probe, not an authenticated browser or full CRM load test.
// node --env-file=.env.local --experimental-strip-types scripts/probe-inbox-concurrency.ts --project <ref>
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createMailboxSnapshotReader } from "../lib/mailbox-snapshot-reader.ts";
import { fetchRead } from "../lib/supabase/read-fetch.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const projectIndex = process.argv.indexOf("--project");
const expectedProject = projectIndex >= 0 ? process.argv[projectIndex + 1] : undefined;
assert.ok(url && secret && expectedProject, "Set server credentials and pass the intended --project ref.");
assert.equal(new URL(url).hostname, `${expectedProject}.supabase.co`, "The configured database does not match the intended project.");
let reads = 0, fullPayloadReads = 0;
const readOnlyFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  assert.ok(["GET", "HEAD"].includes(method), "This probe cannot write records or invoke RPCs.");
  reads++;
  const requestUrl = new URL(input instanceof Request ? input.url : String(input));
  if (requestUrl.searchParams.get("select")?.split(",").includes("messages")) fullPayloadReads++;
  return fetchRead(input, init, fetch);
};
const client = (headers: Record<string, string>) => createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false },
  global: { headers, fetch: readOnlyFetch },
});
const { data: workspaces } = await client({ "x-crm-control": "1" }).from("workspaces").select("id").order("created_at").throwOnError();
let checked = false;
for (const workspace of workspaces ?? []) {
  const db = client({ "x-crm-workspace-id": workspace.id });
  const { data: snapshots } = await db.from("mailbox_sync_state").select("mailbox_key")
    .not("synced_at", "is", null).order("mailbox_key").limit(1).throwOnError();
  if (!snapshots?.length) continue;
  const read = createMailboxSnapshotReader();
  for (const phase of ["cold", "warm"]) {
    const before = { reads, fullPayloadReads };
    const start = performance.now();
    const timings = await Promise.all(Array.from({ length: 30 }, async () => {
      const started = performance.now();
      const rows = await read(db, [snapshots[0].mailbox_key], AbortSignal.timeout(15_000));
      assert.equal(rows.length, 1);
      assert.ok(rows[0].messages.length > 0, "A populated saved mailbox is required.");
      return performance.now() - started;
    }));
    timings.sort((a, b) => a - b);
    console.log(JSON.stringify({ phase, concurrentReaders: 30, successes: timings.length,
      totalMs: Math.round(performance.now() - start), medianMs: Math.round(timings[14]), p95Ms: Math.round(timings[28]), maxMs: Math.round(timings[29]),
      databaseReads: reads - before.reads, fullPayloadReads: fullPayloadReads - before.fullPayloadReads }));
  }
  checked = true;
  break;
}
assert.ok(checked, "No populated saved mailbox was available.");
