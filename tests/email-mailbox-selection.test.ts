import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as mailboxUtils from "../lib/mailbox-utils.ts";
import * as threading from "../lib/email-threading.ts";
import { canViewEmail } from "../lib/email-access.ts";
import type { EmailInboxBackendData, InboxEmailItem } from "../lib/email-inbox.ts";
import type { WorkspaceMailboxRecord } from "../lib/data/mailboxes.ts";

const require = createRequire(import.meta.url);
function loadModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Response, Request, URL, Buffer, ReadableStream, crypto, console, process });
  return exports as T;
}

function setup() {
  const rows = [
    { id: "team", type: "workspace", email: "team@example.com", is_default: true },
    { id: "mine", type: "personal", user_id: "actor", email: "me@example.com", is_default: true },
    { id: "someone-else", type: "personal", user_id: "other", email: "other@example.com", is_default: true },
  ].map((row) => ({ ...row, smtp_host: "smtp.example.test", smtp_username: row.email, smtp_password: "test-only", is_active: true }));
  const deliveries: Array<{ from: string; user: string }> = [];
  const saved: Array<Record<string, unknown>> = [];
  const db = { from: (table: string) => {
    if (table === "workspace_mailboxes") return {
      select: () => ({ or: () => ({ order: async () => ({ data: rows, error: null }) }) }),
    };
    assert.equal(table, "mailbox_sent_messages");
    return { insert: (record: Record<string, unknown>) => {
      saved.push(record);
      return { select: () => ({ single: async () => ({ data: { id: record.id }, error: null }) }) };
    } };
  } };
  const mailboxes = loadModule<{
    getViewerMailboxes: (id: string) => Promise<WorkspaceMailboxRecord[]>;
    getViewerMailbox: (id: string, mailboxId?: string) => Promise<WorkspaceMailboxRecord | null>;
    mailboxHasSmtp: (mailbox: WorkspaceMailboxRecord | null) => boolean;
  }>("../lib/data/mailboxes.ts", {
    "../auth.ts": {}, "../mailbox-utils.ts": mailboxUtils,
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
  });
  const route = loadModule<{ POST: (request: Request) => Promise<Response> }>("../app/api/email/send/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "operator" }) },
    "@/lib/data/mailboxes": mailboxes,
    "@/lib/mailer": { sendMailboxEmail: async (config: { from: string; user: string }) => {
      deliveries.push(config);
      return { messageId: "<test@example.test>" };
    } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/email-threading": threading,
  });
  const send = (input: Record<string, unknown> = {}) => route.POST(new Request("http://localhost/api/email/send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: "buyer@example.com", subject: "Test message", text: "A test message.", ...input }),
  }));
  return { rows, mailboxes, send, deliveries, saved };
}

test("mailbox choices contain shared accounts and only the viewer's own personal accounts", async () => {
  const { mailboxes } = setup();
  assert.equal((await mailboxes.getViewerMailboxes("actor")).map((mailbox) => mailbox.id).join(","), "team,mine");
  assert.equal(await mailboxes.getViewerMailbox("actor", "someone-else"), null);
});

test("sending defaults to personal SMTP and saves that mailbox in sent history", async () => {
  const { send, deliveries, saved } = setup();
  const response = await send();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sentVia, "me@example.com");
  assert.equal(result.email.mailboxId, "mine");
  assert.equal(deliveries[0].from, "me@example.com");
  assert.equal(deliveries[0].user, "me@example.com");
  assert.equal(saved[0].mailbox_id, "mine");
});

test("an explicit workspace choice uses workspace SMTP, even with a personal default", async () => {
  const { send, deliveries, saved } = setup();
  const response = await send({ mailboxId: "team", from: "forged@example.com", inReplyTo: "<customer@example.com>" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sentVia, "team@example.com");
  assert.equal(deliveries[0].from, "team@example.com");
  assert.equal(deliveries[0].user, "team@example.com");
  assert.equal(saved[0].mailbox_id, "team");
  assert.equal(saved[0].in_reply_to, "<customer@example.com>");
});

test("forged, removed and stopped sender choices never fall back to another mailbox", async () => {
  const { rows, send, deliveries, saved } = setup();
  for (const mailboxId of ["someone-else", "removed", ""]) {
    assert.equal((await send({ mailboxId })).status, 400);
  }
  rows[1].is_active = false;
  assert.equal((await send({ mailboxId: "mine" })).status, 400);
  assert.equal((await send()).status, 400);
  assert.equal(deliveries.length, 0);
  assert.equal(saved.length, 0);
});

test("without a personal mailbox sending defaults to the workspace account", async () => {
  const { rows, send, deliveries } = setup();
  rows.splice(1);
  assert.equal((await send()).status, 200);
  assert.equal(deliveries[0].from, "team@example.com");
});

test("a connected personal account is preferred even when no personal default is marked", async () => {
  const { rows, mailboxes } = setup();
  rows[1].is_default = false;
  assert.equal((await mailboxes.getViewerMailbox("actor"))?.id, "mine");
});

test("switching inbox accounts scopes received and sent mail while retaining the personal sender default", async () => {
  const setupData = setup();
  const mailboxes = (await setupData.mailboxes.getViewerMailboxes("actor")).map((mailbox) => ({
    ...mailbox, imapHost: "imap.example.test", imapUsername: mailbox.email, imapPassword: "test-only",
  }));
  const synced: string[] = [];
  const sentScopes: string[] = [];
  const backend = loadModule<{ getEmailInboxBackendData: (options?: { mailboxId?: string; syncMailbox?: boolean }) => Promise<EmailInboxBackendData> }>("../lib/email-inbox.ts", {
    "./auth.ts": { requireWorkspaceMember: async () => ({ id: "actor", role: "operator" }) },
    "./mailbox-utils.ts": mailboxUtils,
    "./email-threading.ts": threading,
    "./email-access.ts": { canViewEmail },
    "./data/email-access.ts": { getAssignedEmailContacts: async () => null },
    "./data/mailboxes.ts": {
      getViewerMailboxes: async () => mailboxes,
      mailboxHasSmtp: setupData.mailboxes.mailboxHasSmtp,
      mailboxHasImap: (mailbox: WorkspaceMailboxRecord | null) => Boolean(mailbox?.isActive && mailbox.imapPassword),
    },
    "./data/crm.ts": {
      listCompanies: async () => ({ companies: [] }),
      listEmailDrafts: async () => ({ emails: [{ id: "workspace-draft", subject: "Outreach", contact: "lead@example.com", preview: "Hello", step: 1, status: "Draft" }], mode: "live" }),
      listReplies: async () => ({ replies: [{ id: "workspace-reply", contact: "lead@example.com", body: "Shared reply" }] }),
    },
    "./data/email-state.ts": {
      listEmailInboxStates: async () => new Map(),
      listSentMailboxMessages: async (_viewerId: string, mailboxId: string) => {
        sentScopes.push(mailboxId);
        return [{ id: `sent-${mailboxId}`, mailboxId, direction: "outbound", contact: "buyer@example.com", company: "Buyer", subject: "Sent", body: "Hello", timestamp: "2026-10-27T00:00:00Z" }];
      },
      getEmailAutomationSettings: async () => ({ enabled: false, steps: [], queueCount: 0 }),
    },
    "./data/mailbox-sync.ts": { loadSyncedMailbox: async (mailbox: WorkspaceMailboxRecord) => {
      synced.push(mailbox.id);
      return { messages: [{ id: `received-${mailbox.id}`, source: "mailbox", contact: "buyer@example.com", body: "Hello" }], error: null, syncedAt: null };
    } },
    "./supabase/admin.ts": { createSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }) }) },
  });
  const personal = await backend.getEmailInboxBackendData({ syncMailbox: false });
  assert.equal(personal.selectedMailboxId, "mine");
  assert.equal(personal.emails.map((message) => message.id).sort().join(","), "received-mine,sent-mine");
  const workspace = await backend.getEmailInboxBackendData({ mailboxId: "team", syncMailbox: false });
  assert.equal(workspace.selectedMailboxId, "team");
  assert.equal(workspace.defaultSenderId, "mine");
  assert.equal(workspace.defaultMailboxEmail, "me@example.com");
  assert.equal(workspace.emails.map((message) => message.id).sort().join(","), "received-team,sent-team,workspace-draft,workspace-reply");
  assert.equal(synced.join(","), "mine,team");
  assert.equal(sentScopes.join(","), "mine,team");
  assert.equal(JSON.stringify(workspace.mailboxes).includes("test-only"), false);
  await assert.rejects(backend.getEmailInboxBackendData({ mailboxId: "someone-else" }), /Mailbox unavailable/);
});

test("opening bodies and attachments works for either authorized account and rejects another user's mailbox", async () => {
  const { mailboxes } = setup();
  const available = await mailboxes.getViewerMailboxes("actor");
  const loaded: string[] = [];
  const downloaded: string[] = [];
  const dependencies = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "operator" }) },
    "@/lib/data/mailboxes": { getViewerMailboxes: async () => available, mailboxHasImap: () => true },
    "@/lib/data/mailbox-sync": {
      mailboxSyncKey: (mailbox: WorkspaceMailboxRecord) => `key-${mailbox.id}`,
      loadMailboxMessageContent: async (mailbox: WorkspaceMailboxRecord): Promise<Partial<InboxEmailItem>> => {
        loaded.push(mailbox.id);
        return { id: "received", contact: "buyer@example.com", body: "A message" };
      },
    },
    "@/lib/data/email-access": { getAssignedEmailContacts: async () => null },
    "@/lib/email-access": { canViewEmail },
    "@/lib/mailbox-imap": { downloadMailboxAttachment: async (mailbox: WorkspaceMailboxRecord) => {
      downloaded.push(mailbox.id);
      return { filename: "test.txt", contentType: "text/plain", content: Buffer.from("test") };
    } },
  };
  const message = loadModule<{ GET: (request: Request) => Promise<Response> }>("../app/api/email/message/route.ts", dependencies);
  const attachment = loadModule<{ GET: (request: Request) => Promise<Response> }>("../app/api/email/received-attachment/route.ts", dependencies);
  for (const id of ["mine", "team", "someone-else"]) {
    const request = () => new Request(`http://localhost/api/email/message?mailbox=key-${id}&uid=1&validity=1&part=1`);
    const expected = id === "someone-else" ? 404 : 200;
    assert.equal((await message.GET(request())).status, expected);
    assert.equal((await attachment.GET(request())).status, expected);
  }
  assert.equal(loaded.join(","), "mine,team");
  assert.equal(downloaded.join(","), "mine,team");
});
