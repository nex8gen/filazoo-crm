import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as model from "../lib/crm-model.ts";
import { companyTab, companyTabHref, companyTabs } from "../lib/company-tabs.ts";

const require = createRequire(import.meta.url);
const id = "4913b683-bcec-4079-b424-6fd559ed0c2a";
const baseRow = { id, name: "Acme", domain: "acme.test", source: "manual", status: "new", pipeline: [{ stage: "new", owner_id: "owner-1" }], meta_leads: [], company_profiles: [] };
const contact = { id: "contact-1", name: "Primary", role: "Buyer", email: "buyer@acme.test", verification_status: "verified" };
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name in deps ? deps[name] : name.startsWith("react") ? require(name) : {}, process: { env: { NODE_ENV: "test" } }, Date, Intl, console });
  return exports;
}
function profileFixture(options: { denied?: boolean; demo?: boolean; missing?: boolean; failure?: string; owner?: boolean } = {}) {
  let authorized = false;
  const reads: string[] = [];
  const calls: Array<[string, string, ...unknown[]]> = [];
  const avatarIds: string[][] = [];
  let releaseOwners: () => void = () => {};
  const avatarsStarted = new Promise<void>(resolve => { releaseOwners = resolve; });
  const client = { from(table: string) {
    assert.ok(authorized, "authentication precedes all data access");
    reads.push(table);
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "maybeSingle"]) query[method] = (...args: unknown[]) => { calls.push([table, method, ...args]); return query; };
    query.then = async (resolve: (value: unknown) => void) => {
      if (table === "workspace_members") await avatarsStarted;
      const data = table === "companies" ? options.missing ? null : { ...baseRow, pipeline: options.owner === false ? [] : baseRow.pipeline, contacts: [contact, { ...contact, id: "contact-2", email: "second@acme.test" }], customer_billing_profiles: [{ profile: { currency: "EUR", address: "Billing address" } }] }
        : table === "contacts" ? [contact, { ...contact, id: "contact-2", email: "second@acme.test" }]
        : table === "customer_billing_profiles" ? { profile: { currency: "EUR", address: "Billing address" } }
        : table === "workspace_members" ? { display_name: "Alice" } : null;
      resolve({ data: options.failure === table ? null : data, error: options.failure === table ? { message: "offline" } : null });
    };
    return query;
  } };
  const api = load("../lib/data/crm.ts", {
    "../auth.ts": { requireWorkspaceMember: async () => { if (options.denied) throw new Error("Unauthorized"); authorized = true; } },
    "../env.ts": { env: { authRequired: true }, hasSupabaseConfig: () => !options.demo },
    "../supabase/admin.ts": { createSupabaseAdmin: () => client },
    "../crm-model.ts": model,
    "../order-estimate.ts": { metaOrderLabel: () => "" },
    "./cached-member-avatars.ts": { resolveMemberAvatars: async (ids: string[]) => { avatarIds.push([...ids]); releaseOwners(); return new Map([["owner-1", "/owner.png"]]); } },
  });
  return { api, reads, calls, avatarIds };
}

test("profile loads only profile tables, retains primary contact and billing fields, and resolves only its owner's avatar", { timeout: 5000 }, async () => {
  const fixture = profileFixture();
  const result = await fixture.api.getCompanyProfile(id) as { details: { company: Record<string, unknown>; contacts: unknown[]; commerce: { currency: string }; activity: unknown[] } };
  assert.deepEqual(fixture.reads.sort(), ["companies", "workspace_members"].sort());
  assert.equal(result.details.company.contact, "Primary");
  assert.equal(result.details.company.email, contact.email);
  assert.equal(result.details.company.ownerName, "Alice");
  assert.equal(result.details.company.ownerAvatarUrl, "/owner.png");
  assert.equal(result.details.contacts.length, 2);
  assert.equal(result.details.commerce.currency, "EUR");
  assert.equal(result.details.activity.length, 0);
  assert.deepEqual(fixture.avatarIds, [["owner-1"]]);
  assert.ok(fixture.calls.some(call => call[0] === "companies" && call[1] === "eq" && call[2] === "id" && call[3] === id));
  assert.ok(fixture.calls.some(call => call[0] === "companies" && call[1] === "order" && call[2] === "created_at" && (call[3] as { referencedTable: string }).referencedTable === "contacts"));
  assert.ok(!fixture.calls.some(call => call[1] === "select" && /emails\(/.test(String(call[2]))));
});

test("profile rejects unauthenticated reads and avoids data reads in demo or for malformed IDs", async () => {
  const denied = profileFixture({ denied: true });
  await assert.rejects(denied.api.getCompanyProfile(id), /Unauthorized/);
  assert.equal(denied.reads.length, 0);
  for (const options of [{ demo: true }, {}]) {
    const fixture = profileFixture(options);
    assert.equal((await fixture.api.getCompanyProfile(options.demo ? id : "invalid") as { details: unknown }).details, null);
    assert.equal(fixture.reads.length, 0);
  }
});

test("missing profiles stay missing, unassigned profiles need no owner query, and read errors are surfaced", async () => {
  const missing = profileFixture({ missing: true });
  assert.equal((await missing.api.getCompanyProfile(id) as { details: unknown }).details, null);
  assert.ok(!missing.reads.includes("workspace_members"));
  const unassigned = profileFixture({ owner: false });
  const result = await unassigned.api.getCompanyProfile(id) as { details: { company: { ownerName: string } } };
  assert.equal(result.details.company.ownerName, "Unassigned");
  assert.ok(!unassigned.reads.includes("workspace_members"));
  for (const failure of ["companies"]) await assert.rejects(profileFixture({ failure }).api.getCompanyProfile(id), /offline/);
});

const sectionNames = { analyse: "CompanyAnalysis", invoices: "CompanyInvoices", "customer-portal": "CompanyCustomerPortal", email: "CompanyEmails", "purchase-orders": "CompanyPurchaseOrders", history: "CompanyTimeline" };
async function renderPage(tab?: string, role = "admin", compose?: string, invoiceId?: string) {
  const rendered: Array<{ name: string; props: Record<string, unknown> }> = [];
  const reads: string[] = [];
  const details = { company: { ...baseRow, name: "Acme", nextFollowupAt: null, currency: "USD", ownerId: "owner-1", email: contact.email }, commerce: { currency: "EUR" }, contacts: [contact], activity: [] };
  const leaf = (name: string) => (props: Record<string, unknown>) => { rendered.push({ name, props }); return null; };
  const deps: Record<string, unknown> = {
    "react": require("react"),
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { notFound: () => { throw new Error("Not found"); } },
    "next/link": { default: leaf("Link") },
    "@/lib/company-tabs": { companyTab },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "staff", role, email: "staff@example.com" }) },
    "@/lib/data/crm": { getCompanyProfile: async () => { reads.push("profile"); return { details }; }, getCompanyDetails: async () => { reads.push("history"); return { details }; } },
    "@/lib/data/members": { listBdSalesManagers: async (options: { withAvatars: boolean }) => { assert.equal(options.withAvatars, false); return []; } },
    "@/components/ui/button": { buttonVariants: () => "" },
    "@/components/company-workspace": { CompanyWorkspace: (props: Record<string, unknown>) => { rendered.push({ name: "CompanyWorkspace", props }); return [props.toolbar, props.profile, props.section]; } },
    "@/components/page-skeletons": { CompanyDetailsSkeleton: leaf("skeleton") },
    "@/components/workspace-skeletons": { CompanyBillingSkeleton: leaf("skeleton") },
    "lucide-react": { ArrowLeft: leaf("icon") },
  };
  for (const [file, name] of Object.entries({ "company-analysis": "CompanyAnalysis", "company-invoices": "CompanyInvoices", "company-customer-portal": "CompanyCustomerPortal", "company-emails": "CompanyEmails", "company-purchase-orders": "CompanyPurchaseOrders", "company-timeline": "CompanyTimeline", "company-details": "CompanyDetails", "assigned-owner": "AssignedOwner", "company-avatar": "CompanyAvatar", "company-actions-menu": "CompanyActionsMenu" })) deps["@/components/" + file] = { [name]: leaf(name) };
  const page = load("../app/companies/[id]/page.tsx", deps);
  async function visit(node: unknown): Promise<void> {
    if (Array.isArray(node)) { for (const child of node) await visit(child); return; }
    if (!node || typeof node !== "object") return;
    const element = node as { type: unknown; props: { children?: unknown } };
    if (typeof element.type === "function") await visit(await element.type(element.props));
    else await visit(element.props?.children);
  }
  await visit(await page.default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ tab, compose, invoiceId }) }));
  return { rendered, reads };
}

test("opening the default or unknown company tab does not execute history or any secondary section", async () => {
  for (const tab of [undefined, "invalid-tab"]) {
    const result = await renderPage(tab);
    assert.deepEqual(result.reads, ["profile"]);
    assert.ok(!result.rendered.some(item => Object.values(sectionNames).includes(item.name)));
    assert.equal(result.rendered.find(item => item.name === "CompanyWorkspace")?.props.initialTab, "profile");
    assert.ok(result.rendered.some(item => item.name === "CompanyDetails"));
  }
});

for (const [tab, name] of Object.entries(sectionNames)) test(`company tab ${tab} renders only its requested section`, async () => {
  const { rendered, reads } = await renderPage(tab);
  assert.deepEqual(rendered.filter(item => Object.values(sectionNames).includes(item.name)).map(item => item.name), [name]);
  assert.deepEqual(reads, tab === "history" ? ["profile", "history"] : ["profile"]);
});

test("email compose and selected-invoice links preserve inputs and viewer restrictions", async () => {
  const compose = await renderPage("email", "admin", "1");
  assert.equal(compose.rendered.find(item => item.name === "CompanyEmails")?.props.composeTo, contact.email);
  const viewer = await renderPage("email", "viewer", "1");
  assert.equal(viewer.rendered.find(item => item.name === "CompanyEmails")?.props.composeTo, undefined);
  assert.equal(viewer.rendered.find(item => item.name === "CompanyDetails")?.props.canWrite, false);
  const portal = await renderPage("customer-portal", "viewer", undefined, "invoice-1");
  assert.equal(portal.rendered.find(item => item.name === "CompanyCustomerPortal")?.props.invoiceId, "invoice-1");
  assert.equal(portal.rendered.find(item => item.name === "CompanyCustomerPortal")?.props.canWrite, false);
});

test("tab URLs preserve invoice context, clear compose outside email, and stay on company routes", () => {
  for (const tab of companyTabs) assert.equal(companyTab(tab), tab);
  assert.equal(companyTab(["email"]), "profile");
  assert.equal(companyTab("javascript:alert(1)"), "profile");
  const invoices = new URL(companyTabHref(id, "?tab=email&compose=1&invoiceId=selected", "invoices"), "http://localhost");
  assert.equal(invoices.searchParams.get("invoiceId"), "selected");
  assert.equal(invoices.searchParams.get("compose"), null);
  assert.equal(invoices.searchParams.get("tab"), "invoices");
  assert.equal(companyTabHref(id, "?tab=email&compose=1", "profile"), "/companies/" + id);
  assert.ok(companyTabHref("../elsewhere", "", "history").startsWith("/companies/..%2Felsewhere?"));
});
