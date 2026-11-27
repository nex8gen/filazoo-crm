import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import * as historyHelpers from "../lib/ai/chat-history.ts";

const require = createRequire(import.meta.url);
type Element = { type?: unknown; props?: { children?: unknown; onFollowUp?: (question: string) => void; followUpsDisabled?: boolean } };
function find(value: unknown, component: unknown): Element | undefined {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.map(child => find(child, component)).find(Boolean);
  const element = value as Element;
  return element.type === component ? element : find(element.props?.children, component);
}

for (const surface of ["workspace", "company"] as const) test(`${surface} suggestion sends immediately in the saved conversation and rejects a duplicate click`, async () => {
  const slots: unknown[] = [], requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let cursor = 0, seeded = false;
  const previous = [{ id: "answer", role: "assistant", content: "A buyer requested a quote.\nRelated questions: What is blocking this order?" }];
  const react = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) {
        const messages = surface === "company" ? Array.isArray(initial) : initial && typeof initial === "object" && !Array.isArray(initial) && !Object.keys(initial).length;
        if (surface === "workspace" && initial && typeof initial === "object" && "pathname" in initial) slots[index] = { pathname: "/companies", context: {} };
        else if (messages && !seeded) { seeded = true; slots[index] = surface === "company" ? previous : { "/companies::chat": previous }; }
        else slots[index] = initial;
      }
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: (read: () => unknown) => read(), useEffect() {}, useEffectEvent: (callback: unknown) => callback, useId: () => "composer",
  };
  const ui = new Proxy({}, { get: () => () => null });
  function Answer() {}
  const reference = { conversationId: "saved-conversation", requestId: "new-request" };
  const history = { scope: "saved", loading: false, ensure: async () => reference, accept() {} };
  const fetcher = async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ output: "The buyer needs final pricing." });
  };
  const dependencies: Record<string, unknown> = {
    react, "motion/react": { motion: ui },
    "next/navigation": { usePathname: () => "/companies", useRouter: () => ({ refresh() {} }) },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (value: string) => value }) },
    "@/components/ui/ai-agent-response": { StreamingText: Answer, ThinkingState: () => null },
    "@/components/use-ai-conversation": { useAiConversation: () => history },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], files: [], clear() {}, processing: false }) },
    "@/lib/ai/chat-history": historyHelpers,
    "@/lib/ai/page-context": { readAssistantPageContext: () => ({}) },
    "@/lib/ai/research-request": { webSearchForRequest: () => false },
    "@/lib/ai/research-progress": { readResearchResponse: (response: Response) => response.json() },
    "@/lib/ai/session-recovery-fetch": { fetchWithSessionRecovery: fetcher },
    "@/lib/workspace-session-response": { isWorkspaceSessionRetry: () => false },
  };
  const code = ts.transpileModule(readFileSync(new URL(`../components/${surface === "workspace" ? "workspace-ai-assistant" : "company-ai"}.tsx`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui,
    crypto: { randomUUID }, performance, AbortController, fetch: fetcher, setTimeout, clearTimeout,
    document: { querySelector: () => ({ innerText: "Companies" }) }, window: {},
  });
  const render = () => { cursor = 0; return surface === "workspace" ? exports.WorkspaceAiAssistant({ open: true, onOpenChange() {} }) : exports.CompanyAi({ company: { id: "buyer", name: "Buyer" } }); };
  const answer = find(render(), Answer);
  assert.ok(answer?.props?.onFollowUp, "The response is connected to the conversation's send handler");
  assert.equal(answer.props.followUpsDisabled, false);
  answer.props.onFollowUp("What is blocking this order?");
  answer.props.onFollowUp("What is blocking this order?");
  assert.equal(find(render(), Answer)?.props?.followUpsDisabled, true);
  for (let attempt = 0; attempt < 20 && !requests.length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, surface === "workspace" ? "/api/ai/assistant" : "/api/companies/buyer/chat");
  assert.deepEqual(requests[0].body.history, reference);
  assert.deepEqual(requests[0].body.messages, [{ role: "user", content: "What is blocking this order?", ...(surface === "workspace" ? { images: [], files: [] } : {}) }]);
  // Let the simulated request finish and clear its timeout before ending the test.
  for (let attempt = 0; attempt < 5; attempt++) await new Promise(resolve => setImmediate(resolve));
});
