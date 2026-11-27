import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { websiteMessageThreads, mergeWebsiteThreads, type WebsiteMessageRow } from "../lib/messenger.ts";
import { defaultPortalDesign, portalDesignSchema, portalSectionEnabled } from "../lib/portal-design.ts";
const require = createRequire(import.meta.url);
const invoiceId = "717cd1d4-0739-4f3f-bbba-a331c7422f31";
const otherId = "cbe03dc4-0b5c-448c-b66a-e0379766d401";
const invoice = { id: invoiceId, number: 123, status: "issued", company_id: null, document: { customerName: "Portal buyer", customerEmail: "buyer@example.test" } };
const row = (id: string, sender: "customer" | "staff", minute: number, body = id): WebsiteMessageRow => ({ id, invoice_id: invoiceId, sender, body, created_at: "2026-11-27T00:" + String(minute).padStart(2, "0") + ":00.000Z", invoice });
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Response, console, require: (name: string) => name === "server-only" ? {} : deps[name] ?? require(name),
  });
  return exports;
}

test("portal messages map to website threads with both directions and independent invoice conversations", () => {
  const other = { ...invoice, id: otherId };
  const threads = websiteMessageThreads([row("new", "customer", 3), row("staff", "staff", 2), row("old", "customer", 1),
    { ...row("other-invoice", "customer", 4), invoice_id: otherId, invoice: other },
    { ...row("draft", "customer", 5), invoice: { ...invoice, status: "draft" } }, { ...row("missing", "customer", 6), invoice: null }]);
  assert.equal(threads.length, 2);
  const thread = threads.find((item) => item.invoiceId === invoiceId)!;
  assert.equal(thread.id, "web:" + invoiceId); assert.equal(thread.contextLabel, "INV-000123");
  assert.deepEqual(thread.messages.map((message) => message.direction), ["inbound", "outbound", "inbound"]);
  assert.equal(thread.lastMessage, "new"); assert.equal(thread.unread, 1);
  assert.equal(thread.replyWindowOpen, true); assert.equal(thread.replyWindowEndsAt, null);
});

test("read state and confirmed sends survive a stale snapshot without duplicate messages", () => {
  const before = websiteMessageThreads([row("in", "customer", 1)]);
  const after = websiteMessageThreads([row("in", "customer", 1), row("out", "staff", 2)]);
  const stale = mergeWebsiteThreads(after, before, { [before[0].id]: before[0].updatedAt });
  assert.equal(stale[0].unread, 0);
  assert.deepEqual(stale[0].messages.map((message) => message.id), ["in", "out"]);
  const canonical = mergeWebsiteThreads(stale, after, { [before[0].id]: before[0].updatedAt });
  assert.equal(canonical[0].messages.length, 2);
  const fresh = websiteMessageThreads([row("in", "customer", 1), row("out", "staff", 2), row("new", "customer", 3)]);
  assert.equal(mergeWebsiteThreads(canonical, fresh, { [before[0].id]: before[0].updatedAt })[0].unread, 1);
});

test("website reader uses existing workspace-scoped portal messages and published messaging settings", async () => {
  const queries: Array<{ table: string; method: string; args: unknown[] }> = [];
  const design = defaultPortalDesign();
  const db = { from(table: string) {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "neq", "order", "limit", "eq", "maybeSingle"]) query[method] = (...args: unknown[]) => { queries.push({ table, method, args }); return query; };
    query.then = (resolve: (value: unknown) => void) => resolve({ data: table === "customer_portal_messages" ? [row("from-portal", "customer", 1)] : { published: design }, error: null });
    return query;
  } };
  const readers = load("../lib/data/messenger.ts", { "../supabase/admin": { createSupabaseAdmin: () => db }, "../meta-messenger": {}, "../auth": {}, "../invoice-permissions": {}, "../portal-design": { defaultPortalDesign, portalDesignSchema, portalSectionEnabled }, "../messenger": { websiteMessageThreads } }) as { getWebsiteInboxData: () => Promise<{ connected: boolean; threads: unknown[] }> };
  assert.equal((await readers.getWebsiteInboxData()).connected, true);
  assert.ok(queries.some((query) => query.method === "select" && String(query.args[0]).includes("invoice:invoices!inner")));
  assert.ok(queries.some((query) => query.method === "neq" && query.args[0] === "invoice.status" && query.args[1] === "draft"));
  design.sections.find((section) => section.type === "messages")!.enabled = false;
  assert.equal((await readers.getWebsiteInboxData()).connected, false);
});

test("website feed requires staff access, marks viewer replies read-only, and never caches private messages", async () => {
  for (const role of ["", "viewer", "operator", "admin"]) {
    let reads = 0;
    const route = load("../app/api/messenger/website/route.ts", {
      "@/lib/invoice-api": { invoiceAccess: async () => role ? { viewer: { role } } : { response: Response.json({ error: "Sign in" }, { status: 401 }) } },
      "@/lib/data/messenger": { getWebsiteInboxData: async () => { reads++; return { connected: true, threads: [] }; } },
      "@/lib/invoice-permissions": { canCreateInvoices: (value: string) => value !== "viewer" },
    }) as { GET: () => Promise<Response> };
    const response = await route.GET();
    if (!role) { assert.equal(response.status, 401); assert.equal(reads, 0); }
    else { assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal((await response.json()).canReply, role !== "viewer"); }
  }
});

test("website feed failure returns an error instead of replacing valid conversations with an empty list", async () => {
  const route = load("../app/api/messenger/website/route.ts", {
    "@/lib/invoice-api": { invoiceAccess: async () => ({ viewer: { role: "admin" } }) },
    "@/lib/data/messenger": { getWebsiteInboxData: async () => { throw new Error("database unavailable"); } },
    "@/lib/invoice-permissions": {},
  }) as { GET: () => Promise<Response> };
  const response = await route.GET();
  assert.equal(response.status, 503);
  const body = await response.json(); assert.ok(body.error); assert.equal("threads" in body, false);
});

test("AI website context checks current customer assignment before reading conversation text", async () => {
  let messageReads = 0; let allowed = false;
  const db = { from(table: string) {
    if (table === "customer_portal_messages") messageReads++;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit", "maybeSingle"]) query[method] = () => query;
    query.then = (resolve: (value: unknown) => void) => resolve({ data: table === "invoices" ? { ...invoice, company_id: otherId, customer_name: "Buyer" } : [{ id: "private", sender: "customer", body: "Customer message", created_at: "2026-11-27T00:00:00Z" }], error: null });
    return query;
  } };
  class AccessError extends Error {}
  const records = load("../lib/ai/website-conversation.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../data/ai-settings": { requireAiData: async () => {} },
    "./customer-access.ts": { AiCustomerAccessError: AccessError, assertAiCustomerAccess: async () => { if (!allowed) throw new AccessError("Unassigned customer"); } },
  }) as { loadWebsiteConversationForAi: (id: string, viewer: { id: string; role: string }) => Promise<{ messages: Array<{ text: string }> }> };
  const viewer = { id: otherId, role: "operator" };
  await assert.rejects(records.loadWebsiteConversationForAi("web:" + invoiceId, viewer), /Unassigned customer/);
  assert.equal(messageReads, 0);
  allowed = true;
  assert.equal((await records.loadWebsiteConversationForAi("web:" + invoiceId, viewer)).messages[0].text, "Customer message");
});

