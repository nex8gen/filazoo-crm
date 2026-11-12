import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { commerceDefaults } from "../lib/company-commerce.ts";
import { readInvoiceDefaults, invoiceDocumentWithDefaults } from "../lib/invoice-defaults.ts";
import { orderBillingFromInvoice } from "../lib/purchase-order-billing.ts";
import { blankPurchaseOrder } from "../lib/purchase-order-draft.ts";
import * as draft from "../lib/purchase-order-draft.ts";
import * as billing from "../lib/purchase-order-billing.ts";
import * as invoices from "../lib/invoices.ts";
import * as overview from "../lib/purchase-order-overview.ts";
import * as register from "../lib/purchase-order-register.ts";
import * as orders from "../lib/purchase-orders.ts";
import { formatMoney } from "../lib/invoices.ts";
import type { OrderProfile, PurchaseOrder } from "../lib/purchase-orders.ts";
import { defaultTableColumns, type TableId } from "../lib/table-column-preferences.ts";

const require = createRequire(import.meta.url);
const companyId = "4913b683-bcec-4079-b424-6fd559ed0c2a";
const orderId = "083bb9b2-a99d-461e-aba2-c3d571598174";
class Redirect extends Error {
  href: string;
  constructor(href: string) { super(href); this.href = href; }
}
type Element = { type: unknown; props: Record<string, unknown> };
function load(file: string, deps: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name in deps ? deps[name] : require(name), Date, Intl, URLSearchParams, ...globals });
  return exports;
}
const navigation = {
  redirect: (href: string) => { throw new Redirect(href); },
  notFound: () => { throw new Error("Not found"); },
};
const profile: OrderProfile = {
  customer: { companyName: "Selected customer", contactName: "Buyer", contactRole: "Purchasing", contactEmail: "buyer@example.test", billingEmail: "accounts@example.test", billingAddress: "Customer billing address", phone: "", taxId: "" },
  commerce: commerceDefaults(), contacts: [],
};

function newPage(role = "operator", options: { missing?: boolean } = {}) {
  const reads: string[] = [];
  let authorized = false;
  const companies = options.missing ? [] : [{ id: companyId, name: "Selected customer" }];
  const settings = readInvoiceDefaults({ defaults: { currency: "EUR", termsDays: 30, taxBps: 1250 } });
  const Composer = () => null;
  const deps: Record<string, unknown> = {
    "next/navigation": navigation,
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Access denied"); authorized = true; return { role }; } },
    "@/lib/data/crm": { listCompanyOptions: async () => { assert.ok(authorized); reads.push("companies"); return { companies }; } },
    "@/app/purchase-order-actions": { getPurchaseOrderProfile: async (id: string) => { assert.ok(authorized); reads.push(`profile:${id}`); return profile; } },
    "@/lib/data/invoice-defaults": { getInvoiceDefaults: async () => { assert.ok(authorized); reads.push("billing"); return settings; } },
    "@/lib/invoice-defaults": { invoiceDocumentWithDefaults },
    "@/lib/purchase-order-billing": { orderBillingFromInvoice },
    "@/components/purchase-order-composer": { PurchaseOrderComposer: Composer },
  };
  const page = load("../app/purchase-orders/new/page.tsx", deps).default as (props: { searchParams: Promise<{ companyId?: string }> }) => Promise<Element>;
  return { page, reads, Composer };
}

test("company PO creation opens the canonical composer with its selected customer and billing defaults", async () => {
  const { page, reads, Composer } = newPage();
  const result = await page({ searchParams: Promise.resolve({ companyId }) });
  assert.equal(result.type, Composer);
  assert.equal(result.props.initialCompanyId, companyId);
  assert.equal(result.props.initialProfile, profile);
  const billing = result.props.initialBilling as { issueDate: string; dueDate: string; taxBps: number };
  assert.equal(billing.taxBps, 1250);
  const due = new Date(`${billing.issueDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  assert.equal(billing.dueDate, due.toISOString().slice(0, 10));
  assert.deepEqual(reads.sort(), ["companies", `profile:${companyId}`, "billing"].sort());
});

test("canonical PO creation validates company context and denies viewers before profile or billing reads", async () => {
  const invalid = newPage();
  await assert.rejects(invalid.page({ searchParams: Promise.resolve({ companyId: "../other" }) }), /Not found/);
  assert.deepEqual(invalid.reads, []);
  const missing = newPage("operator", { missing: true });
  await assert.rejects(missing.page({ searchParams: Promise.resolve({ companyId }) }), /Not found/);
  assert.deepEqual(missing.reads, ["companies"]);
  const denied = newPage("viewer");
  await assert.rejects(denied.page({ searchParams: Promise.resolve({ companyId }) }), /Access denied/);
  assert.deepEqual(denied.reads, []);
});

test("global PO creation still allows choosing a customer without loading an unrelated profile", async () => {
  const { page, reads } = newPage();
  const result = await page({ searchParams: Promise.resolve({}) });
  assert.equal(result.props.initialCompanyId, "");
  assert.equal(result.props.initialProfile, null);
  assert.deepEqual(reads, ["companies", "billing"]);
});

const order: PurchaseOrder & { companyName: string } = {
  id: orderId, company_id: companyId, companyName: "Selected customer", number: 1006, version: 2,
  created_at: "2026-11-06T08:00:00Z", total_minor: 500,
  document: { ...blankPurchaseOrder("2026-11-06"), status: "confirmed", reference: "CUSTOMER-PO", items: [{ description: "Saved product", sku: "PLA", quantity: 5, unitPriceMinor: 100 }] },
};
type CompanyProps = { companyId: string; companyName: string; canWrite: boolean; orderId?: string; filters?: overview.PurchaseOrderFilters; drafts?: boolean; params?: Record<string, string | string[] | undefined> };
function companyOrders(options: { count?: number; focused?: typeof order | null } = {}) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const Register = () => null;
  const deps: Record<string, unknown> = {
    "next/navigation": navigation,
    "@/app/purchase-orders/purchase-orders.css": {},
    "@/lib/purchase-order-overview": overview,
    "@/lib/purchase-order-register": register,
    "@/lib/data/purchase-orders": {
      listPurchaseOrders: async (...args: unknown[]) => { calls.push({ method: "list", args }); return { orders: [order], count: options.count ?? 51 }; },
      purchaseOrderOverview: async (...args: unknown[]) => { calls.push({ method: "overview", args }); return { stages: { draft: 3, confirmed: 2, in_production: 1, shipped: 1, completed: 5, cancelled: 1 }, overdue: 2 }; },
      getPurchaseOrder: async (...args: unknown[]) => { calls.push({ method: "focused", args }); return "focused" in options ? options.focused : order; },
    },
    "@/app/purchase-order-actions": new Proxy({}, { get: () => () => { throw new Error("Company browsing must not load the retired editor, billing profile or catalog"); } }),
    "@/components/purchase-order-register": { PurchaseOrderRegister: Register },
  };
  const component = load("../components/company-purchase-orders.tsx", deps).CompanyPurchaseOrders as (props: CompanyProps) => Promise<Element>;
  const props: CompanyProps = { companyId, companyName: "Selected customer", canWrite: true };
  return { component, props, calls, Register };
}

test("company purchase orders use the shared register and scope order data and counts to this customer", async () => {
  const { component, props, calls, Register } = companyOrders();
  const filters: overview.PurchaseOrderFilters = { search: "CUSTOMER-PO", status: "confirmed", overdue: true, page: 2, sort: "oldest" };
  const result = await component({ ...props, filters });
  assert.equal(result.type, Register);
  assert.deepEqual(JSON.parse(JSON.stringify(result.props.company)), { id: companyId, name: "Selected customer" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.props.filters)), filters);
  assert.equal(result.props.drafts, false);
  assert.equal(result.props.canWrite, true);
  assert.equal(result.props.draftCount, 3);
  assert.equal((result.props.rows as register.PurchaseOrderRegisterRow[])[0].reference, "CUSTOMER-PO");
  const list = calls.find(call => call.method === "list")!;
  assert.deepEqual(JSON.parse(JSON.stringify(list.args[0])), filters);
  assert.equal(list.args[2], companyId);
  assert.equal(calls.find(call => call.method === "overview")?.args[1], companyId);
  assert.equal(calls.length, 2);
});

test("the company drafts view stays draft-only, removes overdue filtering and retains read-only access", async () => {
  const { component, props, calls } = companyOrders();
  const result = await component({ ...props, canWrite: false, drafts: true, filters: { search: "PLA", status: "shipped", overdue: true, page: 1 } });
  assert.equal(result.props.drafts, true);
  assert.equal(result.props.canWrite, false);
  const filters = result.props.filters as overview.PurchaseOrderFilters;
  assert.equal(filters.status, "draft");
  assert.equal(filters.overdue, false);
  assert.equal(filters.search, "PLA");
  assert.equal((calls.find(call => call.method === "list")!.args[0] as overview.PurchaseOrderFilters).status, "draft");
});

test("company query parameters select drafts and parse search, date sorting and pagination", async () => {
  const { component, props } = companyOrders();
  const result = await component({ ...props, params: { tab: "purchase-orders", view: "drafts", q: " PLA ", page: "2", status: "shipped", overdue: "1", sort: "oldest" } });
  assert.equal(result.props.drafts, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.props.filters)), { search: "PLA", status: "draft", overdue: false, page: 2, sort: "oldest" });
});

test("legacy selected-order links open the exact canonical PO, including saved drafts", async () => {
  for (const status of ["draft", "confirmed"] as const) {
    const focused = { ...order, document: { ...order.document, status } };
    const { component, props, calls } = companyOrders({ focused });
    await assert.rejects(component({ ...props, orderId }), error => error instanceof Redirect && error.href === `/purchase-orders/${orderId}`);
    assert.deepEqual(calls.map(call => call.method), ["focused"]);
    assert.equal(calls[0].args[0], orderId);
  }
});

test("selected-order company links cannot display or redirect to another customer's PO", async () => {
  for (const focused of [null, { ...order, company_id: "another-company" }]) {
    const { component, props, calls } = companyOrders({ focused });
    await assert.rejects(component({ ...props, orderId }), /Not found/);
    assert.deepEqual(calls.map(call => call.method), ["focused"]);
  }
});

test("company PO page clamping keeps customer, draft view, search and sorting context", async () => {
  const { component, props } = companyOrders({ count: 26 });
  await assert.rejects(component({ ...props, drafts: true, filters: { search: "Acme & Co", status: "draft", overdue: false, page: 99, sort: "oldest" } }), error => {
    if (!(error instanceof Redirect)) return false;
    const url = new URL(error.href, "https://crm.test");
    assert.equal(url.pathname, `/companies/${companyId}`);
    assert.equal(url.searchParams.get("tab"), "purchase-orders");
    assert.equal(url.searchParams.get("view"), "drafts");
    assert.equal(url.searchParams.get("q"), "Acme & Co");
    assert.equal(url.searchParams.get("sort"), "oldest");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.has("status"), false);
    return true;
  });
});

function registerElements(drafts = false, canWrite = true, empty = false, companyScoped = true, globals: Record<string, unknown> = {}, hooks?: object) {
  const ui = new Proxy({}, { get: (_target, key) => String(key) });
  const deps: Record<string, unknown> = {
    react: hooks ?? { useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}], useRef: (initial: unknown) => ({ current: initial }) },
    "next/dynamic": { default: () => "CompanyPurchaseOrderCreate" },
    "next/link": { default: "a" },
    "lucide-react": ui,
    "@/components/page-header": { PageActions: "PageActions" },
    "@/components/ui/button": { Button: "button", buttonVariants: () => "" },
    "@/components/ui/checkbox": ui,
    "@/components/ui/table-status-badge": ui,
    "@/components/ui/live-search-form": { LiveSearchForm: (props: Record<string, unknown>) => ({ type: "form", props: { ...props, method: "get" } }) },
    "@/components/ui/table-columns-trigger": ui,
    "@/components/table-columns-provider": { useTableColumns: (tableId: TableId) => [defaultTableColumns[tableId], () => {}] },
    "@/components/ui/dropdown-menu": ui,
    "@/components/company-purchase-order-create": { CompanyPurchaseOrderCreate: "CompanyPurchaseOrderCreate" },
    "@/lib/purchase-order-overview": overview,
    "@/lib/purchase-orders": orders,
    "@/lib/purchase-order-register": register,
    "@/lib/invoices": { formatMoney },
  };
  const component = load("../components/purchase-order-register.tsx", deps, globals).PurchaseOrderRegister as (props: object) => Element;
  const tree = component({
    company: companyScoped ? { id: companyId, name: "Selected customer" } : undefined, draftCount: 3,
    rows: empty ? [] : [register.purchaseOrderRegisterRow(order)], count: empty ? 0 : 51, pageSize: 25, today: "2026-11-07", drafts, canWrite,
    filters: { search: "CUSTOMER-PO", status: drafts ? "draft" : "confirmed", overdue: false, page: 2 },
    summary: { orders: 10, inProduction: 1, shipped: 1, overdue: 2 },
  });
  return collectElements(tree);
}

function collectElements(tree: Element) {
  const elements: Element[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as Element;
    elements.push(element);
    if (typeof element.type === "function") visit(element.type(element.props));
    visit(element.props.children);
    visit(element.props.render);
  };
  visit(tree);
  return elements;
}

test("company register creates orders locally and preserves customer scope for row, filter, summary, sort and page links", () => {
  const elements = registerElements();
  const links = elements.filter(element => typeof element.props.href === "string");
  assert.ok(elements.some(element => element.type === "button" && element.props.onClick && JSON.stringify(element.props.children).includes("New purchase order")));
  assert.ok(!links.some(element => String(element.props.href).startsWith("/purchase-orders/new")));
  assert.ok(links.some(element => element.props.href === `/purchase-orders/${orderId}`));
  assert.ok(links.some(element => element.props["aria-label"] === "Next page"));
  assert.ok(links.some(element => element.props["aria-label"] === "Sort by date oldest first"));
  const companyLinks = links.filter(element => String(element.props.href).startsWith("/companies/"));
  assert.ok(companyLinks.length >= 10, "summary, views, filters, sorting and pagination remain in the customer tab");
  for (const element of companyLinks) {
    const url = new URL(String(element.props.href), "https://crm.test");
    assert.equal(url.pathname, `/companies/${companyId}`);
    assert.equal(url.searchParams.get("tab"), "purchase-orders");
  }
  const next = new URL(String(links.find(element => element.props["aria-label"] === "Next page")!.props.href), "https://crm.test");
  assert.equal(next.searchParams.get("page"), "3");
  assert.equal(next.searchParams.get("q"), "CUSTOMER-PO");
  assert.equal(next.searchParams.get("status"), "confirmed");
  assert.ok(!links.some(element => element.props.href === "/purchase-orders" || element.props.href === "/purchase-orders/drafts"));
});

test("company register GET searches preserve customer tab and draft mode instead of returning to the global register", () => {
  for (const drafts of [false, true]) {
    const elements = registerElements(drafts);
    const form = elements.find(element => element.type === "form")!;
    assert.equal(form.props.action, `/companies/${companyId}`);
    assert.equal(form.props.method, "get");
    const inputs = elements.filter(element => element.type === "input" && element.props.type === "hidden");
    assert.ok(inputs.some(element => element.props.name === "tab" && element.props.value === "purchase-orders"));
    assert.equal(inputs.some(element => element.props.name === "view" && element.props.value === "drafts"), drafts);
    assert.ok(!inputs.some(element => element.props.name === "page"), "searches reset pagination");
    if (drafts) assert.ok(!inputs.some(element => element.props.name === "status"), "draft mode cannot be changed by stale stage filters");
  }
});

test("the company create action mounts its local drawer and saving returns to the same register with draft feedback", () => {
  const state: unknown[] = [];
  let hook = 0;
  const hooks = {
    useState: (initial: unknown) => {
      const index = hook++;
      if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
      return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
    },
    useRef: (initial: unknown) => {
      const index = hook++;
      if (!(index in state)) state[index] = { current: initial };
      return state[index];
    },
  };
  const render = () => { hook = 0; return registerElements(false, true, false, true, {}, hooks); };
  let nodes = render();
  assert.ok(!nodes.some(node => node.type === "CompanyPurchaseOrderCreate"));
  const create = nodes.find(node => node.type === "button" && node.props["aria-haspopup"] === "dialog")!;
  const trigger = { id: "new-company-po" };
  (create.props.onClick as (event: object) => void)({ currentTarget: trigger });
  nodes = render();
  const drawer = nodes.find(node => node.type === "CompanyPurchaseOrderCreate")!;
  assert.ok(drawer);
  assert.deepEqual(JSON.parse(JSON.stringify(drawer.props.company)), { id: companyId, name: "Selected customer" });
  assert.equal((drawer.props.finalFocus as { current: unknown }).current, trigger);
  (drawer.props.onSaved as (id: string) => void)(orderId);
  nodes = render();
  assert.ok(!nodes.some(node => node.type === "CompanyPurchaseOrderCreate"));
  const feedback = nodes.find(node => node.props.role === "status" && JSON.stringify(node.props.children).includes("Draft saved."))!;
  assert.ok(feedback);
  assert.ok(collectElements(feedback).some(node => node.props.href === overview.purchaseOrdersHref({}, true, companyId)));
});

test("company registers omit the repeated customer column while global registers retain it", () => {
  for (const drafts of [false, true]) {
    for (const companyScoped of [false, true]) {
      const columns = registerElements(drafts, true, false, companyScoped).filter(element => element.type === "th").map(element => element.props["data-column"]);
      assert.equal(columns.includes("customer"), !companyScoped);
      assert.ok(columns.includes("order"));
      assert.ok(columns.includes("date"));
      assert.ok(columns.includes("total"));
    }
  }
  assert.ok(registerElements(false, true, false, false).some(element => element.props.href === "/purchase-orders/new"), "global order creation retains its standalone route");
});

test("company PO and draft exports retain customer identity and reference even when the list omits Customer", async () => {
  for (const drafts of [false, true]) {
    let exportedBlob: Blob | undefined;
    const revoked: string[] = [];
    let clicks = 0;
    const anchor = { href: "", download: "", click: () => clicks++ };
    const elements = registerElements(drafts, true, false, true, {
      Blob,
      URL: { createObjectURL: (blob: Blob) => { exportedBlob = blob; return "blob:company-po-export"; }, revokeObjectURL: (url: string) => revoked.push(url) },
      document: { createElement: (tag: string) => { assert.equal(tag, "a"); return anchor; } },
    });
    const exportButton = elements.find(element => element.type === "button" && element.props.children === "Export")!;
    assert.equal(exportButton.props.disabled, false);
    (exportButton.props.onClick as () => void)();
    assert.ok(exportedBlob);
    const csv = await exportedBlob.text();
    const [header, row] = csv.split("\r\n");
    assert.ok(header.includes('"Customer"'));
    assert.ok(header.includes('"Customer PO"'));
    assert.ok(row.includes('"Selected customer"'));
    assert.ok(row.includes('"CUSTOMER-PO"'));
    assert.ok(row.includes('"#1006"'));
    assert.equal(anchor.download, `${drafts ? "draft-purchase-orders" : "purchase-orders"}-2026-11-07.csv`);
    assert.equal(anchor.href, "blob:company-po-export");
    assert.equal(clicks, 1);
    assert.deepEqual(revoked, ["blob:company-po-export"]);
  }
});

test("company read-only register and empty states retain navigation without exposing order creation", () => {
  for (const drafts of [false, true]) {
    const elements = registerElements(drafts, false, true);
    const hrefs = elements.map(element => element.props.href).filter((href): href is string => typeof href === "string");
    assert.ok(!hrefs.some(href => href.startsWith("/purchase-orders/new")));
    assert.ok(hrefs.some(href => href.startsWith(`/companies/${companyId}?`)));
    assert.ok(!elements.some(element => element.props.onClick && element.type === "a"));
    assert.ok(!elements.some(element => element.type === "CompanyPurchaseOrderCreate"), "viewers cannot mount a company order composer");
  }
});

test("discarding a new company PO returns to that customer's drafts while global creation keeps its global return", () => {
  for (const selectedCompany of [companyId, ""]) {
    const pushes: string[] = [];
    const ui = new Proxy({}, { get: (_target, key) => String(key) });
    const deps: Record<string, unknown> = {
      react: {
        useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
        useRef: (initial: unknown) => ({ current: initial }), useEffect: () => {}, useImperativeHandle: () => {}, useTransition: () => [false, () => {}],
      },
      "next/link": { default: "a" }, "next/image": { default: "img" }, "next/dynamic": { default: () => "DynamicComponent" },
      "next/navigation": { useRouter: () => ({ push: (href: string) => pushes.push(href) }) },
      "lucide-react": ui, "@/components/page-header": { PageActions: "PageActions" },
      "@/app/purchase-order-actions": {}, "@/lib/purchase-order-links": {}, "@/lib/invoice-links": {},
      "@/lib/purchase-order-draft": draft, "@/lib/purchase-orders": orders,
      "@/lib/purchase-order-billing": billing, "@/lib/purchase-order-overview": overview, "@/lib/invoices": invoices,
      "@/components/purchase-order-billing-fields": ui, "@/components/purchase-order-profile-fields": ui,
      "@/components/ui/button": { Button: "button" },
    };
    for (const uiFile of ["input", "label", "textarea", "date-picker", "select", "dialog"]) deps[`@/components/ui/${uiFile}`] = ui;
    const component = load("../components/purchase-order-composer.tsx", deps).PurchaseOrderComposer as (props: object) => Element;
    const elements = collectElements(component({ companies: [{ id: companyId, name: "Selected customer" }], initialCompanyId: selectedCompany, initialProfile: selectedCompany ? profile : null, today: "2026-11-07" }));
    const expected = selectedCompany ? overview.purchaseOrdersHref({}, true, selectedCompany) : "/purchase-orders/drafts";
    assert.ok(elements.some(element => element.type === "a" && element.props.href === expected));
    const discard = elements.find(element => element.type === "button" && element.props.children === "Discard")!;
    assert.ok(discard, "the canonical composer retains its discard action");
    (discard.props.onClick as () => void)();
    assert.deepEqual(pushes, [expected]);
  }
});

function panelComposer(options: { pending?: boolean; saveResult?: { error?: string; orderId?: string } } = {}) {
  const state: unknown[] = [];
  let hook = 0;
  const tasks: Promise<unknown>[] = [];
  const navigation: string[] = [];
  const saves: unknown[][] = [];
  const savedOrders: string[] = [];
  const profileReads: string[] = [];
  let closed = 0;
  const handle: { current: { requestClose(): void } | null } = { current: null };
  const ui = new Proxy({}, { get: (_target, key) => String(key) });
  const deps: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const index = hook++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (value: unknown) => { state[index] = typeof value === "function" ? value(state[index]) : value; }];
      },
      useRef: (initial: unknown) => {
        const index = hook++;
        if (!(index in state)) state[index] = { current: initial };
        return state[index];
      },
      useEffect: () => {},
      useImperativeHandle: (ref: typeof handle | undefined, create: () => typeof handle.current) => { if (ref) ref.current = create(); },
      useTransition: () => [options.pending ?? false, (action: () => unknown) => { tasks.push(Promise.resolve(action())); }],
    },
    "next/link": { default: "a" }, "next/image": { default: "img" }, "next/dynamic": { default: () => "DynamicComponent" },
    "next/navigation": { useRouter: () => ({ push: (href: string) => navigation.push(href), replace: (href: string) => navigation.push(href), refresh: () => navigation.push("refresh") }) },
    "lucide-react": ui, "@/components/page-header": { PageActions: "PageActions" },
    "@/app/purchase-order-actions": {
      savePurchaseOrder: async (...args: unknown[]) => { saves.push(args); return options.saveResult ?? { orderId }; },
      getPurchaseOrderProfile: async (id: string) => { profileReads.push(id); return profile; },
    },
    "@/lib/purchase-order-links": { applyOrderProfile: (_document: unknown, _profile: unknown) => draft.blankPurchaseOrder("2026-11-07", _profile as OrderProfile) },
    "@/lib/invoice-links": {}, "@/lib/purchase-order-draft": draft, "@/lib/purchase-orders": orders,
    "@/lib/purchase-order-billing": billing, "@/lib/purchase-order-overview": overview, "@/lib/invoices": invoices,
    "@/components/purchase-order-billing-fields": ui, "@/components/purchase-order-profile-fields": ui,
    "@/components/ui/button": { Button: "button" },
  };
  for (const uiFile of ["input", "label", "textarea", "date-picker", "select", "dialog"]) deps[`@/components/ui/${uiFile}`] = ui;
  const component = load("../components/purchase-order-composer.tsx", deps, { window: { addEventListener() {}, removeEventListener() {} } }).PurchaseOrderComposer as (props: object) => Element;
  const props = {
    companies: [{ id: companyId, name: "Selected customer" }], initialCompanyId: companyId, initialProfile: profile,
    today: "2026-11-07", ref: handle,
    panel: { onClose: () => closed++, onSaved: (id: string) => savedOrders.push(id) },
  };
  const render = () => { hook = 0; return collectElements(component(props)); };
  const changeOrder = (nodes: Element[], changes: object) => {
    const fields = nodes.find(node => node.type === "PurchaseOrderBillingFields")!;
    (fields.props.onChange as (document: unknown) => void)({ ...(fields.props.document as object), ...changes });
    return render();
  };
  return { render, changeOrder, handle, saves, savedOrders, profileReads, navigation, closed: () => closed, settle: () => Promise.all(tasks.splice(0)) };
}

test("the company panel prefills customer details and prevents removing or choosing another customer", async () => {
  const fixture = panelComposer();
  const nodes = fixture.render();
  const fields = nodes.find(node => node.type === "PurchaseOrderBillingFields")!;
  const document = fields.props.document as orders.PurchaseOrderDocument;
  assert.equal(document.customer?.companyName, "Selected customer");
  assert.equal(document.customer?.contactName, "Buyer");
  assert.equal(document.customer?.billingEmail, "accounts@example.test");
  assert.equal(document.customer?.billingAddress, "Customer billing address");
  assert.equal(document.currency, profile.commerce.currency);
  assert.ok(!nodes.some(node => node.props["aria-label"] === "Remove customer" || node.props["aria-label"] === "Search or create a customer"));
  assert.ok(!nodes.some(node => node.type === "PageActions"), "panel actions stay inside the company drawer");
  assert.ok(!nodes.some(node => node.type === "a" && node.props.href === overview.purchaseOrdersHref({}, true, companyId)), "panel does not navigate away to a standalone editor");
  const edit = nodes.find(node => node.type === "button" && node.props.children === "Edit customer details")!;
  (edit.props.onClick as () => void)();
  const customerFields = fixture.render().find(node => node.type === "PurchaseOrderProfileFields")!;
  assert.equal(customerFields.props.companyId, companyId);
  assert.equal(customerFields.props.hideProfileLink, true);
  (customerFields.props.onRefresh as () => void)();
  await fixture.settle();
  assert.deepEqual(fixture.profileReads, [companyId], "refreshing contact/billing fields keeps the company identity fixed");
  assert.deepEqual(fixture.navigation, []);
});

test("saving a company panel draft uses its fixed company and reports success without navigating away", async () => {
  const fixture = panelComposer();
  const nodes = fixture.changeOrder(fixture.render(), { reference: "FROM-COMPANY", items: [{ description: "PLA spool", sku: "PLA", quantity: 2, unitPriceMinor: 500 }] });
  const save = nodes.find(node => node.type === "button" && node.props.children === "Save draft")!;
  assert.ok(save);
  assert.equal(save.props.disabled, false);
  (save.props.onClick as () => void)();
  (save.props.onClick as () => void)();
  fixture.handle.current!.requestClose();
  assert.equal(fixture.closed(), 0, "a save in flight blocks dismissal before React rerenders");
  await fixture.settle();
  assert.equal(fixture.saves.length, 1);
  assert.equal(fixture.saves[0][0], companyId);
  assert.equal(fixture.saves[0][1], null);
  assert.equal((fixture.saves[0][3] as orders.PurchaseOrderDocument).status, "draft");
  assert.equal((fixture.saves[0][3] as orders.PurchaseOrderDocument).reference, "FROM-COMPANY");
  assert.deepEqual(fixture.savedOrders, [orderId]);
  assert.deepEqual(fixture.navigation, []);
});

test("company panel close requests preserve unsaved changes until discard is confirmed", () => {
  const pristine = panelComposer();
  pristine.render();
  pristine.handle.current!.requestClose();
  assert.equal(pristine.closed(), 1);

  const fixture = panelComposer();
  fixture.changeOrder(fixture.render(), { reference: "UNSAVED" });
  fixture.handle.current!.requestClose();
  let nodes = fixture.render();
  assert.equal(fixture.closed(), 0);
  const confirmation = nodes.find(node => node.type === "Dialog" && node.props.open === true)!;
  assert.ok(confirmation, "Escape and backdrop requests enter the same discard guard");
  const keep = nodes.find(node => node.type === "button" && node.props.children === "Keep editing")!;
  (keep.props.onClick as () => void)();
  nodes = fixture.render();
  assert.equal(fixture.closed(), 0);
  assert.ok(!nodes.some(node => node.type === "Dialog" && node.props.open === true));
  fixture.handle.current!.requestClose();
  nodes = fixture.render();
  const discard = nodes.find(node => node.type === "button" && node.props.children === "Discard")!;
  (discard.props.onClick as () => void)();
  assert.equal(fixture.closed(), 1);
  assert.deepEqual(fixture.navigation, []);
});

test("a pending company panel cannot close and failed saves keep the draft available for correction", async () => {
  const pending = panelComposer({ pending: true });
  const pendingNodes = pending.render();
  pending.handle.current!.requestClose();
  assert.equal(pending.closed(), 0);
  assert.ok(pendingNodes.filter(node => node.type === "button" && ["Save draft", "Saving...", "Cancel"].includes(String(node.props.children))).every(node => node.props.disabled === true));

  const fixture = panelComposer({ saveResult: { error: "Customer account is unavailable." } });
  const nodes = fixture.changeOrder(fixture.render(), { items: [{ description: "PLA spool", sku: "PLA", quantity: 1, unitPriceMinor: 100 }] });
  const save = nodes.find(node => node.type === "button" && node.props.children === "Save draft")!;
  (save.props.onClick as () => void)();
  await fixture.settle();
  assert.equal(fixture.closed(), 0);
  assert.deepEqual(fixture.savedOrders, []);
  assert.deepEqual(fixture.navigation, []);
  assert.ok(fixture.render().some(node => node.props.role === "alert" && node.props.children === "Customer account is unavailable."));
});

function draftContextAction(role = "operator", fail = false, access: { missing?: boolean; error?: boolean } = {}) {
  const reads: string[] = [];
  const queries: Array<[string, ...unknown[]]> = [];
  let authorized = false;
  let companyChecked = false;
  const viewerId = "5dd13520-84cb-4b8f-85d9-73e381479f6a";
  const query = {
    select: (...args: unknown[]) => { queries.push(["select", ...args]); return query; },
    eq: (...args: unknown[]) => { queries.push(["eq", ...args]); return query; },
    or: (...args: unknown[]) => { queries.push(["or", ...args]); return query; },
    maybeSingle: async () => { queries.push(["maybeSingle"]); companyChecked = true; return { data: access.missing ? null : { id: companyId }, error: access.error ? new Error("Permission denied") : null }; },
  };
  const settings = readInvoiceDefaults({ defaults: { currency: "EUR", termsDays: 30, taxBps: 1250 } });
  const deps = {
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Access denied"); authorized = true; return { id: viewerId, role }; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => { assert.ok(authorized); queries.push(["admin"]); return { from: (table: string) => { queries.push(["from", table]); return query; } }; } },
    "@/app/purchase-order-actions": { getPurchaseOrderProfile: async (id: string) => { assert.ok(authorized); assert.ok(companyChecked); reads.push(`profile:${id}`); if (fail) throw new Error("Company no longer exists"); return profile; } },
    "@/lib/data/invoice-defaults": { getInvoiceDefaults: async () => { assert.ok(authorized); assert.ok(companyChecked); reads.push("billing"); return settings; } },
    "@/lib/invoice-defaults": { invoiceDocumentWithDefaults },
    "@/lib/purchase-order-billing": { orderBillingFromInvoice },
  };
  const action = load("../app/company-purchase-order-actions.ts", deps).loadCompanyPurchaseOrderDraft as (id: string) => Promise<{ profile: OrderProfile; billing: orders.OrderBilling; today: string }>;
  return { action, reads, queries, viewerId };
}

test("company order drawer bootstrap loads only its customer and the current billing defaults", async () => {
  const { action, reads } = draftContextAction();
  const result = await action(companyId);
  assert.equal(result.profile, profile);
  assert.equal(result.today, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }));
  assert.equal(result.billing.taxBps, 1250);
  assert.equal(result.billing.issueDate, result.today);
  const due = new Date(`${result.today}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + 30);
  assert.equal(result.billing.dueDate, due.toISOString().slice(0, 10));
  assert.deepEqual(reads.sort(), [`profile:${companyId}`, "billing"].sort());
});

test("company drawer bootstrap rejects viewers or invalid customer IDs before loading private fields", async () => {
  const viewer = draftContextAction("viewer");
  await assert.rejects(viewer.action(companyId), /Access denied/);
  assert.deepEqual(viewer.reads, []);
  assert.deepEqual(viewer.queries, []);
  const invalid = draftContextAction();
  await assert.rejects(invalid.action("not-a-company"));
  assert.deepEqual(invalid.reads, []);
  assert.deepEqual(invalid.queries, []);
  const missing = draftContextAction("operator", true);
  await assert.rejects(missing.action(companyId), /Company no longer exists/);
});

test("company drawer bootstrap applies BD customer ownership and excludes sample companies before profile reads", async () => {
  const manager = draftContextAction("bd_manager");
  await manager.action(companyId);
  assert.deepEqual(manager.queries, [
    ["admin"], ["from", "companies"], ["select", "id,pipeline!inner(owner_id)"], ["eq", "id", companyId],
    ["or", "source.is.null,source.neq.sample_seed"], ["eq", "pipeline.owner_id", manager.viewerId], ["maybeSingle"],
  ]);
  assert.deepEqual(manager.reads.sort(), [`profile:${companyId}`, "billing"].sort());

  const operator = draftContextAction("operator");
  await operator.action(companyId);
  assert.ok(operator.queries.some(query => query[0] === "select" && query[1] === "id"));
  assert.ok(!operator.queries.some(query => query[0] === "eq" && query[1] === "pipeline.owner_id"));
  assert.ok(operator.queries.some(query => query[0] === "or" && query[1] === "source.is.null,source.neq.sample_seed"));
});

test("missing, sample, foreign-owner or inaccessible companies never load order customer fields or billing defaults", async () => {
  for (const role of ["operator", "bd_manager"]) {
    for (const access of [{ missing: true }, { error: true }]) {
      const fixture = draftContextAction(role, false, access);
      await assert.rejects(fixture.action(companyId), /This company is unavailable for order creation/);
      assert.deepEqual(fixture.reads, []);
      assert.ok(fixture.queries.some(query => query[0] === "maybeSingle"));
    }
  }
});

function companyDrawer(options: { failOnce?: boolean } = {}) {
  let hook = 0;
  const state: unknown[] = [];
  const effects = new Map<number, { deps: unknown[]; cleanup?: () => void }>();
  const pendingEffects: Array<() => void> = [];
  const tasks: Promise<unknown>[] = [];
  const loads: string[] = [];
  const navigation: string[] = [];
  const savedOrders: string[] = [];
  let closed = 0;
  let unmounted = false;
  let lateUpdates = 0;
  let composerLoading: (() => Element) | undefined;
  const finalFocus = { current: null };
  const settings = readInvoiceDefaults({ defaults: { termsDays: 30, taxBps: 1250 } });
  const context = { profile, today: "2026-11-07", billing: orderBillingFromInvoice(invoiceDocumentWithDefaults("2026-11-07", { ...settings.seller, defaults: settings.defaults })) };
  const ui = new Proxy({}, { get: (_target, key) => String(key) });
  const deps = {
    react: {
      useState: (initial: unknown) => {
        const index = hook++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (value: unknown) => { if (unmounted) lateUpdates++; state[index] = typeof value === "function" ? value(state[index]) : value; }];
      },
      useRef: (initial: unknown) => {
        const index = hook++;
        if (!(index in state)) state[index] = { current: initial };
        return state[index];
      },
      useEffect: (effect: () => (() => void) | undefined, next: unknown[]) => {
        const index = hook++;
        const previous = effects.get(index);
        if (previous && next.every((value, i) => Object.is(value, previous.deps[i]))) return;
        pendingEffects.push(() => { previous?.cleanup?.(); effects.set(index, { deps: next, cleanup: effect() }); });
      },
    },
    "next/dynamic": { default: (_loader: unknown, options?: { loading?: () => Element }) => { composerLoading = options?.loading; return "Composer"; } },
    "next/navigation": { useRouter: () => ({ push: (href: string) => navigation.push(href), replace: (href: string) => navigation.push(href), refresh: () => navigation.push("refresh") }) },
    "lucide-react": ui,
    "@/app/company-purchase-order-actions": { loadCompanyPurchaseOrderDraft: (id: string) => {
      loads.push(id);
      const task = options.failOnce && loads.length === 1 ? Promise.reject(new Error("Unavailable")) : Promise.resolve(context);
      tasks.push(task.catch(() => {}));
      return task;
    } },
    "@/components/ui/button": { Button: "button" }, "@/components/ui/sheet": ui,
  };
  const component = load("../components/company-purchase-order-create.tsx", deps).CompanyPurchaseOrderCreate as (props: object) => Element;
  const render = () => {
    hook = 0;
    const nodes = collectElements(component({ company: { id: companyId, name: "Older customer name" }, finalFocus, onClose: () => closed++, onSaved: (id: string) => savedOrders.push(id) }));
    pendingEffects.splice(0).forEach(effect => effect());
    return nodes;
  };
  return {
    render, loads, context, finalFocus, navigation, savedOrders, closed: () => closed,
    loadingNodes: () => collectElements(composerLoading!()),
    unmount: () => { unmounted = true; effects.forEach(effect => effect.cleanup?.()); },
    lateUpdates: () => lateUpdates,
    settle: async () => { await Promise.all(tasks.splice(0)); await Promise.resolve(); },
  };
}

test("company order creation stays in a right sheet and supplies its fresh customer and billing data", async () => {
  const fixture = companyDrawer();
  const first = fixture.render();
  const sheet = first.find(node => node.type === "SheetContent")!;
  assert.equal(sheet.props.side, "right");
  assert.equal(sheet.props.showCloseButton, false, "all close controls use the composer guard");
  assert.equal(sheet.props.finalFocus, fixture.finalFocus);
  assert.equal(first.find(node => node.type === "Sheet")?.props.open, true);
  assert.deepEqual(fixture.loads, [companyId]);
  await fixture.settle();
  const nodes = fixture.render();
  const composer = nodes.find(node => node.type === "Composer")!;
  assert.equal(composer.props.initialCompanyId, companyId);
  assert.equal(composer.props.initialProfile, fixture.context.profile);
  assert.equal(composer.props.initialBilling, fixture.context.billing);
  assert.deepEqual(JSON.parse(JSON.stringify(composer.props.companies)), [{ id: companyId, name: "Selected customer" }]);
  (composer.props.panel as { onSaved(id: string): void }).onSaved(orderId);
  assert.deepEqual(fixture.savedOrders, [orderId]);
  assert.deepEqual(fixture.navigation, ["refresh"], "saving refreshes company data without leaving its profile");
});

test("drawer Escape and backdrop dismissal call the embedded composer's dirty and pending close guard", async () => {
  const fixture = companyDrawer();
  fixture.render();
  await fixture.settle();
  const nodes = fixture.render();
  const composer = nodes.find(node => node.type === "Composer")!;
  let requests = 0;
  (composer.props.ref as { current: unknown }).current = { requestClose: () => requests++ };
  (nodes.find(node => node.type === "Sheet")!.props.onOpenChange as (open: boolean) => void)(false);
  assert.equal(requests, 1);
  assert.equal(fixture.closed(), 0, "the sheet cannot bypass the composer's unsaved-change guard");
  assert.deepEqual(fixture.navigation, []);
});

test("company drawers remain dismissible while customer data or the editor chunk loads and ignore late responses", async () => {
  const fixture = companyDrawer();
  const nodes = fixture.render();
  const fallback = fixture.loadingNodes();
  const close = fallback.find(node => node.type === "SheetClose")!;
  assert.ok(close, "mobile users can dismiss the loading editor without needing an Escape key");
  assert.ok(collectElements(close).some(node => node.type === "button" && node.props["aria-label"] === "Close"));
  assert.ok(fallback.some(node => node.props.role === "status"));
  (nodes.find(node => node.type === "Sheet")!.props.onOpenChange as (open: boolean) => void)(false);
  assert.equal(fixture.closed(), 1, "dismissal before editor readiness closes immediately");
  fixture.unmount();
  await fixture.settle();
  assert.equal(fixture.lateUpdates(), 0, "late bootstrap results cannot update or reopen a closed composer");
  assert.deepEqual(fixture.savedOrders, []);
  assert.deepEqual(fixture.navigation, []);
});

test("failed customer loading keeps the company drawer open and retries the same company", async () => {
  const fixture = companyDrawer({ failOnce: true });
  fixture.render();
  await fixture.settle();
  let nodes = fixture.render();
  assert.ok(nodes.some(node => node.props.role === "alert"));
  assert.ok(!nodes.some(node => node.type === "Composer"), "a failed load never opens an unbound customer editor");
  const retry = nodes.find(node => node.type === "button" && node.props.children === "Retry")!;
  (retry.props.onClick as () => void)();
  fixture.render();
  await fixture.settle();
  nodes = fixture.render();
  assert.deepEqual(fixture.loads, [companyId, companyId]);
  assert.ok(nodes.some(node => node.type === "Composer"));
  assert.equal(fixture.closed(), 0);
  assert.deepEqual(fixture.navigation, []);
});
