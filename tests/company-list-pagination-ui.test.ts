import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { JSDOM } from "jsdom";
import * as list from "../lib/company-list.ts";
import * as pageCache from "../lib/page-cache.ts";
import * as pagination from "../lib/table-pagination.ts";

test("register fetches a new page on Next, renders server rows and retains newer search typing", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/companies" });
  const globals = ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "IS_REACT_ACT_ENVIRONMENT"];
  const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key] });
  const require = createRequire(import.meta.url);
  const React = require("react"), h = React.createElement;
  const { createRoot } = await import("react-dom/client");
  const host = document.getElementById("root")!;
  const root = createRoot(host);
  type Props = Record<string, unknown> & { children?: unknown };
  const shell = (tag: string) => ({ children, ...props }: Props) => h(tag, props, children);
  const button = ({ children, ...props }: Props) => { delete props.size; delete props.variant; return h("button", props, children); };
  const empty = () => null;
  const navigations: string[] = [];
  const requests: Array<{ url: string; resolve: (response: Response) => void }> = [];
  const fetchMock = (url: string) => new Promise<Response>(resolve => requests.push({ url, resolve }));
  const search = "";
  const router = { replace: (url: string) => { navigations.push(url); }, refresh() {}, push() {} };
  const deps: Record<string, unknown> = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { useRouter: () => router, useSearchParams: () => new URLSearchParams(search) },
    "next/link": { default: ({ ...props }: Props) => { delete props.prefetch; return h("a", props); } },
    "next/image": { default: empty }, "sonner": { toast: { success() {} } },
    "@/app/crm-actions": {}, "@/components/confirm-action-dialog": { ConfirmActionDialog: empty },
    "@/components/data-state": { EmptyState: ({ title }: Props) => h("p", {}, title) },
    "@/components/table-columns-provider": { useTableColumns: () => React.useState({}) },
    "@/components/preferences-provider": { usePreferences: () => ({ preferences: { tablePageSize: 25 } }) },
    "@/lib/company-list": list, "@/lib/country-flags": { countryFlagCode: () => null }, "@/lib/customer-tags": { customerTagValues: [] },
    "@/lib/table-pagination": pagination, "@/lib/page-cache": pageCache,
    "@/components/ui/skeleton": { Skeleton: shell("span") },
    "@/components/ui/button": { Button: button }, "@/components/ui/checkbox": { Checkbox: empty },
    "@/components/ui/card": { Card: shell("section") },
    "@/components/ui/input": { Input: ({ onChange, ...props }: Props) => h("input", { ...props, onInput: onChange }) },
    "@/components/ui/dropdown-menu": Object.fromEntries(["DropdownMenu", "DropdownMenuCheckboxItem", "DropdownMenuContent", "DropdownMenuGroup", "DropdownMenuItem", "DropdownMenuLabel", "DropdownMenuSeparator"].map(name => [name, empty])),
    "@/components/ui/table-columns-trigger": { TableColumnsTrigger: empty },
    "@/components/ui/select": { Select: empty },
    "@/components/ui/table": Object.fromEntries(Object.entries({ Table: "table", TableBody: "tbody", TableCell: "td", TableHead: "th", TableHeader: "thead", TableRow: "tr" }).map(([name, tag]) => [name, shell(tag)])),
    "@/components/ui/table-filters": { TableFilters: shell("div"), TableFilter: ({ children }: Props) => h("div", {}, children) },
    "@/components/language-provider": { useLanguage: () => ({ t: (value: string) => value }) },
    "@/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
  };
  for (const [file, name] of Object.entries({ "assigned-owner": "AssignedOwner", "company-avatar": "CompanyAvatar", "company-order-badge": "CompanyOrderBadge", "customer-tag-badges": "CustomerTagBadge", "company-list-tags": "CompanyListTags", "customer-tag-health": "CustomerTagHealth", "company-list-analytics": "CompanyListAnalytics" })) deps[`@/components/${file}`] = { [name]: empty };
  function load(file: string) {
    const exports: Record<string, unknown> = {};
    const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(source, { exports, require: (id: string) => deps[id] ?? require(id), Set, Map, Intl, Date, URLSearchParams, AbortController, fetch: fetchMock, window: dom.window, setTimeout, clearTimeout });
    return exports;
  }
  deps["@/components/use-cached-page"] = load("../components/use-cached-page.ts");
  deps["@/components/ui/table-pagination"] = load("../components/ui/table-pagination.tsx");
  const Table = load("../components/companies-table.tsx").CompaniesTable;
  const base = list.companyListRequestSchema.parse({});
  function snapshot(page: number, query = "", total = 52) {
    const companies = Array.from({ length: Math.min(25, total - (page - 1) * 25) }, (_, i) => ({ id: `id-${(page - 1) * 25 + i}`, name: `Company ${(page - 1) * 25 + i + 1}`, email: "", ownerName: "Unassigned", country: "Unknown", segment: "Retail", paidOrderCount: 0 }));
    return { result: { mode: "live", companies, total, page, countries: [], segments: [], buckets: [] }, request: { ...base, page, query }, asOf: new Date().toISOString() };
  }
  async function click(label: string) { await React.act(async () => { host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); }); }
  async function respond(value: ReturnType<typeof snapshot>) { await React.act(async () => { requests.at(-1)!.resolve(Response.json(value)); }); }
  async function input(value: string) {
    const node = host.querySelector("input")!;
    await React.act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
  }
  const settleSearch = () => React.act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  try {
    const initial = snapshot(1);
    await React.act(async () => root.render(h(Table, { ...initial, analyticsAsOf: initial.asOf, canDelete: false })));
    assert.equal(requests.length, 0, "Later pages do not load on mount");
    assert.equal(host.querySelectorAll("tbody tr").length, 25);
    await click("Next page");
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url, "http://localhost").searchParams.get("page"), "2");
    assert.equal(host.querySelector('[aria-busy="true"]') !== null, true);
    assert.equal(host.querySelectorAll('tbody tr[aria-hidden="true"]').length, 10, "Skeletons appear while awaiting the page");
    assert.equal(host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.disabled, true);
    await respond(snapshot(2));
    assert.equal(host.querySelectorAll("tbody tr").length, 25, "The server page is never sliced twice");
    assert.ok(host.textContent!.includes("Company 26"));
    await click("Previous page");
    assert.equal(requests.length, 1, "Previous reuses page 1");
    assert.ok(host.querySelector("tbody")!.textContent!.includes("Company 1"));
    await click("Next page");
    assert.equal(requests.length, 1, "Revisiting page 2 makes no request");
    await click("Next page");
    await respond(snapshot(3));
    assert.equal(host.querySelectorAll("tbody tr").length, 2);
    assert.equal(host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.disabled, true);
    await input("buyer"); await settleSearch();
    assert.equal(new URL(requests.at(-1)!.url, "http://localhost").searchParams.get("page"), "1");
    await input("buyer newest");
    await respond(snapshot(1, "buyer"));
    assert.equal(host.querySelector("input")!.value, "buyer newest");
    await settleSearch();
    await respond(snapshot(1, "buyer newest", 0));
    assert.ok(host.textContent!.includes("No companies found"));
    assert.ok(host.querySelector("input"), "Empty results retain filters");
    assert.equal(navigations.length, 0, "Cached paging never starts a full server route navigation");
  } finally {
    await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
