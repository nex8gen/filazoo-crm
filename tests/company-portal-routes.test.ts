import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { companyPortalHref } from "../lib/company-portal.ts";
import * as portal from "../lib/customer-portal.ts";
const require = createRequire(import.meta.url);
const companyA = "a37acc59-4a11-47db-ad1e-aa9fe5d72e74";
const companyB = "15693adc-0bdf-4617-b214-71b1861764a9";
const invoiceId = "717cd1d4-0739-4f3f-bbba-a331c7422f31";
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
function handlers(file: string, overrides: Record<string, unknown> = {}, role = "admin") {
  const exports: { GET?: Handler; POST?: Handler } = {};
  const deps: Record<string, unknown> = {
    "@/lib/invoice-api": {
      invoiceAccess: async (write = false) => !role || role === "customer" ? { response: Response.json({ error: "Unauthorized" }, { status: 401 }) } : write && role === "viewer" ? { response: Response.json({ error: "Read only" }, { status: 403 }) } : { viewer: { id: companyA, role } },
      checkInvoiceOrigin: (request: Request) => request.headers.get("origin") !== new URL(request.url).origin ? Response.json({ error: "Origin" }, { status: 403 }) : undefined,
      invoiceError: () => Response.json({ error: "Failed" }, { status: 409 }),
    },
    "@/lib/data/customer-portal": { portalHeaders: { "Cache-Control": "private, no-store" } },
    "@/lib/company-portal": { companyPortalHref },
    "@/lib/customer-portal": portal,
    "next/cache": { revalidatePath() {} },
    ...overrides,
  };
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name), Response, Request, URL, console });
  return exports;
}
const context = (id = invoiceId) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown, origin = "https://crm.example") => new Request(`https://crm.example${url}`, { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("profile shortcuts select the correct invoice and portal tab", () => {
  assert.equal(companyPortalHref(companyA, invoiceId), `/companies/${companyA}?tab=customer-portal&invoiceId=${invoiceId}`);
});
test("staff sign-in preserves the selected portal tab and invoice", async () => {
  const { NextRequest, NextResponse } = require("next/server");
  const source = ts.transpileModule(readFileSync(new URL("../lib/supabase/proxy.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { updateSession?: (request: unknown) => Promise<Response> } = {};
  vm.runInNewContext(source, { exports, require: (name: string) => name === "@supabase/ssr" ? { createServerClient: () => ({ auth: { getClaims: async () => ({ data: null }) } }) } : name === "next/server" ? { NextResponse } : require(name), process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test", AUTH_REQUIRED: "true" } } });
  const path = companyPortalHref(companyA, invoiceId);
  const response = await exports.updateSession!(new NextRequest(`https://crm.example${path}`));
  const target = new URL(response.headers.get("location")!);
  assert.equal(target.pathname, "/login");
  assert.equal(target.searchParams.get("next"), path);
});
test("company portal listing is staff-only and passes the company scope to the data loader", async () => {
  let calls = 0;
  const deps = { "@/lib/data/company-portal": { getCompanyPortal: async (...args: unknown[]) => { calls++; assert.deepEqual(args, [companyA, 2, invoiceId]); return { invoices: [], selected: null }; } } };
  for (const role of ["", "customer"]) {
    const route = handlers("../app/api/companies/[id]/portal/route.ts", deps, role);
    assert.equal((await route.GET!(new Request(`https://crm.example/api/companies/${companyA}/portal`), context(companyA))).status, 401);
  }
  assert.equal(calls, 0);
  const route = handlers("../app/api/companies/[id]/portal/route.ts", deps, "viewer");
  const response = await route.GET!(new Request(`https://crm.example/api/companies/${companyA}/portal?page=2&invoiceId=${invoiceId}`), context(companyA));
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});
test("a forged company scope cannot read or write another customer's conversation or tracking", async () => {
  let reads = 0;
  const route = handlers("../app/api/invoices/[id]/portal/route.ts", {
    "@/lib/data/invoices": { getInvoice: async () => ({ id: invoiceId, company_id: companyA, status: "issued" }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => { reads++; throw new Error("Must not reach portal tables"); } },
  });
  const url = `/api/invoices/${invoiceId}/portal?companyId=${companyB}`;
  assert.equal((await route.GET!(new Request(`https://crm.example${url}`), context())).status, 404);
  assert.equal((await route.POST!(post(url, { action: "reply", id: invoiceId, body: "wrong customer" }), context())).status, 404);
  assert.equal(reads, 0);
});
test("viewer and customer roles cannot connect invoices or create customer profiles", async () => {
  let writes = 0;
  for (const role of ["viewer", "customer", ""]) {
    const route = handlers("../app/api/invoices/[id]/customer/route.ts", { "@/lib/supabase/admin": { createSupabaseAdmin: () => { writes++; throw new Error("No write"); } } }, role);
    assert.ok([401, 403].includes((await route.POST!(post(`/api/invoices/${invoiceId}/customer`, { action: "create-profile" }), context())).status));
  }
  assert.equal(writes, 0);
});
test("profile connection uses the current staff actor and returns a selected-invoice link", async () => {
  let input: unknown;
  const route = handlers("../app/api/invoices/[id]/customer/route.ts", { "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ rpc: async (name: string, args: unknown) => { assert.equal(name, "connect_portal_invoice_customer"); input = args; return { data: companyB, error: null }; } }) } });
  const response = await route.POST!(post(`/api/invoices/${invoiceId}/customer`, { action: "link-profile", companyId: companyB }), context());
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(input), JSON.stringify({ p_invoice_id: invoiceId, p_actor_id: companyA, p_company_id: companyB }));
  assert.equal((await response.json()).href, companyPortalHref(companyB, invoiceId));
  assert.equal((await route.POST!(post(`/api/invoices/${invoiceId}/customer`, { action: "create-profile" }, "https://other.example"), context())).status, 403);
});
