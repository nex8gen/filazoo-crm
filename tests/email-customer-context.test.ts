import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import * as customer from "../lib/email-customer-context.ts";
import { canViewEmail } from "../lib/email-access.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

const require = createRequire(import.meta.url);
const dom = new JSDOM("<!doctype html><body></body>");
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
function load<T>(file: string, deps: Record<string, unknown>): T {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, require: (name: string) => deps[name] ?? require(name), window, document, URL, Request, Response, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: (...args: Parameters<typeof fetch>) => fetch(...args) });
  return exports as T;
}
const company = { id: "company", name: "3d play makers", email: "markgard@gmail.com", contact: "Mark Gardner", contactRole: "Purchasing", website: "", country: "United States", city: "", segment: "Print farm", summary: "Filament inquiry", tags: ["PLA"], fitScore: 7, currency: "USD", ownerId: "enphany", ownerName: "Enphany", ownerInitials: "EN", ownerAvatarUrl: "/enphany.webp" };

test("customer API validates addresses, scopes lookups to the viewer, and surfaces failures without inventing an unassigned owner", async () => {
  const calls: string[][] = [];
  const viewer = { id: "viewer", role: "admin" };
  let fail = false;
  const route = load<{ GET(request: Request): Promise<Response> }>("../app/api/email/customer-context/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => viewer },
    "@/lib/workspace-context": { withWorkspaceViewer: async (actual: unknown, run: () => Promise<Response>) => { assert.equal(actual, viewer); return run(); } },
    "@/lib/data/email-customer-context": { readEmailCustomerContext: async (actual: unknown, mailboxId: string, email: string) => { assert.equal(actual, viewer); calls.push([mailboxId, email]); if (fail) throw Error("Private database error"); return mailboxId === "mine" ? customer.emailCustomerContext(company) : null; } },
  });
  assert.equal((await route.GET(new Request("https://crm.test/api/email/customer-context?mailboxId=mine&email=bad"))).status, 400);
  assert.equal(calls.length, 0);
  const response = await route.GET(new Request("https://crm.test/api/email/customer-context?mailboxId=mine&email=MARKGARD%40gmail.com"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).context.ownerName, "Enphany");
  assert.deepEqual(calls[0], ["mine", company.email]);
  assert.equal((await route.GET(new Request("https://crm.test/api/email/customer-context?mailboxId=private&email=markgard%40gmail.com"))).status, 404);
  fail = true;
  const unavailable = await route.GET(new Request("https://crm.test/api/email/customer-context?mailboxId=mine&email=markgard%40gmail.com"));
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /Private database error|Unassigned/);
});

test("a targeted lookup returns the real company and owner from either authorized mailbox", async () => {
  const lookups: string[] = [];
  let fail = false;
  const api = load<typeof import("../lib/data/email-customer-context.ts")>("../lib/data/email-customer-context.ts", {
    "../email-access.ts": { canViewEmail }, "../email-customer-context.ts": customer,
    "./mailboxes.ts": { getViewerMailbox: async (_viewer: string, id: string) => id === "mine" ? { id, type: "personal", userId: "viewer" } : id === "team" ? { id, type: "workspace" } : null },
    "./email-access.ts": { getAssignedEmailContacts: async () => new Map() },
    "./inbox-companies.ts": { listInboxCompanies: async (messages: InboxEmailItem[]) => { if (fail) throw Error("Database unavailable"); lookups.push(messages[0].contact); return { companies: messages[0].contact === company.email ? [company] : [] }; } },
  });
  const viewer = { id: "viewer", role: "admin" } as Parameters<typeof api.readEmailCustomerContext>[0];
  for (const mailbox of ["mine", "team"]) {
    const result = await api.readEmailCustomerContext(viewer, mailbox, ` ${company.email.toUpperCase()} `);
    assert.equal(result?.companyId, company.id);
    assert.equal(result?.ownerName, "Enphany");
  }
  assert.equal(await api.readEmailCustomerContext(viewer, "private-account", company.email), null);
  assert.equal(await api.readEmailCustomerContext({ ...viewer, role: "bd_manager" }, "team", company.email), null);
  assert.equal(lookups.length, 2);
  assert.equal((await api.readEmailCustomerContext(viewer, "mine", "unknown@example.test"))?.companyId, null);
  fail = true;
  await assert.rejects(api.readEmailCustomerContext(viewer, "mine", company.email), /Database unavailable/);
});

test("the sidebar company name links to the exact customer profile", () => {
  const ui = load<{ ContactSummary: React.ComponentType<{ name: string; email: string; company: string; companyId: string; canCreateInvoices: boolean }> }>("../components/contact-summary.tsx", {
    "next/link": ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => React.createElement("a", { href, ...props }, children),
    "@/components/email-sender-avatar": { EmailSenderAvatar: () => null },
  });
  const html = renderToStaticMarkup(React.createElement(ui.ContactSummary, { name: company.contact, email: company.email, company: company.name, companyId: company.id, canCreateInvoices: false }));
  const page = new JSDOM(html).window.document;
  assert.equal([...page.querySelectorAll("a")].find(link => link.textContent === company.name)?.getAttribute("href"), "/companies/company");
});

test("content refresh and a temporary lookup failure retain a verified company and assignment", () => {
  const linked = customer.emailCustomerContext(company);
  const raw = { id: "message", contact: company.email, company: "Unknown company", ownerName: "Unassigned" } as InboxEmailItem;
  const retained = customer.applyEmailCustomerContext(raw, { context: linked, status: "error", updatedAt: 1 });
  assert.equal(retained.companyId, company.id);
  assert.equal(retained.ownerName, "Enphany");
  assert.equal(retained.company, company.name);
  assert.equal(customer.applyEmailCustomerContext(raw, { status: "pending", updatedAt: 0 }).ownerName, "Loading customer details…");
  assert.equal(customer.applyEmailCustomerContext(raw, { status: "error", updatedAt: 0 }).ownerName, "Customer details unavailable");
});

test("focused lookup handles fast account switches and retry without leaking stale results", async () => {
  const requests: Array<{ url: string; resolve(response: Response): void }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => new Promise<Response>(resolve => requests.push({ url, resolve }))) as typeof fetch;
  const background = load<typeof import("../components/use-background-refresh.ts")>("../components/use-background-refresh.ts", { react: React });
  const hooks = load<typeof import("../components/use-email-customer-context.ts")>("../components/use-email-customer-context.ts", { react: React, "./use-background-refresh": background });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let state: ReturnType<typeof hooks.useEmailCustomerContext>;
  function Probe({ mailbox }: { mailbox: string }) { state = hooks.useEmailCustomerContext(mailbox, company.email, true); return null; }
  async function render(mailbox: string) { await React.act(() => root.render(React.createElement(Probe, { mailbox }))); }
  async function respond(index: number, value: unknown, status = 200) { await React.act(async () => { requests[index].resolve(Response.json(value, { status })); await new Promise(resolve => setImmediate(resolve)); }); }
  try {
    await render("mine");
    await render("team");
    assert.equal(new URL(requests[1].url, "https://crm.test").searchParams.get("mailboxId"), "team");
    await respond(1, { email: company.email, context: customer.emailCustomerContext(company) });
    assert.equal(state!.entries[`team:${company.email}`].context?.ownerName, "Enphany");
    await respond(0, { email: company.email, context: { companyId: "wrong-company", ownerName: "Wrong owner" } });
    assert.equal(state!.entries[`team:${company.email}`].context?.companyId, company.id);
    await React.act(() => state!.retry());
    await respond(2, { error: "Temporary failure" }, 503);
    assert.equal(state!.entries[`team:${company.email}`].status, "error");
    assert.equal(state!.entries[`team:${company.email}`].context?.companyId, company.id);
    await React.act(() => state!.retry());
    await respond(3, { email: company.email, context: { ...customer.emailCustomerContext(company), ownerName: "New owner" } });
    assert.equal(state!.entries[`team:${company.email}`].context?.ownerName, "New owner");
  } finally { await React.act(() => root.unmount()); host.remove(); globalThis.fetch = originalFetch; }
});
