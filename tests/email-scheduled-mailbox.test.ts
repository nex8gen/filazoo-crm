import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("scheduled mail requires an authorized account and returns only that account's own queue", async () => {
  const rows = [
    { id: "personal", user_id: "viewer", status: "scheduled", payload: { mailboxId: "mine" } },
    { id: "team", user_id: "viewer", status: "uncertain", payload: { mailboxId: "team" } },
    { id: "other-user", user_id: "someone-else", status: "scheduled", payload: { mailboxId: "team" } },
    { id: "unbound", user_id: "viewer", status: "scheduled", payload: {} },
  ];
  let queries = 0;
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "viewer" }) },
    "@/lib/data/mailboxes": { getViewerMailbox: async (_user: string, id: string) => ["mine", "team"].includes(id) ? { id } : null },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from() {
      queries++;
      const filters: Array<(row: typeof rows[number]) => boolean> = [];
      const query = {
        select: () => query,
        eq(key: string, value: unknown) { filters.push(row => (key === "payload->>mailboxId" ? (row.payload as { mailboxId?: string }).mailboxId : row[key as keyof typeof row]) === value); return query; },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key as keyof typeof row])); return query; },
        order: () => query,
        limit: async () => ({ data: rows.filter(row => filters.every(filter => filter(row))), error: null }),
      };
      return query;
    } }) },
  };
  const api = {} as { GET(request: Request): Promise<Response> };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/email/scheduled/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: api, require: (name: string) => dependencies[name], Response, URL });
  for (const suffix of ["", "?mailboxId=someone-else", "?mailboxId=removed"]) assert.equal((await api.GET(new Request(`https://crm.test/api/email/scheduled${suffix}`))).status, 404);
  assert.equal(queries, 0);
  for (const [mailbox, expected] of [["mine", "personal"], ["team", "team"]]) {
    const response = await api.GET(new Request(`https://crm.test/api/email/scheduled?mailboxId=${mailbox}`));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).emails.map((row: { id: string }) => row.id), [expected]);
  }
});
