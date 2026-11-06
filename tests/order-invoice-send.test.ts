import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { blankInvoiceDocument, type Invoice } from "../lib/invoices.ts";
import { invoiceSendSchema } from "../lib/invoice-send.ts";
import { canManageBilling } from "../lib/invoice-permissions.ts";
import { purchaseOrderActions } from "../lib/purchase-order-summary.ts";
import { purchaseOrderCommercialDetailsLocked, blankPurchaseOrder } from "../lib/purchase-order-draft.ts";
import type { PurchaseOrder } from "../lib/purchase-orders.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = { requestId, revision: 2, mailboxId: "mailbox", to: "buyer@example.test", subject: "Your invoice", text: "Please see the attached invoice." };
const invoice: Invoice = { id, number: 1001, status: "issued", total_minor: 1234, paid_minor: 0, revision: 2, created_by: id, created_at: "2026-11-06T00:00:00Z", updated_at: "2026-11-06T00:00:00Z", document: { ...blankInvoiceDocument("2026-11-06"), customerName: "Test buyer", companyId: id, purchaseOrderId: id } };
const require = createRequire(import.meta.url);

function route(options: { forbidden?: boolean; invoice?: Invoice | null; latest?: Invoice; duplicate?: string; deliveryError?: string; trackingError?: boolean } = {}) {
  let reads = 0, renders = 0, deliveries = 0, reservations = 0;
  const updates: string[] = [], invalidated: string[] = [];
  const query = {
    update() { return query; }, insert() { if (options.trackingError) throw new Error("Tracking offline"); return query; },
    select() { return query; }, eq() { return query; },
    maybeSingle() { return query; }, throwOnError() { return Promise.resolve({ data: { status: "uncertain" } }); },
    then(resolve: (value: unknown) => void) { return Promise.resolve({ error: null }).then(resolve); },
  };
  const deps: Record<string, unknown> = {
    zod: { z: require("zod").z },
    "next/cache": { revalidatePath: (path: string) => invalidated.push(path) },
    "@/lib/invoice-api": {
      invoiceAccess: async () => options.forbidden ? { response: Response.json({ error: "Denied" }, { status: 403 }) } : { viewer: { id, role: "admin" } },
      checkInvoiceOrigin: (request: Request) => request.headers.get("origin") === "https://evil.test" ? Response.json({ error: "Invalid origin" }, { status: 403 }) : undefined,
      invoiceError: (error: { message?: string }) => Response.json({ error: error.message }, { status: 409 }),
    },
    "@/lib/data/invoices": { getInvoice: async () => { reads++; return reads > 1 && options.latest ? options.latest : options.invoice === undefined ? invoice : options.invoice; } },
    "@/lib/data/mailboxes": { getViewerMailbox: async () => ({ id: "mailbox", email: "sender@example.test" }), getViewerMailboxes: async () => [{ id: "mailbox", email: "sender@example.test", smtpPassword: "never return", smtpUsername: "private" }], mailboxHasSmtp: () => true },
    "@/lib/data/manual-email-send": { deliverEmail: async (_viewer: unknown, message: { requestId: string; attachments: { content: string }[] }, reserved: boolean) => {
      deliveries++;
      assert.equal(reserved, true);
      assert.equal(message.requestId, requestId);
      assert.equal(message.attachments[0].content, Buffer.from("PDF").toString("base64"));
      return options.deliveryError ? Response.json({ ok: false, error: options.deliveryError }, { status: 500 }) : Response.json({ ok: true, saved: true, email: { timestamp: "2026-11-06T00:00:00Z" } });
    } },
    "@/lib/data/email-delivery": {
      reserveEmailSend: async (_viewer: unknown, message: Record<string, unknown>) => {
        reservations++;
        assert.equal(message.invoiceId, id);
        assert.equal(message.invoiceRevision, input.revision);
        assert.deepEqual(JSON.parse(JSON.stringify(message.attachments)), []);
        return options.duplicate ? { reserved: false, operation: { status: options.duplicate, result: options.duplicate === "sent" ? { ok: true, replayed: true } : null } } : { reserved: true };
      },
      updateEmailSend: async (_user: string, _request: string, status: string) => updates.push(status),
    },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => query }) },
    "@/lib/invoice-pdf": { renderInvoicePdf: async () => { renders++; return Buffer.from("PDF"); } },
    "@/lib/invoice-pdf-meta": { invoicePdfFilename: () => "INV-001001.pdf" },
    "@/lib/invoice-send": { invoiceSendSchema }, "@/lib/invoice-permissions": { canManageBilling },
  };
  const exports: { GET?: (request: Request, context: unknown) => Promise<Response>; POST?: (request: Request, context: unknown) => Promise<Response> } = {};
  const source = readFileSync(new URL("../app/api/invoices/[id]/send/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`); return deps[name]; }, Request, Response, Intl, Date, Error });
  return { post: (body: unknown = input, origin = "http://localhost:3000") => exports.POST!(new Request(`http://localhost:3000/api/invoices/${id}/send`, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) }),
    get: () => exports.GET!(new Request(`http://localhost:3000/api/invoices/${id}/send`), { params: Promise.resolve({ id }) }),
    counts: () => ({ reads, renders, deliveries, reservations }), updates, invalidated };
}

test("only automatic drafts allow PO edits and cancellation; issued and legacy allocations keep their locks", () => {
  const order: PurchaseOrder = { id, company_id: id, version: 1, total_minor: 100, created_at: "2026-11-06", document: { ...blankPurchaseOrder("2026-11-06"), reference: "PO-1", items: [{ description: "Test", sku: "", quantity: 1, unitPriceMinor: 100 }] }, invoices: [{ id, number: 1, status: "draft", order_managed: true, total_minor: 100, paid_minor: 0, document: { currency: "USD", items: [{ purchaseOrderLineId: "line-1", quantity: 1 }] } }] };
  assert.equal(purchaseOrderCommercialDetailsLocked(order), false);
  assert.ok(purchaseOrderActions(order).statuses.includes("cancelled"));
  assert.equal(purchaseOrderActions(order).canInvoice, false);
  order.invoices![0].order_managed = false;
  assert.equal(purchaseOrderCommercialDetailsLocked(order), true);
  assert.ok(!purchaseOrderActions(order).statuses.includes("cancelled"));
  order.invoices![0].order_managed = true;
  order.invoices![0].status = "issued";
  assert.equal(purchaseOrderCommercialDetailsLocked(order), true);
});

test("sending rejects unauthorized callers, foreign origins, and invalid email data before accessing invoices", async () => {
  const denied = route({ forbidden: true });
  assert.equal((await denied.post()).status, 403);
  assert.equal(denied.counts().reads, 0);
  const invalid = route();
  assert.equal((await invalid.post(input, "https://evil.test")).status, 403);
  assert.equal((await invalid.post({ ...input, to: "invalid" })).status, 400);
  assert.equal(invalid.counts().reads, 0);
});

test("email context returns safe mailbox choices without SMTP credentials", async () => {
  const data = await (await route().get()).json();
  assert.deepEqual(data.mailboxes, [{ id: "mailbox", email: "sender@example.test" }]);
  assert.equal(data.canIssue, true);
});

test("draft and void invoices never reach SMTP", async () => {
  for (const status of ["draft", "void"] as const) {
    const fixture = route({ invoice: { ...invoice, status } });
    assert.equal((await fixture.post()).status, 409);
    assert.equal(fixture.counts().deliveries, 0);
    assert.equal(fixture.counts().reservations, 0);
  }
});

test("stale reviewed revisions fail before PDF rendering or SMTP", async () => {
  const fixture = route({ invoice: { ...invoice, revision: 3 } });
  assert.equal((await fixture.post()).status, 409);
  assert.equal(fixture.counts().renders, 0);
  assert.equal(fixture.counts().deliveries, 0);
});

test("changes during PDF preparation prevent delivery", async () => {
  const fixture = route({ latest: { ...invoice, revision: 3 } });
  assert.equal((await fixture.post()).status, 409);
  assert.equal(fixture.counts().renders, 1);
  assert.equal(fixture.counts().deliveries, 0);
});

test("completed and uncertain requests never render or send a second email", async () => {
  for (const duplicate of ["sent", "uncertain", "preparing"]) {
    const fixture = route({ duplicate });
    const response = await fixture.post();
    assert.equal(response.status, duplicate === "sent" ? 200 : 409);
    assert.equal(fixture.counts().renders, 0);
    assert.equal(fixture.counts().deliveries, 0);
  }
});

test("sending attaches the server-rendered PDF and refreshes its order; tracking failure still reports sent", async () => {
  for (const trackingError of [false, true]) {
    const fixture = route({ trackingError });
    const response = await fixture.post();
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.ok, true);
    assert.equal(fixture.counts().deliveries, 1);
    assert.ok(fixture.invalidated.includes(`/purchase-orders/${id}`));
    if (trackingError) assert.match(result.trackingWarning, /Email sent/);
  }
});

test("an ambiguous delivery remains uncertain and is not marked safe to retry", async () => {
  const fixture = route({ deliveryError: "Delivery could not be confirmed." });
  assert.equal((await fixture.post()).status, 500);
  assert.deepEqual(fixture.updates, []);
});
