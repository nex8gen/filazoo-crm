import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssistantActivity } from "../lib/ai/research-progress.ts";

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL("../components/ui/ai-agent-response.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function render(props: Record<string, unknown>, expanded: boolean | null = null) {
  const exports: { ThinkingState?: (props: unknown) => React.ReactNode } = {};
  let state = 0;
  vm.runInNewContext(code, { exports, require: (name: string) => {
    if (name === "react") return { useState: () => [state++ === 0 ? expanded : 0, () => {}], useEffect: () => {}, useId: () => "activity-details" };
    if (name.endsWith(".css")) return {};
    if (name === "@/components/language-provider") return { useLanguage: () => ({ t: (value: string) => value }) };
    if (name === "@/components/ui/thinking-indicator") return { ThinkingGlyph: () => null };
    if (name === "@/components/agent-work-icon") return { AgentWorkIcon: () => null };
    if (name === "@/lib/ai/agent-progress") return { agentWorkAreaLabels: { email: "Email" } };
    if (name.startsWith("@/")) return {};
    return require(name);
  } });
  return renderToStaticMarkup(exports.ThinkingState!({ scope: "Home", ...props }));
}

const steps: AssistantActivity[] = [
  { id: "context", label: "Loading workspace context", status: "complete", durationMs: 40 },
  { id: "records", label: "Looking up saved records", status: "active", detail: "products · PLA Basic" },
];

test("the activity timeline exposes completed and running stages with a current status and expandable details", () => {
  const html = render({ working: true, steps });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-controls="activity-details"/);
  assert.match(html, /role="status"[^>]*>Looking up saved records/);
  assert.match(html, /data-activity-status="complete"/);
  assert.match(html, /data-activity-status="active"/);
  assert.match(html, /products · PLA Basic/);
  assert.match(html, /0\.0s/);
  assert.doesNotMatch(html, /Preparing an answer from saved customer records/);
});

test("finished replies retain their timeline collapsed and can be expanded; failed work stays visible", () => {
  const complete = steps.map(step => ({ ...step, status: "complete" }));
  assert.match(render({ working: false, steps: complete, durationMs: 2500 }), /aria-expanded="false"/);
  assert.match(render({ working: false, steps: complete }, true), /aria-expanded="true"/);
  const failed = render({ working: false, failed: true, steps: [{ ...steps[1], status: "failed" }] });
  assert.match(failed, /Request interrupted/);
  assert.match(failed, /aria-expanded="true"/);
  assert.match(failed, /data-activity-status="failed"/);
  assert.match(failed, /Failed/);
});

test("execution progress retains its real action label and user-provided text is escaped", () => {
  const html = render({ working: true, activity: { area: "email", label: "Sending email…", detail: "<script>private()</script>" } });
  assert.match(html, /Sending email…/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|Connecting to assistant/);
});

test("interrupted requests retain their error reason beside the failed activity", () => {
  const errorMessage = "AI provider authentication failed. Ask an administrator to refresh the connection.";
  const html = render({ working: false, failed: true, errorMessage, steps: [{ id: "plan", label: "Preparing the action plan", status: "failed" }] });
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(errorMessage));
  assert.match(html, /Preparing the action plan/);
  assert.doesNotMatch(render({ working: false, errorMessage }), /AI provider authentication failed/);
});
