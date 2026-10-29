import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as productivity from "../lib/ai/crm-productivity.ts";
import * as activity from "../lib/task-activity.ts";

const require = createRequire(import.meta.url);
const id = "b2222222-2222-4222-8222-222222222222";
function fixture(role: string | null = "admin") {
  const writes: unknown[][] = [];
  let fail = false;
  const code = ts.transpileModule(readFileSync(new URL("../app/api/flows/activity/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as Record<"GET" | "POST" | "PATCH", (request: Request) => Promise<Response>>;
  const deps: Record<string, unknown> = {
    "@/lib/auth": { getWorkspaceViewer: async () => role ? { id, role } : null },
    "@/lib/task-activity": activity, "@/lib/ai/crm-productivity": productivity,
    "@/lib/data/flow-activity": { listFlowActivity: async (...args: unknown[]) => { if (fail) throw new Error("private database failure"); return { args }; }, updateFlowActivity: async (...args: unknown[]) => { writes.push(args); } },
    "@/lib/data/agent-tasks": { createAgentTask: async (...args: unknown[]) => { writes.push(args); return { id }; }, updateAgentTask: async (...args: unknown[]) => { writes.push(args); } },
  };
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name), URL, Request, Response, Error });
  return { ...exports, writes, fail() { fail = true; } };
}
function request(method: string, body?: unknown, origin = "https://crm.example.com") {
  return new Request("https://crm.example.com/api/flows/activity", { method, headers: { origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test("activity API returns JSON auth failures, rejects cross-origin writes and protects read-only users", async () => {
  const anonymous = fixture(null);
  for (const method of ["GET", "POST", "PATCH"] as const) assert.equal((await anonymous[method](request(method))).status, 401);
  const admin = fixture();
  assert.equal((await admin.POST(request("POST", {}, "https://untrusted.example"))).status, 403);
  assert.equal((await admin.PATCH(request("PATCH", {}, "https://untrusted.example"))).status, 403);
  const viewer = fixture("viewer");
  assert.equal((await viewer.POST(request("POST", { requestId: id, task: { op: "create_task", title: "No" } }))).status, 403);
  assert.equal((await viewer.PATCH(request("PATCH", { kind: "task", id, expectedUpdatedAt: "revision", changes: { status: "done" } }))).status, 403);
  assert.equal((await viewer.PATCH(request("PATCH", { kind: "alert", id }))).status, 200);
  assert.equal(viewer.writes.length, 1);
});

test("task API validates input, preserves optimistic revisions and uses retry-safe create IDs", async () => {
  const app = fixture();
  for (const body of [{ kind: "task", id }, { kind: "task", id, expectedUpdatedAt: "old", changes: {} }, { kind: "alert", id: "forged" }]) assert.equal((await app.PATCH(request("PATCH", body))).status, 400);
  assert.equal(app.writes.length, 0);
  assert.equal((await app.POST(request("POST", { requestId: id, task: { op: "create_task", title: "  Call buyer  ", priority: "high" } }))).status, 200);
  assert.equal(app.writes[0][1], id);
  assert.equal((app.writes[0][2] as { title: string }).title, "Call buyer");
  assert.equal((await app.POST(request("POST", { requestId: id, task: { op: "create_task", title: "Forged link", companyId: id } }))).status, 400);
  assert.equal((await app.PATCH(request("PATCH", { kind: "task", id, expectedUpdatedAt: "saved revision", changes: { status: "cancelled" } }))).status, 200);
  assert.equal(app.writes[1][2], "saved revision");
});

test("activity retrieval validates pagination, is private and reports failures without exposing database details", async () => {
  const app = fixture();
  const response = await app.GET(new Request(`https://crm.example.com/api/flows/activity?taskPage=-1&alertPage=2&task=${id}`));
  const result = await response.json();
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(result.args, [false, { taskPage: 0, alertPage: 2, taskId: id }]);
  app.fail();
  const failed = await app.GET(request("GET"));
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(await failed.json()), /private database/);
  assert.equal(activity.activityPage("1.5"), 0); assert.equal(activity.activityPage("Infinity"), 0);
  assert.equal(activity.activityTime("bad timestamp"), "Unknown time");
});
