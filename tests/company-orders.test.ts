import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { companyPaidOrderCounts, companyOrderBadge, type CompanyOrderInvoice } from "../lib/company-orders.ts";
import { readCompanyPaidOrderCounts } from "../lib/data/company-orders.ts";
import { invoiceMutationSchema } from "../lib/invoices.ts";

const invoice = (id: string, patch: Partial<CompanyOrderInvoice> = {}): CompanyOrderInvoice => ({ id, company_id: "company-a", purchase_order_id: null, status: "issued", total_minor: 1000, paid_minor: 1000, ...patch });

test("only fully paid, positive-value, issued company invoices count", () => {
  const counts = companyPaidOrderCounts([
    invoice("paid"), invoice("partial", { paid_minor: 999 }), invoice("unpaid", { paid_minor: 0 }),
    invoice("draft", { status: "draft" }), invoice("void", { status: "void" }),
    invoice("free", { total_minor: 0, paid_minor: 0 }), invoice("unlinked", { company_id: null }),
    invoice("other", { company_id: "company-b" }),
  ]);
  assert.equal(counts.get("company-a"), 1);
  assert.equal(counts.get("company-b"), 1);
  assert.equal(counts.size, 2);
});

test("split invoices and duplicate rows count once per order; independent invoices count separately", () => {
  const counts = companyPaidOrderCounts([
    invoice("split-a", { purchase_order_id: "po-1" }), invoice("split-b", { purchase_order_id: "po-1" }),
    invoice("split-b", { purchase_order_id: "po-1" }), invoice("next-order", { purchase_order_id: "po-2" }),
    invoice("standalone"), invoice("standalone"), invoice("another-standalone"),
  ]);
  assert.equal(counts.get("company-a"), 4);
});

test("multiple partial receipts increase the count only on settlement and repeated reads stay idempotent", () => {
  for (const [paid, expected] of [[0, 0], [400, 0], [999, 0], [1000, 1], [1000, 1], [1000, 1]]) {
    assert.equal(companyPaidOrderCounts([invoice("same-invoice", { paid_minor: paid })]).get("company-a") ?? 0, expected);
  }
});

test("badge thresholds keep zero blank and show the exact total in the accessible label", () => {
  for (const [count, tier, text] of [[0, "black", ""], [1, "bronze", "1"], [2, "silver", "2"], [3, "gold", "3"], [4, "gold", "3+"], [28, "gold", "3+"]] as const) {
    assert.deepEqual(companyOrderBadge(count), { tier, text, label: `${count} paid ${count === 1 ? "order" : "orders"}` });
  }
});

function database(rows: CompanyOrderInvoice[], options: { cap?: number; error?: boolean } = {}) {
  const calls: Array<{ ids: string[]; from: number }> = [];
  const db = { from(table: string) {
    assert.equal(table, "invoices");
    let ids: string[] = [], from = 0, to = 499;
    const query = {
      select(fields: string, args: { count: string }) { assert.equal(fields, "id,company_id,purchase_order_id,status,total_minor,paid_minor"); assert.equal(args.count, "exact"); return query; },
      in(field: string, values: string[]) { assert.equal(field, "company_id"); ids = values; return query; },
      eq(field: string, value: string) { assert.equal(field, "status"); assert.equal(value, "issued"); return query; },
      gt(field: string, value: number) { assert.equal(field, "paid_minor"); assert.equal(value, 0); return query; },
      order(field: string) { assert.equal(field, "id"); return query; },
      range(start: number, end: number) { from = start; to = end; return query; },
      then(resolve: (value: unknown) => void) {
        calls.push({ ids, from });
        const filtered = rows.filter(row => row.company_id && ids.includes(row.company_id) && row.status === "issued" && row.paid_minor > 0);
        return Promise.resolve({ data: options.error ? null : filtered.slice(from, Math.min(to + 1, from + (options.cap ?? 500))), count: filtered.length, error: options.error ? { message: "offline" } : null }).then(resolve);
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { db, calls };
}

test("database reader includes invoices after the API cap and deduplicates POs across pages", async () => {
  const fixture = database(Array.from({ length: 1205 }, (_, i) => invoice(String(i), { purchase_order_id: i < 2 ? "same-po" : null })), { cap: 100 });
  assert.equal((await readCompanyPaidOrderCounts(fixture.db, ["company-a", "company-a"])).get("company-a"), 1204);
  assert.equal(fixture.calls.length, 13);
  assert.equal(fixture.calls.at(-1)?.from, 1200);
});

test("database reader batches company IDs, skips empty inputs, and never reports failure as zero", async () => {
  const fixture = database([invoice("a")]);
  assert.equal((await readCompanyPaidOrderCounts(fixture.db, [])).size, 0);
  assert.equal(fixture.calls.length, 0);
  const counts = await readCompanyPaidOrderCounts(fixture.db, ["company-a", ...Array.from({ length: 204 }, (_, i) => `company-${i}`)]);
  assert.equal(counts.get("company-a"), 1);
  assert.equal(fixture.calls.length, 3);
  assert.ok(fixture.calls.every(call => call.ids.length <= 100));
  await assert.rejects(readCompanyPaidOrderCounts(database([], { error: true }).db, ["company-a"]), /Unable to load paid order counts: offline/);
});

test("badge artwork renders all tiers and an accessible uncapped count", () => {
  const require = createRequire(import.meta.url);
  const exports: Record<string, (props: { count: number }) => unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/company-order-badge.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => id === "@/lib/company-orders" ? { companyOrderBadge } : require(id) });
  const { renderToStaticMarkup } = require("react-dom/server");
  for (const count of [0, 1, 2, 3, 4, 28]) {
    const html = renderToStaticMarkup(exports.CompanyOrderBadge({ count }));
    assert.ok(html.includes(`data-order-tier="${companyOrderBadge(count).tier}"`));
    assert.ok(html.includes(`aria-label="${companyOrderBadge(count).label}`));
    assert.match(html, /<svg/);
    if (count === 0) assert.ok(!html.includes(">0</span>"));
  }
});

function paymentRoute(options: { denied?: boolean; mutationFailure?: boolean } = {}) {
  const require = createRequire(import.meta.url);
  const id = "9c030b66-e226-4b40-b2c3-eae77eb89c79";
  const paths: string[] = [];
  let mutations = 0;
  const saved = { id, company_id: "company-a", status: "issued", total_minor: 1000, paid_minor: 0 };
  const exports: Record<string, (request: Request, context: unknown) => Promise<Response>> = {};
  const deps: Record<string, unknown> = {
    zod: require("zod"),
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/invoice-api": {
      checkInvoiceOrigin: () => null,
      invoiceAccess: async () => ({ viewer: { id: "staff", role: options.denied ? "bd_manager" : "admin" } }),
      invoiceError: () => Response.json({ error: "Failed" }, { status: 503 }),
    },
    "@/lib/invoice-permissions": { canMutateInvoice: () => !options.denied },
    "@/lib/invoices": { invoiceMutationSchema },
    "@/lib/data/invoices": {
      getInvoice: async () => ({ ...saved, paid_minor: mutations ? 1000 : 0 }),
      mutateInvoice: async (_id: string, actor: string, input: { action: string }) => {
        assert.equal(_id, id);
        assert.equal(actor, "staff");
        assert.equal(input.action, "payment");
        if (options.mutationFailure) throw new Error("Payment failed");
        mutations++;
        return { ...saved, paid_minor: 1000 };
      },
    },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/invoices/[id]/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name], Response, console });
  const submit = () => exports.PATCH(new Request(`http://localhost/api/invoices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "payment", payment: { id, amountMinor: 1000, paidOn: "2026-10-30", method: "bank_transfer", reference: "TEST" } }) }), { params: Promise.resolve({ id }) });
  return { paths, submit, mutations: () => mutations };
}

test("successful payment invalidates the company list and profile and returns the paid balance", async () => {
  const route = paymentRoute();
  const response = await route.submit();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).invoice.paid_minor, 1000);
  assert.equal(route.mutations(), 1);
  assert.ok(route.paths.includes("/companies"));
  assert.ok(route.paths.includes("/companies/company-a"));
});

test("denied and failed payments cannot invalidate the badge or report successful payment", async () => {
  for (const [options, status] of [[{ denied: true }, 403], [{ mutationFailure: true }, 503]] as const) {
    const route = paymentRoute(options);
    assert.equal((await route.submit()).status, status);
    assert.equal(route.mutations(), 0);
    assert.deepEqual(route.paths, []);
  }
});
