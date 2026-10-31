import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as vocabulary from "../lib/customer-tags.ts";
import { emailInboxStateSchema } from "../lib/email-inbox-state.ts";
import { customerTagDataFixture } from "./helpers/customer-tags.ts";

type Row = Record<string, unknown>;
function fixture() {
  const db: Record<string, Row[]> = { contacts: [{ email: "buyer@example.test", company_id: "company-a" }], crm_email_tags: [], email_inbox_state: [] };
  const writes: string[] = [];
  const client = { from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let single = false, payload: Row | Row[] | null = null, keys = "", start = 0, end = 499;
    const query = {
      select() { return query; }, order() { return query; }, limit() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      maybeSingle() { single = true; return query; },
      range(from: number, to: number) { start = from; end = to; return query; },
      upsert(row: Row | Row[], options: { onConflict: string }) { payload = row; keys = options.onConflict; return query; },
      then(resolve: (value: unknown) => void) {
        if (payload) {
          writes.push(table);
          for (const input of Array.isArray(payload) ? payload : [payload]) {
            const existing = db[table].find(row => keys.split(",").every(key => row[key] === input[key]));
            if (existing) Object.assign(existing, input); else db[table].push(input);
          }
        }
        const rows = db[table].filter(row => filters.every(([key, value]) => row[key] === value)).slice(start, end + 1);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
      },
    };
    return query;
  } };
  const data = customerTagDataFixture(() => client) as typeof import("../lib/data/customer-tags.ts");
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-state.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => name === "./customer-tags.ts" ? data : name === "../customer-tags.ts" ? vocabulary : { createSupabaseAdmin: () => client }, Date, Map });
  return { data, state: exports as typeof import("../lib/data/email-state.ts"), db, writes };
}

test("the ten named tags have unique colors; company aggregation retains every distinct tag", () => {
  assert.equal(vocabulary.customerTags.length, 10);
  assert.equal(new Set(vocabulary.customerTags.map(tag => tag.className)).size, 10);
  assert.equal(vocabulary.customerTags[0].name, "Prospect Nurturing");
  assert.equal(vocabulary.customerTags[9].name, "Postponed Purchasing");
  assert.deepEqual(vocabulary.uniqueCustomerTags(["Repeat Customers", "New Inquiries", "Repeat Customers", "PLA", null]), ["New Inquiries", "Repeat Customers"]);
});

test("CRM, sent mail and provider copies share a tag key without merging different emails in one thread", () => {
  const keys = ["crm-123", "sent-456", "imap-<PRODUCT@Buyer.test>"].map(id => vocabulary.emailTagMessageKey({ id, messageId: "<PRODUCT@Buyer.test>" }));
  assert.equal(new Set(keys).size, 1);
  assert.notEqual(keys[0], vocabulary.emailTagMessageKey({ id: "crm-456", messageId: "<order@buyer.test>" }));
  assert.equal(vocabulary.emailTagMessageKey({ id: "no-message-id" }), "no-message-id");
});

test("every new tag validates and legacy read-state writes cannot implicitly replace a shared tag", async () => {
  const app = fixture();
  const state = { messageKey: "crm-1", tagMessageKey: "imap-<first@example.test>", contactEmail: "buyer@example.test", category: "Orders in Fulfillment", categoryWrite: true, starred: false, read: true, folder: "inbox", followUpAt: null };
  for (const category of vocabulary.customerTagValues) assert.equal(emailInboxStateSchema.safeParse({ ...state, category }).success, true);
  assert.equal(emailInboxStateSchema.safeParse({ ...state, category: "invented" }).success, false);
  await app.state.saveEmailInboxState("staff-a", emailInboxStateSchema.parse(state));
  await app.state.saveEmailInboxState("staff-b", emailInboxStateSchema.parse({ ...state, category: null, categoryWrite: false, starred: true }));
  assert.equal(app.db.crm_email_tags.length, 1);
  assert.equal(app.db.crm_email_tags[0].tag, "Orders in Fulfillment");
  assert.equal(app.db.crm_email_tags[0].company_id, "company-a");
  assert.equal(app.writes.filter(table => table === "crm_email_tags").length, 1);
  assert.equal((await app.state.listEmailInboxStates("staff-b")).get(state.tagMessageKey)?.category, "Orders in Fulfillment");
});

test("different messages retain different tags; removing one assignment leaves other company situations intact", async () => {
  const app = fixture();
  await app.data.saveSharedEmailTag({ messageKey: "order", tag: "Orders in Fulfillment", contactEmail: "buyer@example.test" });
  await app.data.saveSharedEmailTag({ messageKey: "inquiry", tag: "New Inquiries", contactEmail: "buyer@example.test" });
  await app.data.saveSharedEmailTag({ messageKey: "another-inquiry", tag: "New Inquiries", contactEmail: "buyer@example.test" });
  assert.deepEqual(vocabulary.uniqueCustomerTags(app.db.crm_email_tags.map(row => row.tag)), ["New Inquiries", "Orders in Fulfillment"]);
  await app.data.saveSharedEmailTag({ messageKey: "order", tag: null });
  assert.deepEqual(vocabulary.uniqueCustomerTags(app.db.crm_email_tags.map(row => row.tag)), ["New Inquiries"]);
  assert.equal((await app.data.listSharedEmailTags()).get("order"), null);
});

test("one subject tag persists across replies while a separate conversation keeps its own situation", async () => {
  const app = fixture();
  const original = { id: "root", messageId: "<root@buyer.test>", direction: "inbound" as const, subject: "Product inquiry", contact: "buyer@example.test", timestamp: "2026-10-30T01:00:00Z", category: "Active Negotiations" as const };
  const reply = { ...original, id: "reply", messageId: "<reply@buyer.test>", inReplyTo: original.messageId, references: [original.messageId], direction: "outbound" as const, timestamp: "2026-10-30T02:00:00Z" };
  const other = { ...original, id: "other", messageId: "<other@buyer.test>", subject: "Another product inquiry", category: "Orders in Fulfillment" as const };
  await app.data.saveSharedEmailTag({ messageKey: vocabulary.emailTagMessageKey(original), tag: original.category, contactEmail: original.contact });
  await app.data.saveSharedEmailTag({ messageKey: vocabulary.emailTagMessageKey(other), tag: other.category, contactEmail: other.contact });
  const keys = vocabulary.conversationTagKeys([original, reply]);
  await app.data.saveSharedEmailTag({ messageKey: keys[0], conversationKeys: keys, messageKeys: [original, reply].map(vocabulary.emailTagMessageKey), tag: "New Inquiries", contactEmail: original.contact });
  const future = { ...reply, id: "future", messageId: "<future@buyer.test>", timestamp: "2026-10-31T01:00:00Z", category: null };
  const states = await app.state.listEmailInboxStates("staff-a");
  const shown = vocabulary.applyConversationCustomerTags([original, reply, future, other], states);
  assert.deepEqual(shown.map(email => email.category), ["New Inquiries", "New Inquiries", "New Inquiries", "Orders in Fulfillment"]);
  assert.deepEqual(vocabulary.applyConversationCustomerTags([future], states).map(email => email.category), ["New Inquiries"], "a newly loaded reply can resolve its root without loading the entire history");
  assert.deepEqual(vocabulary.uniqueCustomerTags(app.db.crm_email_tags.map(row => row.tag)), ["New Inquiries", "Orders in Fulfillment"]);
  await app.data.saveSharedEmailTag({ messageKey: keys[0], conversationKeys: keys, messageKeys: [original, reply].map(vocabulary.emailTagMessageKey), tag: null, contactEmail: original.contact });
  assert.equal(vocabulary.applyConversationCustomerTags([original, reply, future], await app.state.listEmailInboxStates("staff-b"))[0].category, null, "clearing the subject tag cannot resurrect an old message-level tag");
});

test("matching subject text from the same customer does not combine independent conversations", () => {
  const base = { direction: "inbound" as const, subject: "Pricing", contact: "buyer@example.test", timestamp: "2026-10-30T01:00:00Z" };
  const first = { ...base, id: "first", messageId: "<first@buyer.test>" };
  const second = { ...base, id: "second", messageId: "<second@buyer.test>" };
  const states = new Map([[vocabulary.conversationTagKeys([first])[0], { category: "New Inquiries" as const }], [vocabulary.conversationTagKeys([second])[0], { category: "Payment Follow-up" as const }]]);
  assert.deepEqual(vocabulary.applyConversationCustomerTags([first, second], states).map(email => email.category), ["New Inquiries", "Payment Follow-up"]);
});

test("the state endpoint blocks read-only tag edits and enrolls changes using the shared email identity", async () => {
  let role = "viewer", writes = 0;
  const enrollments: Row[] = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/email-inbox-state": { emailInboxStateSchema },
    "@/lib/customer-tags": vocabulary,
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "staff", role }) },
    "@/lib/data/email-state": { saveEmailInboxState: async (_id: string, state: Row) => { writes++; return { categoryChanged: state.categoryWrite }; } },
    "@/lib/data/flow-runtime": { enrollMatchingFlows: async (event: Row) => { enrollments.push(event); return []; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "contact", company_id: "company" } }) }) }) }) }) },
  };
  const exports = {} as { POST: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/state/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => dependencies[name], Response });
  const state = { messageKey: "crm-copy", tagMessageKey: "imap-<shared@example.test>", category: "New Inquiries", categoryWrite: true, contactEmail: "buyer@example.test", starred: false, read: true, folder: "inbox", followUpAt: null };
  const post = (body: Row) => exports.POST(new Request("http://localhost/api/email/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await post(state)).status, 403);
  assert.equal(writes, 0);
  role = "operator";
  assert.equal((await post({ ...state, category: "Big order" })).status, 400);
  assert.equal((await post(state)).status, 200);
  assert.equal(enrollments[0].messageKey, state.tagMessageKey);
  assert.equal((await post({ ...state, categoryWrite: false, starred: true })).status, 200);
  assert.equal(enrollments.length, 1);
});
