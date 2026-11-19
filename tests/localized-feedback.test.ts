import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { translateUiText } from "../lib/i18n.ts";
import type { AppLanguage } from "../lib/app-language.ts";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return typeof value === "string" ? value : "";
}

function mount(file: string, exportName: string, props: Record<string, unknown>, dependencies: Record<string, unknown> = {}) {
  const state: unknown[] = [];
  let cursor = 0;
  let language: AppLanguage = "zh-CN";
  const transitions: Promise<unknown>[] = [];
  const controls = new Proxy({}, { get: (_, name) => name === "buttonVariants" ? () => "button" : String(name) });
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
      useRef: (value: unknown) => ({ current: value }), useId: () => "id",
      useTransition: () => [false, (fn: () => Promise<unknown>) => { transitions.push(fn()); }],
    },
    "react/jsx-runtime": { jsx: (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: unknown, props: Record<string, unknown>) => ({ type, props }) },
    "next/navigation": { useRouter: () => ({ refresh() {}, push() {} }) },
    "@/components/language-provider": { useLanguage: () => ({ language, t: (value: string) => translateUiText(value, language) }) },
    ...dependencies,
  };
  const exports: Record<string, (props: Record<string, unknown>) => unknown> = {};
  const code = ts.transpileModule(readFileSync(`components/${file}.tsx`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => modules[name] ?? controls, Error, Intl, Date, URL, fetch: async () => ({ ok: false, json: async () => ({}) }) });
  const render = (locale = language) => { language = locale; cursor = 0; return exports[exportName](props); };
  return { render, async click(label: string) { const button = elements(render()).find(item => item.type === "Button" && (text(item.props.children) === label || item.props["aria-label"] === label)); assert.ok(button, label); await (button.props.onClick as () => unknown)(); await Promise.all(transitions.splice(0)); } };
}

test("company analysis errors follow the current language after an asynchronous refresh", async () => {
  const ui = mount("company-analysis-dashboard", "CompanyAnalysisDashboard", { companyId: "company-1", canWrite: true, preferredCurrency: "USD", initial: null }, {
    "@/app/company-analysis-actions": { loadCompanyAnalysis: async () => { throw new Error("offline"); } },
  });
  await ui.click("刷新分析");
  assert.ok(text(ui.render()).includes("无法刷新采购分析，请重试。"));
  const english = text(ui.render("en"));
  assert.ok(english.includes("Analysis could not be refreshed. Please try again."));
  assert.ok(!english.includes("无法刷新"));
  assert.ok(text(ui.render("zh-CN")).includes("无法刷新采购分析，请重试。"));
});

test("quotation save and reload errors do not retain the language active when the request started", async () => {
  const initial = { items: [], shippingMinor: 0, preShipmentPercent: 100 };
  const ui = mount("quotation-workspace", "QuotationWorkspace", { initialDetail: { initial, catalog: { id: "quote-1", product_snapshot: [], quote_status: "draft", currency: "USD" }, canWrite: true } }, {
    "@/lib/invoices": { formatMoney: () => "$0.00" },
    "@/lib/quotations": { buildQuotation: () => ({ subtotalMinor: 0, totalMinor: 0 }), quotationState: () => "draft", quotationLabel: () => "Quotation", quotationStatusLabels: { draft: "Draft" }, quotationShareBlockers: () => [], quotationToday: () => "2026-11-19" },
  });
  await ui.click("保存报价");
  assert.ok(text(ui.render()).includes("无法保存报价。"));
  const english = text(ui.render("en"));
  assert.ok(english.includes("Unable to save the quotation."));
  assert.ok(!english.includes("无法保存报价"));
  ui.render("zh-CN"); await ui.click("刷新");
  assert.ok(text(ui.render()).includes("无法刷新报价。"));
  assert.ok(text(ui.render("en")).includes("Unable to reload the quotation."));
});
