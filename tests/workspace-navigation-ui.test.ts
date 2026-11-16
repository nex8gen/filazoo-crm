import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";
import * as navigation from "../lib/workspace-navigation.ts";
import * as sections from "../lib/settings-sections.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const h = React.createElement;
type Props = Record<string, unknown> & { children?: React.ReactNode };
const replacements: string[] = [];
const router = { replace: (href: string) => { replacements.push(href); } };
const dependencies: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "lucide-react": require("lucide-react"),
  "next/navigation": {
    usePathname: () => window.location.pathname,
    useSearchParams: () => new URLSearchParams(window.location.search),
    useRouter: () => router,
  },
  "next/link": ({ children, ...props }: Props) => h("a", props, children),
  "@/components/ui/input": { Input: (props: Props) => h("input", props) },
  "@/components/workspace-memory": { useWorkspaceState: (_key: string, initial: string) => React.useState(initial) },
  "@/lib/workspace-navigation": navigation,
  "@/lib/settings-sections": sections,
};

function load(file: string) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, React.ComponentType<Props>> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name.endsWith(".css") ? {} : dependencies[name] ?? (() => { throw Error(`Missing dependency: ${name}`); })(), window, document });
  return exports;
}
const provider = load("components/workspace-navigation.tsx");
dependencies["@/components/workspace-navigation"] = provider;
const { SettingsNavigation } = load("app/settings/settings-navigation.tsx");

async function mount(accountId = "staff") {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  async function visit(href: string) {
    window.history.replaceState(null, "", href);
    await React.act(async () => {
      root.render(h(React.StrictMode, {}, h(provider.WorkspaceNavigationProvider, { accountId },
        window.location.pathname.startsWith("/settings") ? h(SettingsNavigation, { isAdmin: true, workspaceName: "Test workspace" }) : h("main", {}, "Workspace"))));
    });
  }
  return {
    visit,
    back: () => host.querySelector<HTMLAnchorElement>("a[aria-label='Back to previous page']"),
    dispose: async () => { await React.act(async () => root.unmount()); host.remove(); },
  };
}

test("the actual Settings back link follows navigation, section changes and a Settings refresh", async () => {
  window.sessionStorage.clear(); replacements.length = 0;
  let ui = await mount();
  try {
    await ui.visit("/");
    await ui.visit("/email?folder=sent&page=2#thread");
    await ui.visit("/settings");
    assert.equal(ui.back()?.getAttribute("href"), "/email?folder=sent&page=2#thread");
    await ui.visit("/settings/appearance");
    assert.equal(ui.back()?.getAttribute("href"), "/email?folder=sent&page=2#thread");
    assert.deepEqual(replacements, []);
    await ui.dispose(); ui = await mount();
    await ui.visit("/settings/appearance");
    assert.equal(ui.back()?.getAttribute("href"), "/email?folder=sent&page=2#thread");
    assert.deepEqual(replacements, []);
    await ui.visit("/"); await ui.visit("/settings");
    assert.equal(ui.back()?.getAttribute("href"), "/");
  } finally { await ui.dispose(); }
});

test("the provider redirects a fresh session to Home without repeating after normal navigation", async () => {
  window.sessionStorage.clear(); replacements.length = 0;
  const ui = await mount();
  try {
    await ui.visit("/companies?search=buyer");
    assert.deepEqual(replacements, ["/"]);
    await ui.visit("/"); await ui.visit("/products"); await ui.visit("/settings/ai");
    assert.equal(ui.back()?.getAttribute("href"), "/products");
    assert.deepEqual(replacements, ["/"]);
  } finally { await ui.dispose(); }
});
