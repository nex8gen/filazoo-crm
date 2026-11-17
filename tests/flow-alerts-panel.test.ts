import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as alertsModel from "../lib/flow-alerts.ts";
import { blankStep, defaultFlowInput, type FlowInput } from "../lib/flows.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workflow", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const output = {} as typeof import("../components/flow-alerts-panel.tsx");
const Button = (props: Record<string, unknown>) => React.createElement("button", Object.fromEntries(Object.entries(props).filter(([key]) => !["variant", "size"].includes(key))));
const dependencies: Record<string, unknown> = {
  "@/components/ui/button": { Button },
  "@/components/language-provider": { useLanguage: () => ({ t: (text: string) => text }) },
  "@/lib/flow-alerts": alertsModel,
};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/flow-alerts-panel.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports: output, require: (name: string) => dependencies[name] ?? require(name) });

test("workflow alert bell and sidebar reflect edits, setup navigation, dismissal, restore and resolution without account notifications", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const email = blankStep("send_email");
  const flow: FlowInput = { ...structuredClone(defaultFlowInput), status: "draft", steps: [email] };
  const reviewed: string[] = [];
  let requests = 0;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => { requests++; throw new Error("No account notification requests should run"); }) as typeof fetch;
  function Fixture({ definition, canEdit = true }: { definition: FlowInput; canEdit?: boolean }) {
    const [open, setOpen] = React.useState(false), [dismissed, setDismissed] = React.useState<string[]>([]);
    const alerts = alertsModel.flowAlerts(definition), lists = alertsModel.partitionFlowAlerts(alerts, dismissed);
    return React.createElement(React.Fragment, null,
      React.createElement(output.FlowAlertsBell, { panelId: "alerts", count: lists.active.length, open, onToggle: () => setOpen(!open) }),
      open ? React.createElement(output.FlowAlertsPanel, { id: "alerts", ...lists, canEdit, onClose: () => setOpen(false), onReview: alert => reviewed.push(alert.actionId || alert.target),
        onDismiss: alert => setDismissed([...dismissed, alertsModel.flowAlertKey(alert)]), onRestore: alert => setDismissed(dismissed.filter(key => key !== alertsModel.flowAlertKey(alert))) }) : null);
  }
  const click = async (element: Element | null | undefined) => { assert.ok(element); await React.act(async () => { element.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); }); };
  const button = (label: string) => [...host.querySelectorAll("button")].find(button => button.textContent === label);
  const bell = () => host.querySelector<HTMLButtonElement>('[aria-label="Workflow alerts"]')!;
  try {
    await React.act(async () => root.render(React.createElement(Fixture, { definition: flow })));
    assert.equal(bell().querySelector(".wf-alert-count")?.textContent, "1");
    assert.equal(host.querySelector("aside"), null);
    await click(bell());
    assert.match(host.querySelector("article")!.textContent!, /Set up email/);
    await click(button("Set up"));
    assert.deepEqual(reviewed, [email.id]);
    await click(button("Dismiss"));
    assert.equal(bell().querySelector(".wf-alert-count"), null);
    assert.match(host.querySelector('[role="tabpanel"]')!.textContent!, /No active alerts/);
    const tabs = host.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    await React.act(async () => { tabs[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    assert.equal(tabs[1].getAttribute("aria-selected"), "true");
    assert.equal(document.activeElement, tabs[1]);
    assert.match(host.querySelector("article")!.textContent!, /Set up email/);
    await click(button("Restore"));
    assert.equal(bell().querySelector(".wf-alert-count")?.textContent, "1");
    assert.equal(tabs[0].getAttribute("aria-selected"), "true");
    const fixed = { ...flow, steps: [{ ...email, config: { ...email.config, templateId: "helpful_reminder" } }] };
    await React.act(async () => root.render(React.createElement(Fixture, { definition: fixed })));
    assert.equal(host.querySelector("article"), null);
    assert.equal(bell().querySelector(".wf-alert-count"), null);
    await React.act(async () => root.render(React.createElement(Fixture, { definition: flow, canEdit: false })));
    assert.ok(button("Review")); assert.equal(button("Set up"), undefined);
    await React.act(async () => { host.querySelector("aside")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(bell().getAttribute("aria-expanded"), "false");
    assert.equal(requests, 0);
  } finally { globalThis.fetch = oldFetch; await React.act(async () => root.unmount()); host.remove(); }
});
