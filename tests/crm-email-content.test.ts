import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { canViewEmail } from "../lib/email-access.ts";
import * as content from "../lib/email-content.ts";
import * as markup from "../lib/email-markup.ts";
import * as threading from "../lib/email-threading.ts";

function setup(assigned = true, originalContact = "buyer@example.test", originalMessageId = "<specific@test>") {
  const reads: string[] = [];
  const rawUrl = "/api/email/received-attachment?mailbox=private-key&uid=42&part=7";
  const original = { direction: "inbound", contact: originalContact, messageId: originalMessageId, body: "Original body", html: `<p>Original<img src="${rawUrl.replaceAll("&", "&amp;")}"></p>`, attachments: [{ partId: "7", cid: "icon", contentType: "application/octet-stream", url: rawUrl, filename: "icon", size: 123 }] };
  const row = { id: "00000000-0000-4000-8000-000000000001", message_id: "<specific@test>", owner_id: "manager", subject: "Customer reply", body: "[cid:icon]", thread_id: "thread", created_at: "2026-10-30", contacts: { email: "buyer@example.test" } };
  function from(table: string) {
    reads.push(table);
    let single = false;
    const query = { select() { return query; }, eq() { return query; },
      maybeSingle() { single = true; return query; }, throwOnError() { return query; },
      or(value: string) { assert.equal(value, "type.eq.workspace,user_id.eq.manager"); return query; },
      in(_column: string, values: string[]) { assert.deepEqual([...values], ["allowed-key"]); return query; }, limit() { return query; }, contains() { return query; },
      then(resolve: (value: unknown) => unknown) {
        const data = table === "emails" ? row : table === "workspace_mailboxes" ? [{ id: "owner-mailbox", imapHost: "imap.test", imapUsername: "manager", imapPassword: "fixture" }] : table === "mailbox_message_content" ? [{ mailbox_key: "allowed-key", uid: 42, uid_validity: 1, content: original }] : [];
        return Promise.resolve({ data: single ? data : data, error: null }).then(resolve);
      } };
    return query;
  }
  const dependencies: Record<string, unknown> = {
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from }) },
    "../email-access.ts": { canViewEmail }, "./email-access.ts": { getAssignedEmailContacts: async () => assigned ? new Map([["buyer@example.test", "company"]]) : new Map() },
    "../mailbox-utils.ts": { normalizeMailboxRow: (row: unknown) => row }, "../email-threading.ts": threading,
    "../email-content.ts": content, "../email-markup.ts": markup,
    "./mailbox-sync.ts": { mailboxSyncKey: () => "allowed-key", savedProviderFolders: async () => [], loadMailboxMessageContent: async () => original },
  };
  const exports = {} as { readCrmReceivedEmail: (viewer: unknown, id: string) => Promise<{ email: Record<string, unknown>; source: unknown } | null> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/crm-email-content.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; }, Map, encodeURIComponent });
  return { ...exports, reads, row };
}

test("a saved CRM reply recovers original HTML and attachment links without exposing personal mailbox locators", async () => {
  const app = setup();
  const result = await app.readCrmReceivedEmail({ id: "viewer", role: "bd_manager" }, app.row.id);
  assert.ok(result);
  assert.equal(result.email.id, app.row.id);
  assert.equal(result.email.bodyLoaded, true);
  assert.match(String(result.email.html), /\/api\/email\/crm-attachment\?id=/);
  assert.doesNotMatch(JSON.stringify(result.email), /private-key|owner-mailbox|received-attachment|imapPassword/);
  assert.equal(result.email.mailboxKey, undefined);
  assert.equal(result.email.uid, undefined);
});
test("unassigned BD managers are denied before any personal mailbox or cache lookup", async () => {
  const app = setup(false);
  assert.equal(await app.readCrmReceivedEmail({ id: "other-manager", role: "bd_manager" }, app.row.id), null);
  assert.deepEqual(app.reads, ["emails"]);
});
test("mismatched Message-ID or sender never substitutes unrelated personal email", async () => {
  for (const [contact, id] of [["other@example.test", "<specific@test>"], ["buyer@example.test", "<private@test>"]]) {
    const app = setup(true, contact, id);
    const result = await app.readCrmReceivedEmail({ id: "viewer", role: "admin" }, app.row.id);
    assert.equal(result?.source, null);
    assert.equal(result?.email.body, "[cid:icon]");
    assert.equal(result?.email.html, null);
  }
});
