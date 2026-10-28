import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { segmentInputSchema } from "../lib/segments.ts";

const companyId = "a1111111-1111-4111-8111-111111111111";
const segmentId = "b2222222-2222-4222-8222-222222222222";
function fixture(role = "operator", error: { code: string } | null = null) {
  const writes: unknown[] = [];
  const paths: string[] = [];
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "zod": { z },
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Access denied"); return { id: "actor", role }; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: (table: string) => ({
      select: () => ({ in: (_key: string, ids: string[]) => ({ or: async () => ({ data: ids.filter((id) => id === companyId).map((id) => ({ id })), error: null }) }) }),
      insert: async (row: unknown) => { writes.push({ table, row }); return { error }; },
      update: (row: unknown) => ({ eq: (_key: string, id: string) => ({ select: () => ({ maybeSingle: async () => { writes.push({ table, row, id }); return { error, data: id === segmentId && !error ? { id } : null }; } }) }) }),
    }) }) },
    "@/lib/segments": { segmentInputSchema },
  };
  const source = ts.transpileModule(readFileSync(new URL("../app/segment-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; } });
  return { createSegment: exports.createSegment as typeof import("../app/segment-actions.ts").createSegment, updateSegment: exports.updateSegment as typeof import("../app/segment-actions.ts").updateSegment, writes, paths };
}

function form(rules = '{"hasEmail":false,"minFitScore":7}') {
  const data = new FormData();
  data.set("name", "  Focused audience  ");
  data.set("description", "  Follow-up prospects  ");
  data.set("rules", rules);
  data.set("created_by", "forged-actor");
  return data;
}

test("segment creation rejects viewers before writing and attributes valid writes to the current member", async () => {
  const viewer = fixture("viewer");
  await assert.rejects(() => viewer.createSegment({}, form()), /Access denied/);
  assert.equal(viewer.writes.length, 0);
  for (const role of ["admin", "operator", "bd_manager"]) {
    const writer = fixture(role);
    const result = await writer.createSegment({}, form());
    assert.equal(result.success, "Segment created.");
    assert.equal(JSON.stringify(writer.writes), JSON.stringify([{ table: "company_segments", row: { name: "Focused audience", description: "Follow-up prospects", rules: { minFitScore: 7, hasEmail: false }, created_by: "actor" } }]));
    assert.deepEqual(writer.paths, ["/segments"]);
  }
});

test("malformed or unsupported audience rules never reach the database", async () => {
  for (const rules of ["not json", "null", '{"minFitScore":20}', '{"hasEmail":"false"}', '{"country":""}', '{"unknown":"value"}']) {
    const action = fixture();
    assert.ok((await action.createSegment({}, form(rules))).error);
    assert.equal(action.writes.length, 0);
    assert.equal(action.paths.length, 0);
  }
});

test("failed saves do not announce success or revalidate, and duplicate names give an actionable error", async () => {
  const duplicate = fixture("admin", { code: "23505" });
  assert.match((await duplicate.createSegment({}, form())).error ?? "", /already exists/);
  assert.equal(duplicate.paths.length, 0);
  const failed = fixture("operator", { code: "42501" });
  const result = await failed.createSegment({}, form());
  assert.equal(result.success, undefined);
  assert.match(result.error ?? "", /Unable to create/);
  assert.equal(failed.paths.length, 0);
});

test("manual creation saves exact company IDs and rejects unavailable companies", async () => {
  const action = fixture();
  assert.equal((await action.createSegment({}, form(JSON.stringify({ companyIds: [companyId] })))).success, "Segment created.");
  assert.match(JSON.stringify(action.writes), new RegExp(companyId));
  const stale = fixture();
  assert.match((await stale.createSegment({}, form(JSON.stringify({ companyIds: [segmentId] })))).error ?? "", /no longer available/);
  assert.equal(stale.writes.length, 0);
});

test("editing a segment can change individual membership and rechecks writer permissions", async () => {
  const data = form(JSON.stringify({ companyIds: [companyId] }));
  data.set("segmentId", segmentId);
  const action = fixture();
  assert.equal((await action.updateSegment({}, data)).success, "Segment updated.");
  assert.match(JSON.stringify(action.writes), new RegExp(segmentId));
  assert.equal(JSON.stringify(action.writes).includes("created_by"), false);
  assert.deepEqual(action.paths, ["/segments", "/companies"]);
  const viewer = fixture("viewer");
  await assert.rejects(() => viewer.updateSegment({}, data), /Access denied/);
  assert.equal(viewer.writes.length, 0);
  const invalid = fixture();
  data.set("segmentId", "invalid");
  assert.ok((await invalid.updateSegment({}, data)).error);
  assert.equal(invalid.writes.length, 0);
});
