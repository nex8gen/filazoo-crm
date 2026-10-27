import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { translateUiText } from "../lib/i18n.ts";

const actor = "a0000000-1111-4111-8111-111111111111";
const member = "b0000000-2222-4222-8222-222222222222";
const state = {
  role: "admin", error: null as { message: string } | null,
  result: { reassigned: 5, unassigned: 0 },
  calls: [] as Array<{ name: string; args: unknown }>, paths: [] as string[],
};
const key = "__memberRemovalTest";
Object.assign(globalThis, { [key]: state });
const runtime = `const state = globalThis.${key};`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source: string | undefined;
    if (specifier === "@/lib/auth") source = `${runtime} export async function requireWorkspaceMember(roles) { if (!roles.includes(state.role)) throw new Error('Access denied'); return {id: '${actor}', role: state.role}; }`;
    if (specifier === "@/lib/supabase/admin") source = `${runtime} export function createSupabaseAdmin() { return { async rpc(name, args) { state.calls.push({name, args}); return { data: state.result, error: state.error }; } }; }`;
    if (specifier === "next/cache") source = `${runtime} export function revalidatePath(path) { state.paths.push(path); }`;
    if (specifier === "@/lib/auth-invitation") source = "export function buildInvitationConfirmationUrl() {} export function buildInvitationEmail() {}";
    if (specifier === "@/lib/data/mailboxes") source = "export function getDefaultWorkspaceMailbox() {} export function mailboxHasSmtp() {}";
    if (specifier === "@/lib/data/members") source = "export function listAllAuthUsers() {}";
    if (specifier === "@/lib/env") source = "export const env = {};";
    if (specifier === "@/lib/mailer") source = "export function sendMailboxEmail() {}";
    if (specifier === "@/lib/mailbox-connection") source = "export function verifyMailboxConnections() {}";
    return source ? { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true } : nextResolve(specifier, context);
  },
});
const { deleteMember } = await import("../app/settings/actions.ts");
test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, key); });
test.beforeEach(() => {
  state.role = "admin"; state.error = null; state.result = { reassigned: 5, unassigned: 0 }; state.calls = []; state.paths = [];
});
function form(id = member) { const data = new FormData(); data.set("userId", id); return data; }

test("member deletion uses one atomic removal and refreshes customer ownership throughout the CRM", async () => {
  const result = await deleteMember(undefined, form());
  assert.match(result?.success ?? "", /5 customer assignments redistributed/);
  assert.deepEqual(state.calls, [{ name: "remove_workspace_member", args: { p_user_id: member, p_actor_id: actor } }]);
  assert.deepEqual(state.paths, ["/"]);
});

test("a failed removal never reports success or refreshes the page", async () => {
  state.error = { message: "transaction rolled back" };
  const result = await deleteMember(undefined, form());
  assert.ok(result?.error);
  assert.equal(result?.success, undefined);
  assert.deepEqual(state.paths, []);
});

test("removing the last eligible manager explains why customers are unassigned", async () => {
  state.result = { reassigned: 0, unassigned: 3 };
  assert.match((await deleteMember(undefined, form()))?.success ?? "", /3 customer assignments remain unassigned because no active BD/);
});

test("invalid IDs, self removal, and non-admins cannot invoke removal", async () => {
  assert.ok((await deleteMember(undefined, form("invalid")))?.error);
  assert.ok((await deleteMember(undefined, form(actor)))?.error);
  for (const role of ["operator", "bd_manager", "viewer"]) {
    state.role = role;
    await assert.rejects(deleteMember(undefined, form()), /Access denied/);
  }
  assert.deepEqual(state.calls, []);
});

test("removal feedback supports Chinese for redistributed and unassigned customers", async () => {
  for (const result of [{ reassigned: 1, unassigned: 0 }, { reassigned: 0, unassigned: 1 }, { reassigned: 3, unassigned: 2 }]) {
    state.result = result;
    const feedback = (await deleteMember(undefined, form()))!.success!;
    assert.notEqual(translateUiText(feedback, "zh-CN"), feedback);
    assert.equal(translateUiText(feedback, "en"), feedback);
  }
});
