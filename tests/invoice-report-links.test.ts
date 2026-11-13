import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { z } from "zod";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blankInvoiceDocument, type Invoice } from "../lib/invoices.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const require = createRequire(import.meta.url);
const invoiceId = "c58b80f9-b3c5-4c85-bb80-9c88a38a04dd";
const companyId = "4913b683-bcec-4079-b424-6fd559ed0c2a";
const orderId = "083bb9b2-a99d-461e-aba2-c3d571598174";
class Redirect extends Error { href: string; constructor(href: string) { super(href); this.href = href; } }
function fixture(file: string, options: { role?: string; orderId?: string; missing?: boolean } = {}) {
  let authorized = false;
  const reads: string[] = [];
  const invoice: Invoice = { id: invoiceId, number: 1006, company_id: companyId, status: "issued", revision: 1,
    created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", total_minor: 100, paid_minor: 0,
    document: { ...blankInvoiceDocument("2026-11-01"), ...(options.orderId ? { purchaseOrderId: options.orderId } : {}), items: [{ description: "Saved item", quantity: 1, unitPriceMinor: 100, taxBps: 0 }] } };
  const deps: Record<string, unknown> = {
    "react/jsx-runtime": jsx, zod: { z },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(options.role ?? "viewer")) throw new Error("Access denied"); authorized = true; return { id: "staff", role: options.role ?? "viewer" }; } },
    "@/lib/data/invoices": { getInvoice: async (id: string) => { assert.ok(authorized); reads.push(id); return options.missing ? null : invoice; }, listInvoices: async () => { throw new Error("Standalone list must remain retired"); } },
    "@/components/legacy-invoice-details": { LegacyInvoiceDetails: "HistoricalInvoice" },
    "next/navigation": { redirect: (href: string) => { throw new Redirect(href); }, notFound: () => { throw new Error("Not found"); } },
  };
  const exports: { default?: (props: unknown) => Promise<{ type: unknown; props: { invoice: Invoice; today: string } }> } = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => deps[name] ?? require(name))(name), Date, Intl });
  return { page: exports.default!, invoice, reads };
}

test("legacy invoice list links use the PO register and preserve validated company context", async () => {
  const { page } = fixture("../app/invoices/page.tsx");
  for (const status of ["issued", "draft", "invalid"]) await assert.rejects(page({ searchParams: Promise.resolve({ status }) }), error => error instanceof Redirect && error.href === "/purchase-orders");
  await assert.rejects(page({ searchParams: Promise.resolve({ companyId }) }), error => error instanceof Redirect && error.href === `/companies/${companyId}?tab=purchase-orders`);
  await assert.rejects(page({ searchParams: Promise.resolve({ companyId: "../bad" }) }), error => error instanceof Redirect && error.href === "/purchase-orders");
});

test("invoice creation entry points stay PO-driven and reject viewer creation", async () => {
  const { page } = fixture("../app/invoices/new/page.tsx", { role: "operator" });
  await assert.rejects(page({ searchParams: Promise.resolve({ companyId }) }), error => error instanceof Redirect && error.href === `/purchase-orders/new?companyId=${companyId}`);
  await assert.rejects(page({ searchParams: Promise.resolve({}) }), error => error instanceof Redirect && error.href === "/purchase-orders/new");
  await assert.rejects(fixture("../app/invoices/new/page.tsx").page({ searchParams: Promise.resolve({}) }), /Access denied/);
});

test("selected invoice links resolve their exact connected PO", async () => {
  const { page, reads } = fixture("../app/invoices/[id]/page.tsx", { orderId });
  await assert.rejects(page({ params: Promise.resolve({ id: invoiceId }) }), error => error instanceof Redirect && error.href === `/purchase-orders/${orderId}`);
  assert.deepEqual(reads, [invoiceId]);
});

test("historical invoice links retain the selected invoice for every authorized read role", async () => {
  for (const role of ["admin", "operator", "bd_manager", "viewer"]) {
    const { page, reads } = fixture("../app/invoices/[id]/page.tsx", { role });
    const result = await page({ params: Promise.resolve({ id: invoiceId }) });
    assert.equal(result.type, "HistoricalInvoice");
    assert.equal(result.props.invoice.id, invoiceId);
    assert.equal(result.props.invoice.total_minor, 100);
    assert.match(result.props.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(reads, [invoiceId]);
  }
});

test("invalid, missing, or unauthorized selected invoice links cannot read another record", async () => {
  const invalid = fixture("../app/invoices/[id]/page.tsx");
  await assert.rejects(invalid.page({ params: Promise.resolve({ id: "invalid" }) }), /Not found/);
  assert.deepEqual(invalid.reads, []);
  const denied = fixture("../app/invoices/[id]/page.tsx", { role: "outsider" });
  await assert.rejects(denied.page({ params: Promise.resolve({ id: invoiceId }) }), /Access denied/);
  assert.deepEqual(denied.reads, []);
  await assert.rejects(fixture("../app/invoices/[id]/page.tsx", { missing: true }).page({ params: Promise.resolve({ id: invoiceId }) }), /Not found/);
});

test("historical detail offers the selected invoice PDF and print without billing mutation controls", () => {
  let prints = 0;
  const deps: Record<string, unknown> = {
    "react/jsx-runtime": jsx,
    "next/link": { default: (props: object) => createElement("a", props) },
    "lucide-react": { ArrowLeft: () => null, Download: () => null, Printer: () => null },
    "@/components/page-header": { PageActions: ({ children }: { children: import("react").ReactNode }) => createElement("div", null, children) },
    "@/components/ui/button": { Button: (props: object) => createElement("button", props), buttonVariants: () => "" },
    "@/components/invoice-paper": { InvoicePaper: ({ invoice }: { invoice: Invoice }) => createElement("article", { "data-invoice-id": invoice.id }) },
    "@/lib/invoices": { invoiceLabel: () => "#1006" }, "@/app/invoices/invoices.css": {},
  };
  const exports = {} as { LegacyInvoiceDetails: (props: { invoice: Invoice; today: string }) => import("react").ReactElement };
  const code = ts.transpileModule(readFileSync(new URL("../components/legacy-invoice-details.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => deps[name] ?? require(name))(name), window: { print: () => prints++ } });
  const { invoice } = fixture("../app/invoices/[id]/page.tsx");
  const tree = exports.LegacyInvoiceDetails({ invoice, today: "2026-11-07" });
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes(`/api/invoices/${invoiceId}/pdf`));
  assert.ok(html.includes(`data-invoice-id="${invoiceId}"`));
  assert.ok(html.includes(`/companies/${companyId}?tab=purchase-orders`));
  assert.doesNotMatch(html, /<form|>Send invoice<|>Edit invoice<|>New invoice<|>Issue invoice<|>Record payment</);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object" || !("props" in value)) return;
    const props = (value as { props: { onClick?: () => void; children?: unknown } }).props;
    if (props.onClick) props.onClick();
    visit(props.children);
  };
  visit(tree);
  assert.equal(prints, 1);
});
