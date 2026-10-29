import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as mailboxUtils from "../lib/mailbox-utils.ts";
import * as threading from "../lib/email-threading.ts";
import { canViewEmail } from "../lib/email-access.ts";
import { synchronizeMailbox } from "../lib/mailbox-sync.ts";
import * as emailContent from "../lib/email-content.ts";
import type { EmailInboxBackendData, InboxEmailItem } from "../lib/email-inbox.ts";
import type { WorkspaceMailboxRecord } from "../lib/data/mailboxes.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

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
    "@/lib/data/email-auto-reply": { stopAutoReplyForManualSend: async () => undefined },
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

async function setupInbox(role = "operator", assignedContacts: Map<string, string> | null = null) {
  const setupData = setup();
  const mailboxes = (await setupData.mailboxes.getViewerMailboxes("actor")).map((mailbox) => ({
    ...mailbox, imapHost: "imap.example.test", imapUsername: mailbox.email, imapPassword: "test-only",
  }));
  const synced: string[] = [];
  const sentScopes: string[] = [];
  const reads: string[] = [];
  const counts = { auth: 0, mailboxes: 0 };
  const viewer: WorkspaceViewer = { id: "actor", role: role as WorkspaceViewer["role"], email: null, displayName: null };
  const backend = loadModule<{ getEmailInboxBackendData: (options?: { mailboxId?: string; syncMailbox?: boolean; context?: { viewer: WorkspaceViewer; mailboxes: WorkspaceMailboxRecord[] } }) => Promise<EmailInboxBackendData> }>("../lib/email-inbox.ts", {
    "./auth.ts": { requireWorkspaceMember: async () => { counts.auth++; return viewer; } },
    "./mailbox-utils.ts": mailboxUtils,
    "./email-threading.ts": threading,
    "./email-access.ts": { canViewEmail },
    "./data/email-access.ts": { getAssignedEmailContacts: async () => { reads.push("assignments"); return assignedContacts; } },
    "./data/mailboxes.ts": {
      getViewerMailboxes: async () => { counts.mailboxes++; return mailboxes; },
      mailboxHasSmtp: setupData.mailboxes.mailboxHasSmtp,
      mailboxHasImap: (mailbox: WorkspaceMailboxRecord | null) => Boolean(mailbox?.isActive && mailbox.imapPassword),
    },
    "./data/inbox-companies.ts": { listInboxCompanies: async () => { reads.push("companies"); return { companies: [] }; } },
    "./data/crm.ts": {
      listCompanies: async () => { reads.push("companies"); return { companies: [] }; },
      listEmailDrafts: async (authorizedViewer: WorkspaceViewer) => { assert.equal(authorizedViewer, viewer); reads.push("drafts"); return { emails: [{ id: "workspace-draft", subject: "Outreach", contact: "lead@example.com", preview: "Hello", step: 1, status: "Draft" }], mode: "live" }; },
      listReplies: async (authorizedViewer: WorkspaceViewer) => { assert.equal(authorizedViewer, viewer); reads.push("replies"); return { replies: [{ id: "workspace-reply", contact: "lead@example.com", body: "Shared reply" }] }; },
    },
    "./data/email-state.ts": {
      listEmailInboxStates: async () => new Map(),
      listSentMailboxMessages: async (_viewerId: string, mailboxId: string) => {
        sentScopes.push(mailboxId);
        return [{ id: `sent-${mailboxId}`, mailboxId, direction: "outbound", contact: "buyer@example.com", company: "Buyer", subject: "Sent", body: "Hello", timestamp: "2026-10-27T00:00:00Z" }];
      },
      getEmailAutomationSettings: async () => ({ enabled: false, steps: [], queueCount: 0 }),
    },
    "./data/mailbox-sync.ts": { loadSyncedMailbox: async (mailbox: WorkspaceMailboxRecord, options: { sync: boolean; includeContent: boolean }) => {
      assert.equal(options.sync, false);
      assert.equal(options.includeContent, false);
      synced.push(mailbox.id);
      return { messages: [{ id: `received-${mailbox.id}`, source: "mailbox", contact: "buyer@example.com", body: "Hello" }], error: null, syncedAt: null };
    } },
    "./supabase/admin.ts": { createSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: [], error: null }) }) }) }) }) }) },
  });
  return { backend, synced, sentScopes, reads, counts, context: { viewer, mailboxes } };
}

test("an authorized route context avoids repeated auth and mailbox queries while validating the selected ID", async () => {
  const { backend, context, counts } = await setupInbox();
  const data = await backend.getEmailInboxBackendData({ mailboxId: "team", syncMailbox: false, context });
  assert.equal(data.selectedMailboxId, "team");
  assert.deepEqual(counts, { auth: 0, mailboxes: 0 });
  await assert.rejects(backend.getEmailInboxBackendData({ mailboxId: "someone-else", syncMailbox: false, context }), /Mailbox unavailable/);
});

test("switching inbox accounts scopes received and sent mail while retaining the personal sender default", async () => {
  const { backend, synced, sentScopes, reads } = await setupInbox();
  const personal = await backend.getEmailInboxBackendData({ syncMailbox: false });
  assert.equal(personal.selectedMailboxId, "mine");
  assert.equal(personal.emails.map((message) => message.id).sort().join(","), "received-mine,sent-mine");
  assert.deepEqual(reads, ["companies"], "Personal inbox must skip the workspace outreach queries");
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

test("workspace mail hidden by customer assignments reports its scope and skips company enrichment", async () => {
  const { backend, reads } = await setupInbox("bd_manager", new Map());
  const data = await backend.getEmailInboxBackendData({ mailboxId: "team", syncMailbox: false });
  assert.equal(data.assignedCustomersOnly, true);
  assert.equal(data.emails.length, 0);
  assert.equal(data.inboxError, null);
  assert.equal(reads.includes("companies"), false);
});

test("personal inbox and sent history show unassigned senders without querying assignments", async () => {
  const { backend, reads } = await setupInbox("bd_manager", new Map());
  const data = await backend.getEmailInboxBackendData({ mailboxId: "mine", syncMailbox: false });
  assert.equal(data.assignedCustomersOnly, false);
  assert.equal(data.emails.map((message) => message.id).sort().join(","), "received-mine,sent-mine");
  assert.equal(data.inboxError, null);
  assert.equal(reads.includes("assignments"), false);
  assert.equal(reads.includes("drafts"), false);
  assert.equal(reads.includes("replies"), false);
});

test("assigned BD customer mail remains visible in either account", async () => {
  const { backend } = await setupInbox("bd_manager", new Map([["buyer@example.com", "company-a"]]));
  for (const mailboxId of ["mine", "team"]) {
    const data = await backend.getEmailInboxBackendData({ mailboxId, syncMailbox: false });
    assert.equal(data.emails.map((message) => message.id).sort().join(","), `received-${mailboxId},sent-${mailboxId}`);
    if (mailboxId === "team") assert.ok(data.emails.every((message) => message.companyId === "company-a"));
  }
});

test("header-only saved inbox reads never query cached message bodies or contact IMAP", async () => {
  const tables: string[] = [];
  const loader = loadModule<{ loadSyncedMailbox: (mailbox: WorkspaceMailboxRecord, options: { sync: boolean; includeContent: boolean }) => Promise<{ messages: InboxEmailItem[] }> }>("../lib/data/mailbox-sync.ts", {
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from: (table: string) => {
      tables.push(table);
      assert.equal(table, "mailbox_sync_state", "List requests must not download cached HTML content");
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
        messages: [{ id: "received", uid: 5, uidValidity: 1, contact: "buyer@example.com", bodyLoaded: false, body: "" }],
        uid_validity: 1, last_uid: 5, synced_at: "2026-10-28T00:00:00Z", last_error: null,
      }, error: null }) }) }) };
    } }) },
    "../mailbox-sync.ts": { synchronizeMailbox },
    "../email-content.ts": emailContent,
    "../email-inbox.ts": { fetchMailboxInboxMessages: () => { assert.fail("Saved inbox reads must not contact IMAP"); } },
  });
  const mailbox = (await setup().mailboxes.getViewerMailboxes("actor"))[0];
  const result = await loader.loadSyncedMailbox(mailbox, { sync: false, includeContent: false });
  assert.deepEqual(tables, ["mailbox_sync_state"]);
  assert.equal(result.messages[0].bodyLoaded, false);
  assert.match(result.messages[0].mailboxKey!, /^[a-f0-9]{64}$/);
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

test("BD managers can open all personal message bodies and received attachments while workspace mail stays scoped", async () => {
  const available = await setup().mailboxes.getViewerMailboxes("actor");
  let assigned = new Map<string, string>();
  let assignmentReads = 0;
  const downloaded: string[] = [];
  const dependencies = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "bd_manager" }) },
    "@/lib/data/mailboxes": { getViewerMailboxes: async () => available, mailboxHasImap: () => true },
    "@/lib/data/mailbox-sync": {
      mailboxSyncKey: (mailbox: WorkspaceMailboxRecord) => `key-${mailbox.id}`,
      loadMailboxMessageContent: async () => ({ id: "message", contact: "unknown@example.com", body: "Personal mail" }),
    },
    "@/lib/data/email-access": { getAssignedEmailContacts: async () => { assignmentReads++; return assigned; } },
    "@/lib/email-access": { canViewEmail },
    "@/lib/mailbox-imap": { downloadMailboxAttachment: async (mailbox: WorkspaceMailboxRecord) => {
      downloaded.push(mailbox.id);
      return { filename: "test.txt", contentType: "text/plain", content: Buffer.from("test") };
    } },
  };
  const routes = ["message", "received-attachment"].map((name) => loadModule<{ GET: (request: Request) => Promise<Response> }>(`../app/api/email/${name}/route.ts`, dependencies));
  const request = (mailbox: string) => new Request(`http://localhost/api/email/message?mailbox=key-${mailbox}&uid=1&validity=1&part=1`);
  for (const route of routes) assert.equal((await route.GET(request("mine"))).status, 200);
  assert.equal(assignmentReads, 0, "Personal mailbox content must not depend on customer assignments");
  for (const route of routes) {
    assert.equal((await route.GET(request("team"))).status, 404);
    assert.equal((await route.GET(request("someone-else"))).status, 404);
  }
  assert.equal(downloaded.join(","), "mine");
  assigned = new Map([["unknown@example.com", "assigned-company"]]);
  for (const route of routes) assert.equal((await route.GET(request("team"))).status, 200);
  assert.equal(downloaded.join(","), "mine,team");
});

test("sent attachments use the message's actual personal or workspace mailbox and enforce ownership", async () => {
  const id = "12345678-1234-1234-1234-123456789012";
  const message = {
    user_id: "actor", mailbox_id: "mine" as string | null, to_email: "unknown@example.com",
    attachments: [{ path: `actor/${id}/0`, filename: "invoice.pdf", contentType: "application/pdf" }],
  };
  let assigned = new Map<string, string>();
  let assignmentReads = 0;
  let downloads = 0;
  const db = {
    from: (table: string) => {
      assert.equal(table, "mailbox_sent_messages");
      const query = { select: () => query, eq: (field: string, value: string) => {
        assert.equal(value, field === "id" ? id : "actor");
        return query;
      }, maybeSingle: async () => ({ data: message.user_id === "actor" ? message : null, error: null }) };
      return query;
    },
    storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(["%PDF-test"]), error: null }; } }) },
  };
  const route = loadModule<{ GET: (request: Request, context: { params: Promise<{ id: string; index: string }> }) => Promise<Response> }>("../app/api/email/attachments/[id]/[index]/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "bd_manager" }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/data/email-access": { getAssignedEmailContacts: async () => { assignmentReads++; return assigned; } },
    "@/lib/email-access": { canViewEmail },
    "@/lib/data/mailboxes": setup().mailboxes,
  });
  const download = () => route.GET(new Request("http://localhost/api/email/attachments/test/0"), { params: Promise.resolve({ id, index: "0" }) });
  assert.equal((await download()).status, 200);
  assert.equal(assignmentReads, 0);
  for (const mailboxId of ["team", "someone-else", "removed", null]) {
    message.mailbox_id = mailboxId;
    assert.equal((await download()).status, 404);
  }
  assert.equal(downloads, 1);
  message.mailbox_id = "team";
  assigned = new Map([["unknown@example.com", "assigned-company"]]);
  assert.equal((await download()).status, 200);
  message.mailbox_id = "mine";
  message.user_id = "someone-else";
  assert.equal((await download()).status, 404);
  assert.equal(downloads, 2);
});
