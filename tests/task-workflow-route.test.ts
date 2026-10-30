import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as workflows from "../lib/task-workflows.ts";
const require = createRequire(import.meta.url);
const id = "a1111111-1111-4111-8111-111111111111";
function app(role: string | null = "admin") {
  const calls: unknown[][] = [];
  let unavailable = false;
  const exports = {} as { GET: (request: Request, context: unknown) => Promise<Response>; POST: (request: Request, context: unknown) => Promise<Response> };
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { getWorkspaceViewer: async () => role ? { id, role } : null },
    "@/lib/task-workflows": workflows,
    "@/lib/mailbox-imap": { withMailboxSyncSessions: async (run: () => Promise<unknown>) => run() },
    "@/lib/data/task-workflows": { taskWorkflowDetail: async (...args: unknown[]) => { calls.push(args); if (unavailable) throw new Error("private database details"); return { workflow: { task_id: id } }; } },
    "@/lib/data/task-workflow-execution": { executeTaskWorkflow: async (...args: unknown[]) => { calls.push(args); return { workflow: { task_id: id } }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/tasks/[id]/work/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Request, Response, URL, Error, console: { error() {} } });
  const context = { params: Promise.resolve({ id }) };
  const req = (body?: unknown, origin = "https://crm.example") => new Request(`https://crm.example/api/tasks/${id}/work`, { method: body ? "POST" : "GET", headers: { origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { calls, read: () => exports.GET(req(), context), write: (body: unknown, origin?: string) => exports.POST(req(body, origin), context), fail: () => { unavailable = true; } };
}

test("task work is authenticated, private and rejects cross-origin or read-only writes", async () => {
  const anonymous = app(null);
  assert.equal((await anonymous.read()).status, 401);
  assert.equal((await anonymous.write({ action: "prepare", revision: 1 })).status, 401);
  const viewer = app("viewer");
  assert.equal((await viewer.write({ action: "send", revision: 1 })).status, 403);
  assert.equal(viewer.calls.length, 0);
  const admin = app();
  assert.equal((await admin.write({ action: "send", revision: 1 }, "https://attacker.invalid")).status, 403);
  assert.equal(admin.calls.length, 0);
  const result = await admin.read();
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  admin.fail();
  const failed = await admin.read();
  assert.equal(failed.status, 404); assert.doesNotMatch(JSON.stringify(await failed.json()), /private database/);
});

test("only validated task actions reach execution with current invoice revisions and explicit issue choice", async () => {
  const admin = app();
  for (const body of [{ action: "send", revision: 1, to: "attacker@example.com" }, { action: "send" }, { action: "save_shipping", revision: 1, invoiceRevision: 1, shippingMinor: -1 }]) assert.equal((await admin.write(body)).status, 400);
  assert.equal(admin.calls.length, 0);
  assert.equal((await admin.write({ action: "send", revision: 7, invoiceRevision: 3, issue: false })).status, 200);
  assert.deepEqual(admin.calls[0][2], { action: "send", revision: 7, invoiceRevision: 3, issue: false });
});
