import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as companyEmail from "../lib/company-email.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

function fixture() {
  const message = { id: "private-source", uid: 42, uidValidity: 7, messageId: "<customer@test>", contact: "buyer@test", providerKind: "inbox", bodyLoaded: false } as InboxEmailItem;
  const original = { ...message, bodyLoaded: true, body: "Customer message", html: '<img src="/api/email/received-attachment?mailbox=key&amp;uid=42&amp;part=2">', attachments: [{ partId: "2", url: "/api/email/received-attachment?mailbox=key&uid=42&part=2" }] };
  let downloads = 0;
  const tables: Record<string, Record<string, unknown>[]> = {
    companies: [{ id: "company", name: "Customer" }], contacts: [{ id: "contact", company_id: "company", email: "buyer@test" }],
    pipeline: [{ company_id: "company", owner_id: "manager" }],
    workspace_mailboxes: [{ id: "other-staff", type: "personal", userId: "someone-else" }],
    mailbox_sync_state: [{ mailbox_key: "key", uid_validity: 7, messages: [message] }],
  };
  const db = { from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let single = false;
    const query = { select() { return query; }, order() { return query; }, range() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      maybeSingle() { single = true; return query; }, throwOnError() { return query; },
      then(resolve: (value: unknown) => unknown) {
        const rows = (tables[table] ?? []).filter(row => filters.every(([key, value]) => row[key] === value));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows }).then(resolve);
      } };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "../company-email.ts": companyEmail,
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
    "../mailbox-utils.ts": { normalizeMailboxRows: (rows: unknown) => rows },
    "./mailbox-sync.ts": { mailboxSyncKey: () => "key", savedProviderFolders: async () => [{ path: "Drafts", kind: "drafts" }], loadMailboxMessageContent: async () => { downloads++; return original; } },
  };
  const exports = {} as typeof import("../lib/data/company-email-access.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/company-email-access.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Map });
  const viewer = { id: "manager", role: "bd_manager" } as Parameters<typeof exports.getCompanyEmailScope>[0];
  return { ...exports, viewer, message, original, tables, source: { key: "key", uid: 42, validity: 7, folder: "INBOX" },
    downloads: () => downloads, reassign: () => { tables.pipeline[0].owner_id = "new-manager"; } };
}

test("company reader opens a colleague's exact customer email and scopes every inline download", async () => {
  const app = fixture();
  const result = await app.readCompanyMailboxEmail(app.viewer, "company", app.source);
  assert.equal(result?.email.body, "Customer message");
  assert.equal(result?.email.companyScopeId, "company");
  assert.match(result?.email.attachments?.[0].url ?? "", /companyId=company/);
  assert.match(result?.email.html ?? "", /&amp;companyId=company/);
  assert.equal(app.downloads(), 1);
});

test("a saved customer in CC authorizes the exact body and keeps the customer as its displayed contact", async () => {
  const app = fixture();
  for (const message of [app.message, app.original]) Object.assign(message, { contact: "staff@test", from: "staff@test", cc: [{ address: "buyer@test" }] });
  const result = await app.readCompanyMailboxEmail(app.viewer, "company", app.source);
  assert.equal(result?.email.contact, "buyer@test");
  assert.equal(app.downloads(), 1);
  app.original.cc = [{ address: "someone-else@test" }];
  assert.equal(await app.readCompanyMailboxEmail(app.viewer, "company", app.source), null, "The provider must still return the saved customer participant");
});

test("reassignment, nonexistent companies, wrong UIDs and old UIDVALIDITY cannot download personal content", async () => {
  for (const scenario of ["reassigned", "company", "uid", "validity"] as const) {
    const app = fixture();
    if (scenario === "reassigned") app.reassign();
    const source = { ...app.source, ...(scenario === "uid" ? { uid: 43 } : {}), ...(scenario === "validity" ? { validity: 8 } : {}) };
    assert.equal(await app.readCompanyMailboxEmail(app.viewer, scenario === "company" ? "someone-else" : "company", source), null);
    assert.equal(app.downloads(), 0);
  }
});

test("saved unrelated mail, removed messages and provider drafts are denied before hydration", async () => {
  for (const extra of [{ contact: "private@test" }, { providerRemoved: true }, { providerKind: "drafts" }]) {
    const app = fixture();
    Object.assign(app.message, extra);
    assert.equal(await app.readCompanyMailboxEmail(app.viewer, "company", app.source), null);
    assert.equal(app.downloads(), 0);
  }
  const app = fixture();
  assert.equal(await app.readCompanyMailboxEmail(app.viewer, "company", { ...app.source, folder: "Drafts" }), null);
  assert.equal(app.downloads(), 0);
});

test("provider content must still match the saved customer and Message-ID after authorization", async () => {
  for (const extra of [{ contact: "private@test" }, { messageId: "<other@test>" }]) {
    const app = fixture();
    Object.assign(app.original, extra);
    assert.equal(await app.readCompanyMailboxEmail(app.viewer, "company", app.source), null);
  }
});

test("an assigned company without email contacts opens an empty history instead of failing authorization", async () => {
  const app = fixture();
  app.tables.contacts = [];
  assert.equal((await app.getCompanyEmailScope(app.viewer, "company"))?.emails.length, 0);
  assert.equal(await app.readCompanyMailboxEmail(app.viewer, "company", app.source), null);
});

test("saving a staff mailbox as a company contact cannot expose that employee's unrelated correspondence", async () => {
  const app = fixture();
  app.tables.workspace_mailboxes[0].email = "BUYER@test";
  assert.equal((await app.getCompanyEmailScope(app.viewer, "company"))?.emails.length, 0);
  assert.equal(await app.readCompanyMailboxEmail(app.viewer, "company", app.source), null);
  assert.equal(app.downloads(), 0);
});
