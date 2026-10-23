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
  order() { return query; },
  maybeSingle: async () => ({ data: state.rows[0] ?? null, error: state.error }),
  then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: state.rows, error: state.error }).then(resolve); },
};
const admin = {
  from(table: string) { state.calls.push(["from", table]); return query; },
  rpc() { throw new Error("Listing flows must not create a default flow."); },
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
const { bulkUpdateCompanies } = await import("../app/crm-actions.ts");
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
