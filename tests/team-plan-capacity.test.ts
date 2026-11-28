import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as invitations from "../lib/workspace-invitations.ts";
import * as workspaces from "../lib/workspaces.ts";
import * as errors from "../lib/team-invitation-errors.ts";

const require = createRequire(import.meta.url);
const actor = "aaaaaaaa-1111-4111-8111-111111111111";
const workspaceId = "bbbbbbbb-1111-4111-8111-111111111111";
const invitationId = "cccccccc-1111-4111-8111-111111111111";
const viewer = { id: actor, role: "admin", workspaceId };
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => name in dependencies ? dependencies[name] : require(name), URL, Date });
  return exports as T;
}
type State = { error?: string; success?: string; invitationUrl?: string } | undefined;
type Action = (state: undefined, form: FormData) => Promise<State>;
function form() {
  const result = new FormData();
  for (const [key, value] of Object.entries({ email: "  TEAM@example.com  ", displayName: "Teammate", role: "viewer", workspaceId: "forged", actorId: "forged" })) result.set(key, value);
  return result;
}
function actionFixture(message: string | null = null, role = "admin", resultId: string | null = invitationId) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const paths: string[] = [];
  let mailboxReads = 0;
  const actions = load<{ createTeamInvitation: Action }>("app/settings/team-actions.ts", {
    "next/cache": { revalidatePath: (path: string) => paths.push(path) }, zod: { z },
    "@/lib/auth": { requireWorkspaceMember: async () => { if (role !== "admin") throw new Error("Access denied"); return viewer; } },
    "@/lib/supabase/control": { createSupabaseControl: (id: string) => { assert.equal(id, actor); return { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: resultId, error: message ? { message } : null }; }, from: () => assert.fail("Invitation writes must use the atomic quota RPC") }; } },
    "@/lib/workspace-invitations": invitations, "@/lib/workspaces": workspaces,
    "@/lib/team-invitation-errors": errors, "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example.com" } },
    "@/lib/data/mailboxes": { getDefaultWorkspaceMailbox: async () => { mailboxReads++; return null; }, mailboxHasSmtp: () => false },
    "@/lib/auth-invitation": {}, "@/lib/mailer": { sendMailboxEmail: () => assert.fail("No provider sends in tests") },
  });
  return { ...actions, calls, paths, mailboxReads: () => mailboxReads };
}

test("invitation creation reserves capacity atomically with server identity and a hashed token", async () => {
  const fixture = actionFixture();
  const result = await fixture.createTeamInvitation(undefined, form());
  assert.ok(result?.invitationUrl);
  assert.equal(fixture.calls.length, 1);
  const { name, args } = fixture.calls[0];
  assert.equal(name, "create_workspace_team_invitation");
  assert.equal(args.p_actor_id, actor); assert.equal(args.p_workspace_id, workspaceId);
  assert.equal(args.p_email, "team@example.com"); assert.equal(args.p_role, "viewer");
  const token = new URL(result.invitationUrl).pathname.split("/").at(-1)!;
  assert.equal(args.p_token_hash, invitations.invitationHash(token));
  assert.ok(!Object.values(args).includes(token));
  assert.deepEqual(fixture.paths, ["/settings/team"]);
});

test("full or inactive plans cannot create links or send email, and internal errors stay private", async () => {
  for (const [message, expected] of [
    ["Your plan has no available user places. Pending invitations also reserve a place", /owner and pending invitations/],
    ["An active subscription is required to invite team members", /active subscription/],
    ["This person is already a workspace member", /already a workspace member/],
    ["secret internal relation billing_policy missing", /Unable to create/],
  ] as const) {
    const fixture = actionFixture(message);
    const result = await fixture.createTeamInvitation(undefined, form());
    assert.match(result?.error ?? "", expected);
    assert.equal(result?.invitationUrl, undefined); assert.equal(fixture.mailboxReads(), 0);
    assert.doesNotMatch(JSON.stringify(result), /secret internal/);
  }
  const missing = actionFixture(null, "admin", null);
  assert.match((await missing.createTeamInvitation(undefined, form()))?.error ?? "", /Unable to create/);
  assert.equal(missing.mailboxReads(), 0);
});

test("nonadministrators and invalid invitation data cannot reach provisioning", async () => {
  const denied = actionFixture(null, "viewer");
  await assert.rejects(denied.createTeamInvitation(undefined, form()), /Access denied/);
  assert.equal(denied.calls.length, 0);
  const invalid = actionFixture(); const data = form(); data.set("email", "bad");
  assert.match((await invalid.createTeamInvitation(undefined, data))?.error ?? "", /valid name, email/);
  assert.equal(invalid.calls.length, 0);
});

test("joining reports plan capacity failures without changing workspace cookies", async () => {
  let cookiesWritten = 0;
  const actions = load<{ joinWorkspace: Action }>("app/join/[token]/actions.ts", {
    "next/headers": { cookies: async () => ({ set: () => cookiesWritten++ }) },
    "@/lib/auth": { requireViewer: async () => viewer },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async () => ({ error: { message: "Your subscription member limit has been reached" }, data: null }) }) },
    "@/lib/workspace-invitations": invitations, "@/lib/workspaces": workspaces, "@/lib/team-invitation-errors": errors,
  });
  const data = new FormData(); data.set("token", invitations.invitationToken());
  assert.match((await actions.joinWorkspace(undefined, data))?.error ?? "", /no available user places/);
  assert.equal(cookiesWritten, 0);
});

test("team capacity reads are scoped and fail closed for errors or incomplete data", async () => {
  const data = { plan: "starter", active: true, memberLimit: 1, memberCount: 1, pendingCount: 0, canInvite: false };
  let result: unknown = data; let failure = false;
  const { readTeamCapacity } = load<{ readTeamCapacity: (viewer: unknown) => Promise<unknown> }>("lib/data/team-capacity.ts", {
    "server-only": {}, zod: { z }, "../supabase/control.ts": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, string>) => {
      assert.equal(name, "read_workspace_team_capacity"); assert.equal(args.p_actor_id, actor); assert.equal(args.p_workspace_id, workspaceId);
      return { data: result, error: failure ? { message: "private" } : null };
    } }) },
  });
  assert.equal(JSON.stringify(await readTeamCapacity(viewer)), JSON.stringify(data));
  result = { plan: "starter" }; await assert.rejects(readTeamCapacity(viewer), /Unable to check/);
  result = data; failure = true; await assert.rejects(readTeamCapacity(viewer), /Unable to check/);
  await assert.rejects(readTeamCapacity({ ...viewer, role: "viewer" }), /Administrator access required/);
});

test("team page explains owner and pending places, hides invitations when full, and preserves member management", async () => {
  const panel = ({ children }: { children: ReactNode }) => createElement("div", null, children);
  const scenarios = [
    { plan: "starter", active: true, memberLimit: 1, memberCount: 1, pendingCount: 0, canInvite: false },
    { plan: "pro", active: true, memberLimit: 2, memberCount: 1, pendingCount: 1, canInvite: false },
    { plan: "business", active: true, memberLimit: 5, memberCount: 2, pendingCount: 0, canInvite: true },
    { plan: "pro", active: false, memberLimit: 2, memberCount: 1, pendingCount: 0, canInvite: false },
    null,
  ];
  for (const capacity of scenarios) {
    const { TeamSection } = load<{ TeamSection: (props: unknown) => Promise<ReactNode> }>("app/settings/sections/team.tsx", {
      "@/lib/data/members": { listWorkspaceMembers: async () => [] },
      "@/components/members-table": { MembersTable: () => createElement("div", null, "Manage existing members") },
      "@/components/ui/card": { Card: panel, CardHeader: panel, CardTitle: panel, CardDescription: panel, CardContent: panel },
      "../settings-forms": { InviteMemberForm: () => createElement("form", { action: "/invite" }, "Invitation form") },
      "../pending-invitations": { PendingInvitations: () => createElement("div", null, "Revoke pending invitations") },
      "next/link": { default: ({ href, children }: { href: string; children: ReactNode }) => createElement("a", { href }, children) },
      "@/lib/data/team-capacity": { readTeamCapacity: async () => { if (!capacity) throw Error("Unavailable"); return capacity; } },
    });
    const html = renderToStaticMarkup(await TeamSection({ viewer }));
    assert.match(html, /Manage existing members/); assert.match(html, /Revoke pending invitations/);
    assert.equal(html.includes("Invitation form"), capacity?.canInvite ?? false);
    if (capacity?.memberLimit === 1) assert.match(html, /Starter includes one user: the workspace owner/);
    if (!capacity) assert.match(html, /Unable to check available user places/);
    if (capacity?.pendingCount) assert.match(html, /Every included user place is in use or reserved/);
  }
});
