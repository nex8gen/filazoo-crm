import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as dates from "../lib/date-picker.ts";
import type { DatePickerProps } from "../components/ui/date-picker.tsx";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/email" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const dynamic = require("next/dist/shared/lib/app-dynamic") as (loader: () => Promise<unknown>, options?: unknown) => React.ComponentType;
const h = React.createElement;
const PopoverContext = React.createContext<{ open: boolean; onOpenChange: (value: boolean) => void }>({ open: false, onOpenChange: () => {} });

test("a cold calendar download stays inside its popup and preserves the page, draft and scheduled time", async () => {
  let releaseCalendar!: (value: { default: React.ComponentType<{ onSelect: (date: Date) => void }> }) => void;
  const calendarDownload = new Promise<{ default: React.ComponentType<{ onSelect: (date: Date) => void }> }>(resolve => { releaseCalendar = resolve; });
  const dependencies: Record<string, unknown> = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/dynamic": { default: (_loader: unknown, options: unknown) => dynamic(() => calendarDownload, options) },
    "lucide-react": { CalendarDays: () => h("svg") },
    cn: { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
    "@/components/language-provider": { useLanguage: () => ({ language: "en" }) },
    "@/lib/date-picker": dates,
    "@/components/ui/notification-toast": { NotificationToast: () => null },
    "@/components/ui/button": { Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => h("button", props) },
    "@/components/ui/input": { Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => h("input", props) },
    // Keep portal positioning out of this suspension regression; use Next's real
    // App Router dynamic loader and the DatePicker's real open/value handlers.
    "@/components/ui/popover": {
      Popover: ({ children, ...value }: React.PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void }>) => h(PopoverContext.Provider, { value }, children),
      PopoverTrigger: ({ render, children }: { render: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>; children: React.ReactNode }) => {
        const popover = React.useContext(PopoverContext);
        return React.cloneElement(render, { onClick: () => popover.onOpenChange(!popover.open) }, children);
      },
      PopoverContent: ({ children }: React.PropsWithChildren) => React.useContext(PopoverContext).open ? h("div", { "data-calendar-popup": true }, children) : null,
    },
  };
  const exports = {} as { DatePicker: React.ComponentType<DatePickerProps> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/ui/date-picker.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require(name: string) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  let submissions = 0;
  function FollowupForm() {
    const [value, setValue] = React.useState("2026-11-25T12:44");
    return h("form", { onSubmit: event => { event.preventDefault(); submissions++; } },
      h("textarea", { "aria-label": "Follow-up draft", defaultValue: "Do you have any questions about the quote?" }),
      h(exports.DatePicker, { includeTime: true, required: true, "aria-label": "Follow-up date and time", value, onValueChange: setValue }));
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await React.act(async () => root.render(h(React.Suspense, { fallback: h("div", { "data-page-loading": true }, "Page loading") }, h(FollowupForm))));
    const draft = host.querySelector("textarea")!;
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Follow-up date and time"]')!;
    assert.equal(trigger.type, "button");
    await React.act(async () => trigger.click());
    assert.ok(host.querySelector('[role="status"][aria-label="Loading calendar"]'));
    assert.equal(host.querySelector("[data-page-loading]"), null, "Downloading the calendar must not replace the page with its loading fallback");
    assert.equal(host.querySelector("textarea"), draft);
    assert.equal(draft.value, "Do you have any questions about the quote?");
    assert.equal(submissions, 0);
    await React.act(async () => releaseCalendar({ default: ({ onSelect }) => h("button", { type: "button", "data-calendar-day": true, onClick: () => onSelect(dates.parsePickerDate("2026-11-27")!) }, "November 27") }));
    await React.act(async () => host.querySelector<HTMLButtonElement>("[data-calendar-day]")!.click());
    assert.equal(host.querySelector<HTMLInputElement>('input[type="time"]')!.value, "12:44");
    assert.match(trigger.textContent!, /Nov 27, 2026/);
    await React.act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Done")!.click());
    assert.equal(host.querySelector("[data-calendar-popup]"), null);
    assert.equal(host.querySelector("textarea"), draft);
    assert.equal(submissions, 0);
  } finally {
    await React.act(async () => root.unmount()); host.remove();
  }
});
