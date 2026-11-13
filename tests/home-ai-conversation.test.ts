import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as history from "../lib/ai/chat-history.ts";
import * as researchRequest from "../lib/ai/research-request.ts";
import * as researchProgress from "../lib/ai/research-progress.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const require = createRequire(import.meta.url);
type Element = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
function find(value: unknown, type: unknown): Element | undefined {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.map(child => find(child, type)).find(Boolean);
  const element = value as Element;
  return element.type === type ? element : find(element.props?.children, type);
}

for (const mode of ["chat", "agent"] as const) for (const fail of [false, true]) {
  test(`Home ${mode} sends once after context is ready and ${fail ? "preserves a failed prompt" : "keeps the reply on the page"}`, async () => {
    const slots: unknown[] = [];
    let cursor = 0, ready = false;
    let effects: (() => unknown)[] = [];
    const react = {
      useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useMemo: (read: () => unknown) => read(), useEffect: (callback: () => unknown) => { effects.push(callback); },
      useEffectEvent: (callback: unknown) => callback, useId: () => "home-conversation",
    };
    function Composer() {}
    function ResizeHandle() {}
    function StreamingText() {}
    function HistoryMenu() {}
    const ui = new Proxy({}, { get: () => () => null });
    const requests: Record<string, unknown>[] = [];
    let creates = 0;
    const controller = {
      scope: history.conversationScope({ pathname: "/", mode }), conversation: null,
      get loading() { return !ready; },
      ensure: async () => { creates++; return { conversationId: "home-history", requestId: "home-request", version: 0 }; },
      accept() {},
    };
    const dependencies: Record<string, unknown> = {
      react, "next/navigation": { usePathname: () => "/", useRouter: () => ({}) }, "motion/react": { motion: ui },
      "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (value: string) => value }) },
      "@/components/use-ai-conversation": { useAiConversation: () => controller },
      "@/components/home-ai-composer": { HomeAiInput: Composer },
      "@/components/column-resize-handle": { ColumnResizeHandle: ResizeHandle },
      "@/components/ai-history-menu": { AiHistoryMenu: HistoryMenu },
      "@/components/ui/ai-agent-response": { StreamingText, ThinkingState: () => null },
      "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false, clear() {}, setImages() {} }) },
      "@/lib/ai/chat-history": history, "@/lib/ai/research-request": researchRequest, "@/lib/ai/research-progress": researchProgress,
      "@/lib/ai/page-context": { readAssistantPageContext: () => ({}), assistantRecordScope: () => "" },
      "@/lib/ai/image-input": { chatImageLimitError: () => null },
      "@/lib/ai/agent-progress": { requestedWorkProgress: () => undefined, pageWorkArea: () => "home" },
    };
    const code = ts.transpileModule(readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const exports: Record<string, (props: unknown) => Element> = {};
    vm.runInNewContext(code, {
      exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui)(name),
      AbortController, performance, crypto,
      document: { querySelector: () => ({ innerText: "Home sales overview" }) },
      MutationObserver: class { observe() {} disconnect() {} },
      fetch: async (url: string, init: RequestInit) => {
        assert.equal(url, "/api/ai/assistant", "opening Home must never execute an agent action");
        requests.push(JSON.parse(init.body as string));
        return Response.json(fail ? { error: "Temporarily unavailable" } : { output: "Here is your sales summary." }, { status: fail ? 503 : 200 });
      },
    });
    let launchRequest = { id: 1, mode, prompt: "Summarize my sales", submit: true };
    let closes = 0;
    function render(open = true, presentation: "page" | "sidebar" = "page") {
      cursor = 0; effects = [];
      const tree = exports.WorkspaceAiAssistant({ open, onOpenChange: () => { closes++; }, launchRequest, presentation });
      for (const effect of effects) effect();
      return tree;
    }
    const page = render();
    assert.equal(page.type, "main");
    assert.equal(page.props?.id, "workspace-ai-content");
    assert.equal(find(page, ResizeHandle), undefined, "page conversations do not resize or use a sidebar");
    assert.equal(find(page, Composer)?.props?.busy, true, "queue waits for context and history readiness");
    assert.equal(requests.length, 0);
    ready = true;
    render(true, "sidebar");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 0, "a delayed Home launch must not send after leaving the page view");
    for (let i = 0; i < 6; i++) { render(); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(creates, 1);
    assert.equal(requests.length, 1, "rerenders must not submit the initial prompt again");
    assert.equal(requests[0].pathname, "/");
    assert.equal(requests[0].mode, mode === "agent" ? "work" : "analyze");
    assert.equal(requests[0].approvalMode, "ask");
    assert.equal((requests[0].messages as { content: string }[])[0].content, launchRequest.prompt);
    const result = render();
    if (fail) assert.equal(find(result, Composer)?.props?.value, launchRequest.prompt, "failed sends remain editable for retry");
    else assert.equal(find(result, StreamingText)?.props?.text, "Here is your sales summary.");
    (find(result, HistoryMenu)?.props?.onClose as () => void)();
    assert.equal(closes, 1, "back to overview closes the page view");
    render(false); render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1, "back and reopen keep the conversation without resubmitting");
    if (!fail) {
      launchRequest = { id: 2, mode, prompt: "Show the next steps", submit: true };
      render();
      assert.equal(requests.length, 1, "a new launch waits for the current reply to finish");
      (find(render(), StreamingText)?.props?.onComplete as () => void)();
      for (let i = 0; i < 6; i++) { render(); await new Promise(resolve => setImmediate(resolve)); }
      assert.equal(requests.length, 2, "a prompt submitted during an active reply must not be dropped");
      assert.equal((requests[1].messages as { content: string }[])[0].content, "Show the next steps");
    }
  });
}
