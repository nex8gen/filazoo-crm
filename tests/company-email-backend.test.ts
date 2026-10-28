import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { filterCompanyEmails } from "../lib/company-email.ts";
import { normalizeMessageId } from "../lib/email-threading.ts";
import type { EmailInboxBackendData, InboxEmailItem } from "../lib/email-inbox.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";
import type { WorkspaceMailboxRecord } from "../lib/data/mailboxes.ts";

const company = { id: "gantri", name: "Gantri", emails: ["buyer@example.test", "accounts@example.test"] };
function item(id: string, contact = "buyer@example.test", extra: Partial<InboxEmailItem> = {}): InboxEmailItem {
  return { id, contact, company: "Gantri", direction: "inbound", source: "mailbox", subject: "Enquiry", status: "Received", body: "", preview: "", timestamp: "2026-10-23T00:00:00Z", ...extra };
}

function setup({ empty = false, denied = false } = {}) {
  const viewer = { id: "actor", role: "bd_manager" } as WorkspaceViewer;
  const mailboxes = (empty ? [] : [{ id: "mine", type: "personal", userId: "actor" }, { id: "team", type: "workspace" }]) as WorkspaceMailboxRecord[];
  const reads: Array<string | undefined> = [];
  const messages: Record<string, InboxEmailItem[]> = {
    mine: [item("personal-only"), item("personal-copy", "buyer@example.test", { messageId: "<Copy@example.test>" }), item("unrelated", "stranger@example.test")],
    team: [item("workspace-only"), item("workspace-copy", "buyer@example.test", { messageId: "<copy@example.test>" }), item("sent", "accounts@example.test", { direction: "outbound", mailboxId: "team" })],
  };
  const snapshot = (id?: string): EmailInboxBackendData => ({
    selectedMailboxId: id ?? null, defaultSenderId: "mine", defaultMailboxEmail: "me@example.test", mailboxes: [],
    mode: "live", inboxConfigured: id === "team", sendConfigured: true, mailboxConfigured: id === "team",
    inboxError: id === "mine" ? "Personal sync unavailable" : null, aiConfigured: false, assignedCustomersOnly: id === "team",
    emails: messages[id ?? ""] ?? [], automation: { enabled: false, steps: [], queueCount: 0 },
  });
  const dependencies: Record<string, unknown> = {
    "../auth.ts": { requireWorkspaceMember: async () => { if (denied) throw new Error("Unauthorized"); return viewer; } },
    "../company-email.ts": { filterCompanyEmails }, "../email-threading.ts": { normalizeMessageId },
    "./mailboxes.ts": { getViewerMailboxes: async (id: string) => { assert.equal(id, viewer.id); return mailboxes; } },
    "../email-inbox.ts": { getEmailInboxBackendData: async (options: { mailboxId?: string; syncMailbox: boolean; context: { viewer: WorkspaceViewer; mailboxes: WorkspaceMailboxRecord[] } }) => {
      assert.equal(options.syncMailbox, false);
      assert.equal(options.context.viewer, viewer);
      assert.equal(options.context.mailboxes, mailboxes);
      reads.push(options.mailboxId);
      return snapshot(options.mailboxId);
    } },
  };
  const exports = {} as typeof import("../lib/data/company-emails.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/company-emails.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => dependencies[name] });
  return { ...exports, reads, context: { viewer, mailboxes } };
}

test("company history includes personal and workspace correspondence despite the personal default", async () => {
  const backend = setup();
  const data = await backend.getCompanyEmailBackendData(company);
  assert.deepEqual(backend.reads, ["mine", "team"]);
  assert.equal(data.emails.map((email) => email.id).sort().join(","), "personal-copy,personal-only,sent,workspace-only");
  assert.equal(data.emails.find((email) => email.id === "workspace-only")?.mailboxId, "team");
  assert.equal(data.emails.find((email) => email.id === "personal-only")?.mailboxId, "mine");
  assert.equal(data.selectedMailboxId, null);
  assert.equal(data.defaultSenderId, "mine");
  assert.equal(data.inboxConfigured, true, "The company can refresh when any authorized inbox is configured");
  assert.equal(data.inboxError, "Personal sync unavailable");
});

test("authorized refresh context is reused and empty contacts never reveal other customers", async () => {
  const backend = setup({ denied: true });
  const data = await backend.getCompanyEmailBackendData({ ...company, emails: [] }, backend.context);
  assert.equal(data.emails.length, 0);
  assert.deepEqual(backend.reads, ["mine", "team"]);
});

test("company history authenticates before reading accounts", async () => {
  const backend = setup({ denied: true });
  await assert.rejects(backend.getCompanyEmailBackendData(company), /Unauthorized/);
  assert.equal(backend.reads.length, 0);
});

test("companies without connected mailboxes still load CRM history safely", async () => {
  const backend = setup({ empty: true });
  const data = await backend.getCompanyEmailBackendData(company);
  assert.deepEqual(backend.reads, [undefined]);
  assert.equal(data.emails.length, 0);
  assert.equal(data.inboxConfigured, false);
});
