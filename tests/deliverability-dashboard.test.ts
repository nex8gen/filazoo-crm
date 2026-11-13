import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as emailConnections from "../lib/email-connections.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

function dashboard() {
  let refreshes = 0;
  const components = new Proxy({}, { get: (_target, name) => String(name) });
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const dependencies = new Proxy({
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: { useState: (value: unknown) => [value, () => {}], useTransition: () => [false, (work: () => void) => work()], useEffect: () => {}, useMemo: (work: () => unknown) => work() },
    "next/navigation": { useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "next/link": { default: "Link" },
    "@/lib/email-connections": emailConnections,
  }, { get: (target, name) => Reflect.get(target, name) ?? components });
  const exports: { DeliverabilityDashboard?: (props: { overview: emailConnections.EmailConnectionsOverview; canManageTeam: boolean }) => Element } = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/emails-dashboard.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => Reflect.get(dependencies, name))(name) });
  return { render: exports.DeliverabilityDashboard!, refreshes: () => refreshes };
}

const account = (id: string, scope: "personal" | "workspace", active = true): emailConnections.EmailConnectionAccount => ({
  id, scope, email: `${id}@example.test`, name: id, providerId: "gmail", isDefault: false,
  isActive: active, sendConfigured: active, inboxConfigured: false, status: active ? "configured" : "paused",
});

test("connection checks show supplied account configuration without inventing DNS or delivery incidents", () => {
  const ui = dashboard();
  const empty = ui.render({ overview: { accounts: [], error: null }, canManageTeam: false });
  assert.ok(elements(empty).some(element => element.props.title === "No mailboxes connected"));
  const emptyText = JSON.stringify(empty);
  for (const invented of ["noreply@filazoo.com", "Draft #PL-741", "Three contacts", "SPF or DKIM records are missing"]) assert.equal(emptyText.includes(invented), false);
  const error = ui.render({ overview: { accounts: [], error: "Could not load account settings." }, canManageTeam: false });
  assert.ok(elements(error).some(element => element.type === notificationToastModule.NotificationToast && element.props.children === "Could not load account settings."));
  assert.equal(elements(error).some(element => element.props.title === "No mailboxes connected"), false);
});

test("refresh invokes the router and connection actions preserve personal versus team management", () => {
  const ui = dashboard();
  const overview = { accounts: [account("mine", "personal"), account("shared", "workspace", false)], error: null };
  let tree = ui.render({ overview, canManageTeam: false });
  const nodes = elements(tree);
  const refresh = nodes.find(element => element.type === "Button" && Array.isArray(element.props.children) && element.props.children.includes("Refresh"))!;
  (refresh.props.onClick as () => void)();
  assert.equal(ui.refreshes(), 1);
  const personalLink = nodes.find(element => element.props["aria-label"] === "Manage connection for mine@example.test")!;
  assert.equal(personalLink.props.href, "/settings/apps/gmail?scope=personal");
  assert.equal(nodes.some(element => element.props["aria-label"] === "Manage connection for shared@example.test"), false);
  assert.ok(JSON.stringify(tree).includes("Paused"));
  assert.ok(JSON.stringify(tree).includes("Setup needed"));
  tree = ui.render({ overview, canManageTeam: true });
  assert.equal(elements(tree).find(element => element.props["aria-label"] === "Manage connection for shared@example.test")!.props.href, "/settings/apps/gmail?scope=team");
});
