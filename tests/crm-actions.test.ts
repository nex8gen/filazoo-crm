import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const id = "c0c0c0c0-1111-4111-8111-111111111111";
const otherId = "c0c0c0c0-2222-4222-8222-222222222222";
const state = {
  role: "admin", rows: [{ id }], error: null as null | { message: string },
  calls: [] as Array<[string, ...unknown[]]>, paths: [] as string[],
};
const query = {
  select(...args: unknown[]) { state.calls.push(["select", ...args]); return query; },
  delete() { state.calls.push(["delete"]); return query; },
  eq(...args: unknown[]) { state.calls.push(["eq", ...args]); return query; },
  in(...args: unknown[]) { state.calls.push(["in", ...args]); return query; },
  upsert(...args: unknown[]) { state.calls.push(["upsert", ...args]); return query; },
  insert(...args: unknown[]) { state.calls.push(["insert", ...args]); return query; },
  order() { return query; },
  maybeSingle: async () => ({ data: state.rows[0] ?? null, error: state.error }),
  then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: state.rows, error: state.error }).then(resolve); },
};
const admin = {
  from(table: string) { state.calls.push(["from", table]); return query; },
  rpc(name: string, args: unknown) {
    if (name !== "assign_company_owner") throw new Error("Listing flows must not create a default flow.");
    state.calls.push(["rpc", name, args]);
    return Promise.resolve({ data: "Manager", error: state.error });
  },
};
const key = "__crmActionsTest";
Object.assign(globalThis, { [key]: { state, admin } });
const runtime = `const {state, admin} = globalThis.${key};`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "server-only") source = "export {};";
    if (specifier === "@/lib/auth") source = `${runtime} export async function requireWorkspaceMember(roles) { if (!roles.includes(state.role)) throw new Error('Access denied'); return {id: 'actor', role: state.role}; }`;
    if (specifier === "@/lib/supabase/admin" || specifier === "../supabase/admin.ts") source = `${runtime} export function createSupabaseAdmin() { return admin; }`;
    if (specifier === "next/cache") source = `${runtime} export function revalidatePath(path) { state.paths.push(path); }`;
    if (specifier === "@/lib/data/flow-runtime" || specifier === "./flow-runtime.ts") source = "export async function enrollMatchingFlows() {} export async function validateFlowResources() {}";
    if (specifier === "@/lib/lead-assignment") source = "export async function claimNextBdSalesManager() {}";
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    if (specifier.startsWith("@/lib/")) return { url: new URL(`../lib/${specifier.slice(6)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { bulkUpdateCompanies, assignPipelineOwner, scheduleCompanyFollowup } = await import("../app/crm-actions.ts");
const { listFlows, deleteFlow } = await import("../lib/data/flows.ts");
test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, key); });
test.beforeEach(() => { state.role = "admin"; state.rows = [{ id }]; state.error = null; state.calls = []; state.paths = []; });

test("company deletion reports actual deleted rows and refreshes linked screens", async () => {
  assert.deepEqual(await bulkUpdateCompanies([id, otherId], "delete"), { success: "1 company deleted." });
  assert.ok(state.calls.some((call) => call[0] === "in" && call[1] === "id"));
  assert.ok(state.calls.some((call) => call[0] === "select" && call[1] === "id"));
  for (const path of ["/companies", "/pipeline", "/invoices", `/companies/${id}`]) assert.ok(state.paths.includes(path));
});
test("missing records and database errors never produce delete success", async () => {
  state.rows = [];
  assert.ok((await bulkUpdateCompanies([id], "delete"))?.error);
  state.error = { message: "delete failed" };
  assert.ok((await bulkUpdateCompanies([id], "delete"))?.error);
  assert.deepEqual(state.paths, []);
});
test("company deletion validates IDs and enforces the existing administrator permission", async () => {
  assert.ok((await bulkUpdateCompanies(["invalid"], "delete"))?.error);
  assert.deepEqual(state.calls, []);
  for (const role of ["operator", "bd_manager", "viewer"]) {
    state.role = role;
    await assert.rejects(bulkUpdateCompanies([id], "delete"), /Access denied/);
  }
  assert.deepEqual(state.calls, []);
});
test("deleting the last flow leaves the list empty across repeated loads", async () => {
  await deleteFlow("actor", id);
  assert.ok(state.calls.some((call) => call[0] === "eq" && call[1] === "user_id" && call[2] === "actor"));
  state.rows = [];
  assert.deepEqual(await listFlows("actor"), []);
  assert.deepEqual(await listFlows("actor"), []);
});
test("flow deletion rejects missing flows and database failures", async () => {
  state.rows = [];
  await assert.rejects(deleteFlow("actor", id), /Flow not found/);
  state.error = { message: "database unavailable" };
  await assert.rejects(deleteFlow("actor", id), /database unavailable/);
});

test("company assignment calls the atomic backend with the authenticated actor", async () => {
  assert.deepEqual(await assignPipelineOwner(id, otherId), { success: "Assigned to Manager." });
  assert.ok(state.calls.some((call) => call[0] === "rpc" && call[1] === "assign_company_owner" && JSON.stringify(call[2]) === JSON.stringify({ p_company_id: id, p_owner_id: otherId, p_actor_id: "actor" })));
  assert.ok(state.paths.includes(`/companies/${id}`));
  state.error = { message: "unavailable" };
  assert.ok((await assignPipelineOwner(id, null))?.error);
});

test("assignment denies non-admins and validates input before contacting the backend", async () => {
  assert.ok((await assignPipelineOwner("invalid", null))?.error);
  assert.deepEqual(state.calls, []);
  for (const role of ["operator", "bd_manager", "viewer"]) {
    state.role = role;
    await assert.rejects(assignPipelineOwner(id, null), /Access denied/);
  }
  assert.deepEqual(state.calls, []);
});

test("follow-up saves only the supplied instant without changing stage or owner", async () => {
  const dueAt = "2026-10-27T01:30:00.000Z";
  assert.deepEqual(await scheduleCompanyFollowup(id, dueAt), { success: "Follow-up scheduled." });
  assert.ok(state.calls.some((call) => call[0] === "upsert" && JSON.stringify(call[1]) === JSON.stringify({ company_id: id, next_followup_at: dueAt })));
  assert.ok(state.calls.some((call) => call[0] === "insert" && (call[1] as { type: string }).type === "followup_scheduled"));
  assert.ok(state.paths.includes(`/companies/${id}`));
  state.calls = [];
  assert.deepEqual(await scheduleCompanyFollowup(id, ""), { success: "Follow-up cancelled." });
  assert.ok(state.calls.some((call) => call[0] === "upsert" && (call[1] as { next_followup_at: string | null }).next_followup_at === null));
});

test("follow-up rejects timezone-less dates, read-only roles, missing companies and backend failures", async () => {
  assert.ok((await scheduleCompanyFollowup(id, "2026-10-27T09:30"))?.error);
  assert.deepEqual(state.calls, []);
  state.role = "viewer";
  await assert.rejects(scheduleCompanyFollowup(id, ""), /Access denied/);
  state.role = "admin";
  state.rows = [];
  assert.ok((await scheduleCompanyFollowup(id, ""))?.error);
  state.rows = [{ id }];
  state.error = { message: "database unavailable" };
  assert.ok((await scheduleCompanyFollowup(id, ""))?.error);
  assert.deepEqual(state.paths, []);
});
