import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as history from "../lib/ai/chat-history.ts";
import * as researchRequest from "../lib/ai/research-request.ts";
import * as researchProgress from "../lib/ai/research-progress.ts";
import * as sessionRecovery from "../lib/ai/session-recovery-fetch.ts";
import * as sessionResponse from "../lib/workspace-session-response.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const require = createRequire(import.meta.url);
for (const turnOff of [false, true]) test(`Analytics composer sends explicit company research with search ${turnOff ? "off after a manual choice" : "automatically enabled"}`, async () => {
  const slots: unknown[] = []; let cursor = 0;
  const react = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial && typeof initial === "object" && "pathname" in initial ? { pathname: "/analytics", context: {} } : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: (read: () => unknown) => read(), useEffect: () => {}, useEffectEvent: (callback: unknown) => callback, useId: () => "composer",
  };
  function Toggle() {}
  const ui = new Proxy({}, { get: () => () => null });
  let sent: Record<string, unknown> | undefined, finish: () => void = () => {};
  const completed = new Promise<void>(resolve => { finish = resolve; });
  const controller = { scope: history.conversationScope({ mode: "chat", pathname: "/analytics", pageContext: {} }), conversation: null, loading: false, ensure: async () => undefined, accept: () => finish() };
  const dependencies: Record<string, unknown> = {
    react, "next/navigation": { usePathname: () => "/analytics", useRouter: () => ({}) }, "motion/react": { motion: ui },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (value: string) => value }) },
    "@/components/use-ai-conversation": { useAiConversation: () => controller },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false, clear: () => {} }) },
    "@/components/ui/customer-research": { WebSearchOption: Toggle, CustomerResearchSources: () => null },
    "@/lib/ai/chat-history": history, "@/lib/ai/research-request": researchRequest,
    "@/lib/ai/research-progress": researchProgress,
    "@/lib/ai/session-recovery-fetch": sessionRecovery,
    "@/lib/workspace-session-response": sessionResponse,
    "@/lib/ai/image-input": { chatImageLimitError: () => null },
    "@/lib/ai/agent-progress": { pageWorkArea: () => "analytics" },
    "@/lib/ai/page-context": { readAssistantPageContext: () => ({}) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui)(name),
    document: { querySelector: () => ({ innerText: "Aggregate analytics metrics" }) }, AbortController, performance, crypto,
    fetch: async (_url: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return Response.json({ output: "Synthetic report" }); },
  });
  type Element = { type?: unknown; props?: { children?: unknown; enabled?: boolean; onChange?: (value: unknown) => void; onSubmit?: (event: { preventDefault: () => void }) => void } };
  function find(value: unknown, type: unknown): Element | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.map(child => find(child, type)).find(Boolean);
    const element = value as Element; return element.type === type ? element : find(element.props?.children, type);
  }
  function render() { cursor = 0; return exports.WorkspaceAiAssistant({ open: true, onOpenChange: () => {} }); }
  find(render(), "textarea")!.props!.onChange!({ target: { value: "Research Inovecell again." } });
  assert.equal(find(render(), Toggle)?.props?.enabled, true, "the visible search button enables before submission");
  if (turnOff) find(render(), Toggle)!.props!.onChange!(false);
  assert.equal(find(render(), Toggle)?.props?.enabled, !turnOff);
  find(render(), "form")!.props!.onSubmit!({ preventDefault() {} });
  await completed;
  assert.equal(sent?.webSearch, !turnOff); assert.equal(sent?.pathname, "/analytics"); assert.equal(sent?.mode, "analyze");
});
