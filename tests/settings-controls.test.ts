import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { settingsSectionForPath, visibleSettingsSections } from "../lib/settings-sections.ts";

test("settings search finds actual controls across categories and languages without exposing admin items", () => {
  assert.deepEqual(visibleSettingsSections(false, "email signature").map(item => item.id), ["email"]);
  assert.deepEqual(visibleSettingsSections(false, "  DARK  theme ").map(item => item.id), ["appearance"]);
  assert.deepEqual(visibleSettingsSections(false, "签名").map(item => item.id), ["email"]);
  for (const query of ["ERP", "lead assignment"]) assert.equal(visibleSettingsSections(false, query).length, 0);
  assert.deepEqual(visibleSettingsSections(false, "team access").map(item => item.id), ["ai"]);
  assert.equal(visibleSettingsSections(false).some(item => item.id === "team"), false);
  assert.deepEqual(visibleSettingsSections(true, "ERP").map(item => item.id), ["erp"]);
  assert.equal(visibleSettingsSections(true, "no matching setting").length, 0);
});

test("nested connection pages and the general alias keep the right active section", () => {
  assert.equal(settingsSectionForPath("/settings/apps/gmail")?.id, "apps");
  assert.equal(settingsSectionForPath("/settings/general")?.id, "general");
  assert.equal(settingsSectionForPath("/settings/appearance")?.id, "appearance");
  assert.equal(settingsSectionForPath("/settings/unknown"), undefined);
});

function fixture(role = "admin") {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const checks: unknown[] = [];
  const exports: Record<string, (state: undefined, form: FormData) => Promise<{ error?: string; success?: string }>> = {};
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "member@example.com", user_metadata: {}, app_metadata: {} } }, error: null }), updateUserById: async () => ({ error: null }) } },
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: { role: "bd_manager", auto_assign_leads: true }, error: null }),
        update: (value: Record<string, unknown>) => { writes.push({ table, value }); return query; },
        upsert: async (value: Record<string, unknown>) => { writes.push({ table, value }); return { error: null }; },
        insert: async () => ({ error: null }),
        then: (resolve: (value: { error: null }) => void) => resolve({ error: null }),
      };
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: () => {}, updateTag: () => {} }, zod: { z },
    "@/lib/auth": { requireWorkspaceMember: async (allowed: string[]) => { if (!allowed.includes(role)) throw new Error("Access denied"); return { id: "a0000000-1111-4111-8111-111111111111", role }; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => admin },
    "@/lib/auth-invitation": {}, "@/lib/data/mailboxes": {}, "@/lib/data/members": {}, "@/lib/env": {}, "@/lib/mailer": {},
    "@/lib/mailbox-connection": { verifyMailboxConnections: async (input: unknown) => checks.push(input) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/settings/actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`); return dependencies[name]; } });
  return { actions: exports, writes, checks };
}

function memberForm(checked = false) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ userId: "b0000000-2222-4222-8222-222222222222", displayName: "Sales member", email: "member@example.com", role: "bd_manager" })) form.set(key, value);
  if (checked) form.set("autoAssignLeads", "on");
  return form;
}

test("lead assignment can be turned off with an omitted field and back on with native switch form data", async () => {
  for (const checked of [false, true]) {
    const mock = fixture();
    assert.ok((await mock.actions.updateMember(undefined, memberForm(checked))).success);
    assert.equal(mock.writes.find(write => write.table === "workspace_members")?.value.auto_assign_leads, checked);
  }
  const denied = fixture("viewer");
  await assert.rejects(denied.actions.updateMember(undefined, memberForm()), /Access denied/);
  assert.equal(denied.writes.length, 0);
});

test("personal and shared mailbox defaults can be turned off without validation failures or resetting other defaults", async () => {
  for (const action of ["savePersonalMailbox", "saveWorkspaceMailbox"]) {
    const mock = fixture();
    const form = new FormData();
    for (const [key, value] of Object.entries({ mailboxId: "", email: "sales@example.com", displayName: "Sales inbox", provider: "smtp", notes: "", smtpHost: "smtp.example.com", smtpPort: "587", smtpUsername: "sales@example.com", smtpPassword: "test-only-password", imapHost: "imap.example.com", imapPort: "993", imapUsername: "sales@example.com", imapPassword: "test-only-password" })) form.set(key, value);
    const result = await mock.actions[action](undefined, form);
    assert.ok(result.success, result.error);
    assert.equal(mock.checks.length, 1);
    assert.equal(mock.writes.length, 1);
    assert.equal(mock.writes[0].value.is_default, false);
  }
});
