import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as history from "../lib/ai/chat-history.ts";
import * as intent from "../lib/ai/assistant-intent.ts";

const require = createRequire(import.meta.url);

test("continuing history from the inbox sends the saved page, record, AI mode and version", async () => {
  const companyId = "15693adc-0bdf-4617-b214-71b1861764a9";
  const conversationId = "a37acc59-4a11-47db-ad1e-aa9fe5d72e74";
  const slots: unknown[] = [];
  let cursor = 0;
  const react = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      // The page observer has already read the visible inbox in this fixture.
      slots[index] ??= initial && typeof initial === "object" && "pathname" in initial ? { pathname: "/email", context: {} } : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: (read: () => unknown) => read(), useEffect: () => {}, useId: () => "composer",
  };
  function Composer() {}
  const placeholder = () => null;
  const ui = new Proxy({}, { get: () => placeholder });
  let sent: Record<string, unknown> = {};
  let finish: () => void = () => {};
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  const controller = {
    scope: history.conversationScope({ mode: "chat", pathname: "/email", pageContext: {} }),
    conversation: { id: conversationId, mode: "agent", pathname: "/companies", pageContext: { companyId }, version: 3, title: "Saved analysis" },
    loading: false, browseAll: true,
    ensure: async () => ({ conversationId, requestId: "e5555555-5555-4555-8555-555555555555", version: 3 }),
    accept: () => finish(),
  };
  const dependencies: Record<string, unknown> = {
    react,
    "next/navigation": { usePathname: () => "/email", useRouter: () => ({}) },
    "motion/react": { motion: ui },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (text: string) => text }) },
    "@/components/use-ai-conversation": { useAiConversation: () => controller },
    "@/components/ui/ai-mascot-input": { AiMascotInput: Composer },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false, clear: () => {} }) },
    "@/lib/ai/chat-history": history,
    "@/lib/ai/image-input": { chatImageLimitError: () => null },
    "@/lib/ai/agent-progress": { requestedWorkProgress: () => undefined, pageWorkArea: () => "email" },
    "@/lib/ai/page-context": { readAssistantPageContext: () => { throw new Error("Visible inbox must not replace saved context"); } },
  };
  const source = readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  vm.runInNewContext(code, {
    exports, require: (name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui,
    AbortController, performance, crypto,
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "/api/ai/assistant");
      sent = JSON.parse(init.body as string);
      return Response.json({ output: "New saved reply", history: { conversationId, version: 4 } });
    },
  });
  type Element = { type?: unknown; props?: { children?: unknown; onChange?: (value: string) => void; onSend?: () => void } };
  function findComposer(value: unknown): Element | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.map(findComposer).find(Boolean);
    const element = value as Element;
    return element.type === Composer ? element : findComposer(element.props?.children);
  }
  function render() { cursor = 0; return exports.WorkspaceAiAssistant({ open: true, onOpenChange: () => {} }); }
  const composer = findComposer(render());
  assert.ok(composer, "restored Agent mode selects the agent composer");
  composer.props!.onChange!("Continue the saved analysis");
  findComposer(render())!.props!.onSend!();
  await completed;
  assert.equal(sent.mode, "work");
  assert.equal(sent.pathname, "/companies");
  assert.equal(sent.pageLabel, "Companies");
  assert.equal(sent.pageText, "");
  assert.deepEqual(sent.pageContext, { companyId });
  assert.deepEqual(sent.history, { conversationId, requestId: "e5555555-5555-4555-8555-555555555555", version: 3 });
  assert.match(JSON.stringify(render()), /New saved reply/);
});

test("Open in Agent preserves the invoice request and images in a fresh Agent conversation without submitting it", () => {
  const text = "can create a invoice for abe m for pla basic 500 qty";
  const images = [{ id: "invoice-reference", dataUrl: "data:image/png;base64,synthetic", name: "reference.png" }];
  const slots: unknown[] = [];
  let cursor = 0, initializedChat = false;
  let freshScope: unknown;
  let attached: unknown;
  const react = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) {
        if (initial && typeof initial === "object" && "pathname" in initial) slots[index] = { pathname: "/email", context: {} };
        else if (initial && typeof initial === "object" && Object.keys(initial).length === 0 && !initializedChat) {
          initializedChat = true;
          slots[index] = { "/email::chat": [{ id: "user", role: "user", content: text, images }, { id: "reply", role: "assistant", content: "Switch to Agent to continue this request." }] };
        } else slots[index] = initial;
      }
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: (read: () => unknown) => read(), useEffect: () => {}, useId: () => "composer",
  };
  function Composer() {}
  const ui = new Proxy({}, { get: () => () => null });
  const controller = { scope: history.conversationScope({ mode: "chat", pathname: "/email", pageContext: {} }), conversation: null, loading: false, newConversation: (target: unknown) => { freshScope = target; } };
  const dependencies: Record<string, unknown> = {
    react, "next/navigation": { usePathname: () => "/email", useRouter: () => ({}) }, "motion/react": { motion: ui },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (value: string) => value }) },
    "@/components/use-ai-conversation": { useAiConversation: () => controller },
    "@/components/ui/ai-mascot-input": { AiMascotInput: Composer },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false, setImages: (value: unknown) => { attached = value; } }) },
    "@/lib/ai/chat-history": history, "@/lib/ai/assistant-intent": intent,
    "@/lib/ai/agent-progress": { pageWorkArea: () => "email" },
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui, fetch: () => { throw new Error("Handoff must not submit or execute the invoice"); } });
  type Element = { type?: unknown; props?: { children?: unknown; onClick?: () => void; value?: string } };
  function find(value: unknown, match: (element: Element) => boolean): Element | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.map((child) => find(child, match)).find(Boolean);
    const element = value as Element;
    return match(element) ? element : find(element.props?.children, match);
  }
  function render() { cursor = 0; return exports.WorkspaceAiAssistant({ open: true, onOpenChange: () => {} }); }
  const handoff = find(render(), (element) => Boolean(element.props?.onClick) && JSON.stringify(element.props?.children).includes("Open in Agent"));
  assert.ok(handoff);
  handoff.props!.onClick!();
  assert.deepEqual(JSON.parse(JSON.stringify(freshScope)), { mode: "agent", pathname: "/email", pageContext: {} });
  assert.deepEqual(attached, images);
  const composer = find(render(), (element) => element.type === Composer);
  assert.equal(composer?.props?.value, text);
});
