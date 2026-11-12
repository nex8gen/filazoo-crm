// Read-only parity and timing checks. No sessions or fixtures are created.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-document-library-performance.ts
import assert from "node:assert/strict";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { bootstrapDocumentLibrary, listDocuments } from "../lib/data/documents.ts";
import { filterDocumentLibrary } from "../lib/document-library-filter.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

const { data: workspace } = await createSupabaseControl().from("workspaces").select("id,owner_id").eq("is_legacy", true).single().throwOnError();
assert.ok(workspace);
const viewer = { workspaceId: workspace.id, id: workspace.owner_id, role: "admin" } as WorkspaceViewer;
const start = performance.now();
const seed = await bootstrapDocumentLibrary(viewer, new URLSearchParams("view=all&sort=newest"));
console.log(JSON.stringify({ bootstrapMs: Math.round(performance.now() - start), items: seed.total, localCollection: !!seed.collection }));
if (seed.collection) {
  const queries = ["view=all", "category=quotation", "view=templates", "view=starred", "view=trash", "type=pdf", "type=document", "view=recent", "q=PLA", "company=king", "after=2026-11-01&before=2026-11-12"];
  for (const query of queries) {
    const params = new URLSearchParams(query);
    const remote = await listDocuments(viewer, params);
    const local = filterDocumentLibrary(seed.collection, params);
    assert.equal(local.total, remote.total, query);
    assert.deepEqual(local.documents.map(item => item.id), remote.documents.map(item => item.id), query);
    assert.deepEqual(local.stats, remote.stats, query);
  }
  const localStart = performance.now();
  for (let index = 0; index < 1000; index++) filterDocumentLibrary(seed.collection, new URLSearchParams(queries[index % queries.length]));
  console.log(JSON.stringify({ parityQueries: queries.length, averageFilterMs: Number(((performance.now() - localStart) / 1000).toFixed(3)) }));
}
