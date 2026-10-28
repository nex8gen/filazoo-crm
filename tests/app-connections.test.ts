import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { mailboxAppId, personalMailboxSummary } from "../lib/app-connection-status.ts";
import { neteaseServerProfiles, neteaseProfileForHosts } from "../lib/netease-mail.ts";
import { buildMailerTransportConfig } from "../lib/mailer.ts";
import { normalizeMailboxRows } from "../lib/mailbox-utils.ts";
import { emailConnectionAccounts, emailProviderSummary, emailProviderHref } from "../lib/email-connections.ts";

const accountId = "00000000-0000-4000-8000-000000000001";
const mailbox = { id: accountId, type: "personal", user_id: "owner", email: "owner@gmail.com", provider: "smtp", is_active: true,
  smtp_host: "smtp.gmail.com", imap_host: "imap.gmail.com", smtp_username: "owner@gmail.com", imap_username: "owner@gmail.com",
  smtp_password: "saved-smtp", imap_password: "saved-imap", is_default: true };

test("connection cards recognize provider hosts without trusting a provider label", () => {
  assert.equal(mailboxAppId(mailbox), "gmail");
  assert.equal(mailboxAppId({ provider: "google", smtp_host: "smtp.example.com", imap_host: "imap.example.com" }), null);
  assert.equal(mailboxAppId({ ...mailbox, smtp_host: "smtp.gmail.com.evil.example" }), null);
  assert.equal(mailboxAppId({ smtp_host: "smtp.office365.com", imap_host: "outlook.office365.com" }), "outlook");
});

test("personal connected status excludes other owners and workspace accounts", () => {
  assert.equal(personalMailboxSummary([mailbox], "owner", "gmail").status, "connected");
  assert.equal(personalMailboxSummary([mailbox], "another-user", "gmail").status, "not_connected");
  assert.equal(personalMailboxSummary([{ ...mailbox, type: "workspace" }], "owner", "gmail").status, "not_connected");
  assert.equal(personalMailboxSummary([{ ...mailbox, is_active: false }], "owner", "gmail").status, "paused");
  assert.equal(personalMailboxSummary([{ ...mailbox, imap_password: null }], "owner", "gmail").status, "configured");
  assert.equal(personalMailboxSummary([mailbox, { ...mailbox, id: "second" }], "owner", "gmail").accountCount, 2);
});

function connectionAction(options: { owner?: string; signedIn?: boolean; duplicate?: boolean; rejectProvider?: boolean; appId?: "gmail" | "netease-mail"; role?: string; scope?: "personal" | "workspace" } = {}) {
  const writes: { operation: string; record: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const checks: Record<string, unknown>[] = [];
  let reads = 0;
  const isNetease = options.appId === "netease-mail";
  const saved = { ...mailbox, ...(isNetease ? { email: "owner@example.com", smtp_host: "smtp.qiye.163.com", imap_host: "imap.qiye.163.com" } : {}), type: options.scope ?? "personal", user_id: options.owner ?? "owner" };
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: () => {} },
    zod: { z },
    "@/lib/auth": { requireWorkspaceMember: async () => { if (options.signedIn === false) throw new Error("Authentication required"); return { id: "owner", role: options.role ?? "admin" }; } },
    "@/lib/app-connection-status": { mailboxAppId },
    "@/lib/netease-mail": { neteaseServerProfiles },
    "@/lib/mailbox-connection": { verifyMailboxConnections: async (input: Record<string, unknown>) => { checks.push(input); if (options.rejectProvider) throw new Error("Provider authentication failed"); } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => {
      let operation = "read";
      let record: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        update: (value: Record<string, unknown>) => { operation = "update"; record = value; return query; },
        insert: (value: Record<string, unknown>) => { operation = "insert"; record = value; return query; },
        maybeSingle: async () => {
          if (operation === "read") { reads++; return { data: filters.type === saved.type && (saved.type === "workspace" || filters.user_id === saved.user_id) && filters.id === saved.id ? saved : null, error: null }; }
          writes.push({ operation, record, filters });
          return options.duplicate ? { data: null, error: { code: "23505" } } : { data: { id: accountId }, error: null };
        },
      };
      return query;
    } }) },
  };
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL(isNetease ? "../app/settings/apps/netease-actions.ts" : "../app/settings/apps/gmail-actions.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { exports, FormData, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; } });
  const action = exports[isNetease ? "saveNeteaseConnection" : "saveGmailConnection"] as typeof import("../app/settings/apps/gmail-actions.ts").saveGmailConnection;
  return { action, writes, checks, reads: () => reads };
}

const gmailAction = connectionAction;

function input(changes: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ mailboxId: "", email: "new@gmail.com", displayName: "Sales Gmail", appPassword: "abcd efgh ijkl mnop", ...changes })) form.set(key, value);
  return form;
}

test("Gmail save requires authentication before reading credentials", async () => {
  const fixture = gmailAction({ signedIn: false });
  await assert.rejects(() => fixture.action(undefined, input()), /Authentication required/);
  assert.equal(fixture.reads(), 0);
  assert.equal(fixture.writes.length, 0);
});

test("Gmail cannot update another owner's account or send its saved credentials", async () => {
  const fixture = gmailAction({ owner: "another-user" });
  const result = await fixture.action(undefined, input({ mailboxId: accountId, email: mailbox.email, appPassword: "" }));
  assert.match(result?.error ?? "", /access denied/);
  assert.equal(fixture.checks.length, 0);
  assert.equal(fixture.writes.length, 0);
});

test("new Gmail connections use fixed endpoints and insert without replacing defaults", async () => {
  const fixture = gmailAction();
  const form = input({ smtpHost: "attacker.example", userId: "another-user", isDefault: "true" });
  const result = await fixture.action(undefined, form);
  assert.ok(result?.success);
  assert.equal(fixture.checks[0].smtpHost, "smtp.gmail.com");
  assert.equal(fixture.checks[0].imapHost, "imap.gmail.com");
  assert.equal(fixture.checks[0].smtpPassword, "abcdefghijklmnop");
  assert.equal(fixture.writes[0].operation, "insert");
  assert.equal(fixture.writes[0].record.user_id, "owner");
  assert.equal(fixture.writes[0].record.is_default, false);
  assert.equal(JSON.stringify(result).includes("abcdefghijklmnop"), false);
});

test("existing Gmail updates preserve saved passwords, active state, and default selection", async () => {
  const fixture = gmailAction();
  const result = await fixture.action(undefined, input({ mailboxId: accountId, email: mailbox.email, appPassword: "" }));
  assert.ok(result?.success);
  assert.equal(fixture.checks[0].smtpPassword, "saved-smtp");
  assert.equal(fixture.checks[0].imapPassword, "saved-imap");
  assert.equal(fixture.writes[0].operation, "update");
  assert.equal(fixture.writes[0].filters.user_id, "owner");
  assert.equal("is_default" in fixture.writes[0].record, false);
  assert.equal("is_active" in fixture.writes[0].record, false);
});

test("authentication failure saves nothing and duplicate addresses do not become success", async () => {
  const failed = gmailAction({ rejectProvider: true });
  assert.ok((await failed.action(undefined, input()))?.error);
  assert.equal(failed.writes.length, 0);
  const duplicate = gmailAction({ duplicate: true });
  assert.match((await duplicate.action(undefined, input()))?.error ?? "", /already saved/);
  assert.equal(duplicate.writes[0].operation, "insert");
});

test("changing an existing Gmail address requires a separate account", async () => {
  const fixture = gmailAction();
  assert.match((await fixture.action(undefined, input({ mailboxId: accountId })))?.error ?? "", /separate connection/);
  assert.equal(fixture.checks.length, 0);
  assert.equal(fixture.writes.length, 0);
});

function neteaseInput(changes: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ mailboxId: "", email: "new@example.com", displayName: "Lingxi Mail", clientPassword: "provider-issued-client-password", serverProfile: "standard", smtpPort: "994", ...changes })) form.set(key, value);
  return form;
}

test("Lingxi mail recognizes standard and regional NetEase hosts without trusting lookalike domains", () => {
  for (const [profile, server] of Object.entries(neteaseServerProfiles)) {
    const row = { ...mailbox, smtp_host: server.smtpHost, imap_host: server.imapHost };
    assert.equal(neteaseProfileForHosts(server.smtpHost, server.imapHost), profile);
    assert.equal(mailboxAppId(row), "netease-mail");
    assert.equal(personalMailboxSummary([row], "owner", "netease-mail").status, "connected");
  }
  assert.equal(neteaseProfileForHosts("smtp.qiye.163.com.evil.example", "imap.qiye.163.com"), null);
  assert.equal(neteaseProfileForHosts("smtp.163.com", "imap.163.com"), null);
  assert.equal(neteaseProfileForHosts("smtphz.qiye.163.com", "imap.qiye.163.com"), null);
});

test("SMTP transport uses implicit TLS for NetEase port 994 and keeps Gmail port behavior", () => {
  for (const port of [994, 465, 587]) {
    const result = buildMailerTransportConfig({ host: "smtp.qiye.163.com", port, user: "owner@example.com", pass: "client-password" });
    assert.equal(result?.secure, port !== 587);
    assert.equal(result?.port, port);
  }
});

test("Lingxi save only accepts approved profiles and encrypted SMTP ports", async () => {
  for (const invalid of [{ serverProfile: "attacker.example" }, { smtpPort: "25" }, { smtpPort: "587" }]) {
    const fixture = connectionAction({ appId: "netease-mail" });
    assert.ok((await fixture.action(undefined, neteaseInput(invalid)))?.error);
    assert.equal(fixture.checks.length, 0);
    assert.equal(fixture.writes.length, 0);
  }
});

test("Lingxi connects custom company addresses with fixed provider endpoints and no account replacement", async () => {
  for (const profile of ["standard", "hangzhou", "overseas"] as const) {
    const fixture = connectionAction({ appId: "netease-mail" });
    const result = await fixture.action(undefined, neteaseInput({ serverProfile: profile, smtpHost: "attacker.example" }));
    assert.ok(result?.success);
    assert.equal(fixture.checks[0].smtpHost, neteaseServerProfiles[profile].smtpHost);
    assert.equal(fixture.checks[0].imapHost, neteaseServerProfiles[profile].imapHost);
    assert.equal(fixture.checks[0].smtpPort, 994);
    assert.equal(fixture.checks[0].imapPort, 993);
    assert.equal(fixture.writes[0].operation, "insert");
    assert.equal(fixture.writes[0].record.user_id, "owner");
    assert.equal(fixture.writes[0].record.is_default, false);
    assert.equal(JSON.stringify(result).includes("provider-issued-client-password"), false);
  }
});

test("Lingxi requires authentication and never uses another owner's credentials", async () => {
  const signedOut = connectionAction({ appId: "netease-mail", signedIn: false });
  await assert.rejects(() => signedOut.action(undefined, neteaseInput()), /Authentication required/);
  assert.equal(signedOut.writes.length, 0);
  const foreign = connectionAction({ appId: "netease-mail", owner: "another-user" });
  assert.match((await foreign.action(undefined, neteaseInput({ mailboxId: accountId, clientPassword: "" })))?.error ?? "", /access denied/);
  assert.equal(foreign.checks.length, 0);
  assert.equal(foreign.writes.length, 0);
});

test("Lingxi updates preserve saved passwords and other mailbox preferences", async () => {
  const fixture = connectionAction({ appId: "netease-mail" });
  const result = await fixture.action(undefined, neteaseInput({ mailboxId: accountId, email: "owner@example.com", clientPassword: "" }));
  assert.ok(result?.success);
  assert.equal(fixture.checks[0].smtpPassword, "saved-smtp");
  assert.equal(fixture.checks[0].imapPassword, "saved-imap");
  assert.equal(fixture.writes[0].operation, "update");
  assert.equal(fixture.writes[0].filters.user_id, "owner");
  assert.equal("is_default" in fixture.writes[0].record, false);
  assert.equal("is_active" in fixture.writes[0].record, false);
});

test("Lingxi rejects duplicates, changed addresses, and failed authentication", async () => {
  const duplicate = connectionAction({ appId: "netease-mail", duplicate: true });
  assert.match((await duplicate.action(undefined, neteaseInput()))?.error ?? "", /already saved/);
  const changed = connectionAction({ appId: "netease-mail" });
  assert.match((await changed.action(undefined, neteaseInput({ mailboxId: accountId })))?.error ?? "", /separate connection/);
  assert.equal(changed.checks.length, 0);
  const failed = connectionAction({ appId: "netease-mail", rejectProvider: true });
  assert.ok((await failed.action(undefined, neteaseInput()))?.error);
  assert.equal(failed.writes.length, 0);
});

test("email overview groups only own personal and shared team accounts, without credentials", () => {
  const rows = normalizeMailboxRows([mailbox, { ...mailbox, id: "foreign", user_id: "another-user" }, { ...mailbox, id: "team", type: "workspace", user_id: null }, { ...mailbox, id: "paused", is_active: false }]);
  const accounts = emailConnectionAccounts(rows, "owner");
  assert.deepEqual(accounts.map(account => account.id), [accountId, "team", "paused"]);
  assert.equal(accounts[0].isDefault, true);
  assert.equal(accounts[1].scope, "workspace");
  assert.equal(accounts[2].status, "paused");
  assert.equal(accounts[2].sendConfigured, false);
  for (const secret of ["smtpPassword", "imapPassword", "smtp_password", "imap_password", "userId"]) assert.equal(JSON.stringify(accounts).includes(secret), false);
  assert.equal(JSON.stringify(accounts).includes("saved-smtp"), false);
  const summary = emailProviderSummary({ accounts, error: null }, "gmail");
  assert.equal(summary.status, "connected");
  assert.equal(summary.personalCount, 2);
  assert.equal(summary.teamCount, 1);
  assert.equal(emailProviderSummary({ accounts: [], error: "Read failed" }, "gmail").status, "unavailable");
  assert.equal(emailProviderHref("gmail", "workspace"), "/settings/apps/gmail?scope=team");
});

test("only administrators can create or update team email through either provider", async () => {
  for (const appId of ["gmail", "netease-mail"] as const) {
    for (const role of ["operator", "bd_manager", "viewer"]) {
      const fixture = connectionAction({ appId, role, scope: "workspace" });
      const form = appId === "gmail" ? input({ mailboxScope: "workspace" }) : neteaseInput({ mailboxScope: "workspace" });
      assert.match((await fixture.action(undefined, form))?.error ?? "", /administrator/);
      assert.equal(fixture.reads(), 0);
      assert.equal(fixture.checks.length, 0);
      assert.equal(fixture.writes.length, 0);
    }
    const admin = connectionAction({ appId, role: "admin", scope: "workspace" });
    const form = appId === "gmail" ? input({ mailboxScope: "workspace" }) : neteaseInput({ mailboxScope: "workspace" });
    assert.ok((await admin.action(undefined, form))?.success);
    assert.equal(admin.writes[0].record.type, "workspace");
    assert.equal(admin.writes[0].record.user_id, null);
    assert.equal(admin.writes[0].record.is_default, false);
  }
});

test("provider saves cannot convert personal accounts into team accounts or the reverse", async () => {
  for (const appId of ["gmail", "netease-mail"] as const) {
    for (const scope of ["personal", "workspace"] as const) {
      const fixture = connectionAction({ appId, role: "admin", scope });
      const change = { mailboxId: accountId, mailboxScope: scope === "personal" ? "workspace" : "personal" };
      const form = appId === "gmail" ? input(change) : neteaseInput(change);
      assert.match((await fixture.action(undefined, form))?.error ?? "", /access denied/);
      assert.equal(fixture.checks.length, 0);
      assert.equal(fixture.writes.length, 0);
    }
  }
});

test("team credential updates keep default and paused states and filter the mutation by account type", async () => {
  for (const appId of ["gmail", "netease-mail"] as const) {
    const fixture = connectionAction({ appId, role: "admin", scope: "workspace" });
    const form = appId === "gmail" ? input({ mailboxScope: "workspace", mailboxId: accountId, email: mailbox.email, appPassword: "" })
      : neteaseInput({ mailboxScope: "workspace", mailboxId: accountId, email: "owner@example.com", clientPassword: "" });
    assert.ok((await fixture.action(undefined, form))?.success);
    assert.equal(fixture.writes[0].operation, "update");
    assert.equal(fixture.writes[0].filters.type, "workspace");
    assert.equal(fixture.writes[0].filters.id, accountId);
    assert.equal("is_default" in fixture.writes[0].record, false);
    assert.equal("is_active" in fixture.writes[0].record, false);
  }
});
