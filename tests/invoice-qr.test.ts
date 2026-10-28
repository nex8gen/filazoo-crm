import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as invoices from "../lib/invoices.ts";
import * as crypto from "../lib/customer-portal-crypto.ts";
import * as banks from "../lib/invoice-banks.ts";

const require = createRequire(import.meta.url);
function load<T>(file: string, deps: Record<string, unknown>, env: Record<string, string> = {}): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : deps[name] ?? require(name), process: { env, cwd: () => process.cwd() }, URL, console });
  return exports as T;
}
const links = load<typeof import("../lib/customer-portal-links.ts")>("lib/customer-portal-links.ts", { "./env": { env: { supabaseSecretKey: "test-secret" } }, "./customer-portal-crypto": crypto });
const draft: invoices.Invoice = {
  id: "c58b80f9-b3c5-4c85-bb80-9c88a38a04dd", number: 4, status: "draft", revision: 1,
  created_at: "", updated_at: "", total_minor: 100, paid_minor: 0,
  document: { ...invoices.blankInvoiceDocument("2026-10-26"), customerEmail: "buyer@example.test", items: [{ description: "Test", quantity: 1, unitPriceMinor: 100, taxBps: 0 }] },
};

test("saved draft QR credentials stay usable after issue, payment and void", () => {
  const value = links.customerPortalUrl(draft);
  assert.ok(value);
  const url = new URL(value);
  assert.equal(url.pathname, `/customer/invoices/${draft.id}`);
  assert.equal(url.search, "");
  assert.equal(crypto.validPortalKey(url.hash.slice(5), draft.id, draft.document.customerEmail, "test-secret"), true);
  for (const status of ["issued", "void"] as const) assert.equal(links.customerPortalUrl({ ...draft, status, paid_minor: 100 }), url.href);
  assert.notEqual(links.customerPortalUrl({ ...draft, document: { ...draft.document, customerEmail: "another@example.test" } }), url.href);
  assert.equal(links.customerPortalUrl({ ...draft, document: { ...draft.document, customerEmail: "  " } }), undefined);
});

test("invoice QR links remain reachable from a phone when generated locally", () => {
  const local = load<typeof links>("lib/customer-portal-links.ts", { "./env": { env: { supabaseSecretKey: "test-secret" } }, "./customer-portal-crypto": crypto }, { NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
  assert.equal(new URL(local.customerPortalUrl(draft)!).origin, "https://crm.filazoosupply.com");
});

test("creating, saving, listing and reopening a draft all return its QR immediately", async () => {
  const query: Record<string, unknown> = {};
  for (const name of ["select", "order", "eq", "insert"]) query[name] = () => query;
  query.single = query.maybeSingle = async () => ({ data: structuredClone(draft), error: null });
  query.range = async () => ({ data: [structuredClone(draft)], error: null, count: 1 });
  const data = load<typeof import("../lib/data/invoices.ts")>("lib/data/invoices.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => ({ from: () => query, rpc: async (name: string, args: { p_input?: { action: string } }) => ({ data: name === "invoice_receivables" ? [] : args.p_input?.action === "delete" ? null : structuredClone(draft), error: null }) }) },
    "../invoices": invoices, "../customer-portal-links": links,
    "./invoice-connections": { validateInvoiceConnections: async () => {} },
    "../invoice-links": {}, "./cached-member-avatars": {}, "../profile-avatar": {},
  });
  const expected = links.customerPortalUrl(draft);
  assert.equal((await data.createInvoice(draft.document, "staff")).customer_portal_url, expected);
  assert.equal((await data.mutateInvoice(draft.id, "staff", { action: "save", document: draft.document })).customer_portal_url, expected);
  assert.equal((await data.getInvoice(draft.id))?.customer_portal_url, expected);
  assert.equal((await data.listInvoices()).invoices[0].customer_portal_url, expected);
  assert.equal(await data.mutateInvoice(draft.id, "staff", { action: "delete" }), null);
});

test("the printed invoice shows a real QR and an activation note only for drafts", () => {
  const { InvoicePaper } = load<typeof import("../components/invoice-paper.tsx")>("components/invoice-paper.tsx", {
    "@/components/brand-mark": { BrandMark: () => null }, "next/image": () => null,
    "@/lib/invoices": invoices, "@/lib/invoice-banks": banks,
    "@/lib/invoice-payment-methods": {}, "@/components/payment-method-icon": { PaymentMethodIcon: () => null },
  });
  const invoice = { ...draft, customer_portal_url: links.customerPortalUrl(draft) };
  const html = renderToStaticMarkup(createElement(InvoicePaper, { invoice, today: "2026-10-26" }));
  assert.match(html, /<svg[^>]+height="132"/);
  assert.ok(html.includes(invoice.customer_portal_url!));
  assert.match(html, /Activates when invoice is issued/);
  const issued = renderToStaticMarkup(createElement(InvoicePaper, { invoice: { ...invoice, status: "issued" }, today: "2026-10-26" }));
  assert.match(issued, /<svg[^>]+height="132"/);
  assert.doesNotMatch(issued, /Activates when/);
});

test("generated draft and issued PDFs embed the same signed customer QR", async () => {
  const renderer = await import("@react-pdf/renderer");
  const qr = require("qrcode") as typeof import("qrcode");
  const encoded: string[] = [];
  const brand = load<typeof import("../components/brand-mark.tsx")>("components/brand-mark.tsx", {});
  const pdf = load<typeof import("../lib/invoice-pdf.tsx")>("lib/invoice-pdf.tsx", {
    "@react-pdf/renderer": renderer,
    qrcode: { ...qr, toDataURL: async (value: string, options: object) => { encoded.push(value); return qr.toDataURL(value, options); } },
    "./customer-portal-links": links, "../components/brand-mark": brand,
    "./invoice-banks": banks, "./invoice-payment-methods": {},
    "./payment-icons": {}, "./invoices": invoices, "./invoice-links": {},
  });
  for (const status of ["draft", "issued"] as const) {
    const bytes = await pdf.renderInvoicePdf({ ...draft, status }, "2026-10-26");
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.match(bytes.toString("latin1"), /\/Subtype \/Image/);
    if (process.env.INVOICE_QR_ARTIFACTS) {
      mkdirSync("tmp", { recursive: true });
      writeFileSync(`tmp/invoice-qr-${status}.pdf`, bytes);
    }
  }
  assert.deepEqual(encoded, [links.customerPortalUrl(draft), links.customerPortalUrl(draft)]);
});
