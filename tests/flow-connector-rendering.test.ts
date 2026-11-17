import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import { JSDOM } from "jsdom";
import ts from "typescript";
import * as flows from "../lib/flows.ts";
import * as health from "../lib/flow-connector-health.ts";
import * as connectors from "../lib/flow-connectors.ts";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workflow", pretendToBeVisual: true });
for (const key of ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom.window : dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const styles = document.createElement("style");
styles.textContent = readFileSync(new URL("../components/workflow-editor.css", import.meta.url), "utf8");
document.head.append(styles);

test("health API responses drive the mounted hook, real connector styles and visible issue message", async () => {
  const jobs = new Map<number, () => Promise<void>>();
  let nextJob = 0, requests = 0;
  let mode: "dry-run" | "ready" | "unavailable" | "runtime-failed" = "dry-run";
  let reducedMotion = false;
  const motionListeners = new Set<() => void>();
  const preference = { get matches() { return reducedMotion; }, addEventListener: (_: string, listener: () => void) => motionListeners.add(listener), removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener) };
  Object.defineProperty(dom.window, "matchMedia", { configurable: true, value: () => preference });
  const dependencies: Record<string, unknown> = { "@/lib/flows": flows, "@/lib/flow-connector-health": health, "@/lib/flow-connectors": connectors };
  function load(file: string) {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, {
      exports, window: dom.window, document, AbortSignal, AbortController,
      setTimeout: (job: () => Promise<void>) => { jobs.set(++nextJob, job); return nextJob; },
      clearTimeout: (id: number) => jobs.delete(id),
      require: (name: string) => dependencies[name] ?? require(name),
      fetch: async (url: string) => {
        requests++;
        if (url !== "/api/flows/check") return Response.json({ ok: true, runs: [], hasMore: false });
        if (mode === "unavailable") return Response.json({ ok: false, error: "Sender connections could not be verified" }, { status: 503 });
        return Response.json({ ok: true, status: "ready", checkedAt: new Date().toISOString(), checks: mode === "dry-run" ? [{ id: "sending", status: "warning", detail: "This server is in dry-run mode." }] : [{ id: "senders", status: "passed", detail: "Authenticated" }] });
      },
    });
    return exports;
  }
  const useHealth = load("../components/use-flow-connector-health.ts").useFlowConnectorHealth as typeof import("../components/use-flow-connector-health.ts").useFlowConnectorHealth;
  const Connector = load("../components/flow-connector.tsx").FlowConnector as typeof import("../components/flow-connector.tsx").FlowConnector;
  const Notice = load("../components/flow-health-notice.tsx").FlowHealthNotice as typeof import("../components/flow-health-notice.tsx").FlowHealthNotice;
  const flow = { ...structuredClone(flows.defaultFlowInput), status: "live" as const };
  function Canvas({ definition }: { definition: flows.FlowInput }) {
    const result = useHealth(definition, "saved-flow");
    return React.createElement("div", { className: "workflow-editor", "data-flow-health": result.state },
      React.createElement(Notice, { health: result, onReview: () => {} }),
      React.createElement("svg", { "aria-hidden": true }, ...definition.steps.map((step, index) => React.createElement(Connector, { key: step.id, actionId: step.id, state: result.actions?.[step.id!]?.state ?? result.connectionState, from: { x: 0, y: index * 56 }, to: { x: 388, y: (index + 1) * 56 } }))));
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const connector = (id: string) => host.querySelector(`[data-flow-connector-action="${id}"]`)!;
  const animated = (id = flow.steps[0].id!) => connector(id).querySelector("animateTransform") !== null;
  async function refresh() {
    const [id, job] = jobs.entries().next().value!;
    jobs.delete(id);
    // Runtime-history reads use the production helper's default fetch.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => Response.json({ ok: true, runs: mode === "runtime-failed" && String(input).includes("status=failed") ? [{ status: "failed", currentActionId: flow.steps[2].id, flow_run_logs: [{ error: "Task assignment failed", created_at: "2026-11-17" }] }] : [], hasMore: false })) as typeof fetch;
    try { await React.act(async () => { await job(); }); }
    finally { globalThis.fetch = originalFetch; }
  }
  try {
    await React.act(async () => root.render(React.createElement(Canvas, { definition: flow })));
    assert.equal(host.firstElementChild?.getAttribute("data-flow-health"), "unknown");
    await refresh();
    assert.equal(host.firstElementChild?.getAttribute("data-flow-health"), "error");
    assert.match(host.querySelector('[role="status"]')!.textContent!, /Email delivery is temporarily unavailable/);
    assert.doesNotMatch(host.querySelector('[role="status"]')!.textContent!, /dry.run|SMTP|server|administrator|FLOW_DRY_RUN/i);
    assert.equal(dom.window.getComputedStyle(connector(flow.steps[1].id!)).getPropertyValue("--wf-connector-accent").trim(), "#e5484d");
    assert.equal(animated(flow.steps[1].id!), false);
    assert.equal(animated(), true, "The wait connection keeps animating when sending is blocked");
    assert.equal(animated(flow.steps[2].id!), true, "CRM tasks are unaffected by dry-run email blocking");

    mode = "ready";
    await refresh();
    assert.equal(host.firstElementChild?.getAttribute("data-flow-health"), "live");
    assert.equal(animated(), true);
    const gradientMotion = connector(flow.steps[0].id!).querySelector("linearGradient > animateTransform")!;
    assert.equal(gradientMotion.getAttribute("repeatCount"), "indefinite");
    assert.equal(gradientMotion.getAttribute("attributeName"), "gradientTransform");
    assert.equal(connector(flow.steps[0].id!).querySelectorAll("path").length, 1, "The highlight moves on the original stroke, with no second block");
    assert.equal(host.querySelector("[stroke-dasharray]"), null);
    assert.equal(connector(flow.steps[0].id!).querySelector('stop[offset="76%"]')!.getAttribute("stop-color"), "var(--wf-connector-color)", "The blue highlight fades back into the base line");
    assert.equal(host.querySelector('[role="status"]'), null);

    await React.act(async () => { reducedMotion = true; motionListeners.forEach(listener => listener()); });
    assert.equal(animated(), false, "Reduced motion leaves the single gradient stroke still");
    assert.equal(connector(flow.steps[0].id!).querySelectorAll("path").length, 1);
    await React.act(async () => { reducedMotion = false; motionListeners.forEach(listener => listener()); });
    assert.equal(animated(), true);

    mode = "runtime-failed";
    await refresh();
    assert.equal(connector(flow.steps[2].id!).getAttribute("data-flow-health"), "error");
    assert.equal(animated(flow.steps[2].id!), false);
    assert.equal(animated(), true);
    assert.equal(animated(flow.steps[1].id!), true);

    mode = "unavailable";
    await refresh();
    assert.equal(host.firstElementChild?.getAttribute("data-flow-health"), "unknown");
    assert.match(host.querySelector('[role="status"]')!.textContent!, /Sender connections could not be verified/);
    assert.equal(animated(), false);

    const previousRequests = requests;
    await React.act(async () => root.render(React.createElement(Canvas, { definition: { ...flow, status: "paused" } })));
    assert.equal(host.firstElementChild?.getAttribute("data-flow-health"), "idle");
    assert.equal(animated(), false);
    assert.equal(jobs.size, 0);
    assert.equal(requests, previousRequests);
  } finally {
    await React.act(async () => root.unmount());
    host.remove(); dom.window.close();
  }
});
