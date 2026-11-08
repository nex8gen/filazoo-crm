import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as history from "../lib/ai/chat-history.ts";
import * as intent from "../lib/ai/assistant-intent.ts";
import * as researchRequest from "../lib/ai/research-request.ts";
import * as researchProgress from "../lib/ai/research-progress.ts";

const require = createRequire(import.meta.url);

test("sidebar history stays enabled across close and reopen while drafts remain editable and survive automatic restore", () => {
  const slots: unknown[] = [];
  let cursor = 0;
  const react = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      slots[index] ??= initial && typeof initial === "object" && "pathname" in initial ? { pathname: "/email", context: {} } : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: (read: () => unknown) => read(), useEffect: () => {}, useEffectEvent: (callback: unknown) => callback, useId: () => "composer",
  };
  function Composer() {}
  const ui = new Proxy({}, { get: () => () => null });
  const enabledValues: boolean[] = [];
  const preparedModes: string[] = [];
  let restore: (detail: unknown, prepend?: boolean, preserveDraft?: boolean) => void = () => {};
  let clears = 0;
  const controller = {
    scope: history.conversationScope({ mode: "chat", pathname: "/email" }),
    conversation: { mode: "agent", pathname: "/email" }, loading: true,
    ensure: () => { throw new Error("Do not send before the saved conversation is ready"); },
  };
  const dependencies: Record<string, unknown> = {
    react, "next/navigation": { usePathname: () => "/email", useRouter: () => ({}) }, "motion/react": { motion: ui },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (value: string) => value }) },
    "@/components/use-ai-conversation": { useAiConversation: (input: { mode: string }, callback: typeof restore, enabled: boolean, _browseAll: boolean, autoResume: boolean) => { assert.equal(autoResume, false, "messages must not load until a history title is selected"); if (input.mode === "chat") restore = callback; preparedModes.push(input.mode); enabledValues.push(enabled); return controller; } },
    "@/components/ui/ai-mascot-input": { AiMascotInput: Composer },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false, clear: () => { clears++; } }) },
    "@/lib/ai/chat-history": history, "@/lib/ai/assistant-intent": intent, "@/lib/ai/research-request": researchRequest,
    "@/lib/ai/agent-progress": { pageWorkArea: () => "email" },
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui });
  type Element = { type?: unknown; props?: { children?: unknown; busy?: boolean; loadingHistory?: boolean; value?: string; onChange?: (value: string) => void; onSend?: () => void } };
  function findComposer(value: unknown): Element | undefined {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.map(findComposer).find(Boolean);
    const element = value as Element;
    return element.type === Composer ? element : findComposer(element.props?.children);
  }
  function render(open = true) { cursor = 0; return exports.WorkspaceAiAssistant({ open, onOpenChange: () => {} }); }
  assert.equal(render(false), null, "background preparation must not mount hidden animations");
  assert.deepEqual(preparedModes, ["chat", "agent"], "both modes prepare before the sidebar is opened");
  const composer = findComposer(render())!;
  assert.equal(composer.props!.busy, false, "history loading must not simulate a working agent or disable typing");
  assert.equal(composer.props!.loadingHistory, true, "sending still waits for saved history");
  composer.props!.onChange!("My draft while history loads");
  findComposer(render())!.props!.onSend!();
  render(false);
  assert.equal(findComposer(render())!.props!.value, "My draft while history loads");
  assert.ok(enabledValues.every(Boolean), "closing the sidebar must not disable and restart history");
  const detail = { messages: [], actionResults: {} };
  restore(detail, false, true);
  assert.equal(findComposer(render())!.props!.value, "My draft while history loads");
  assert.equal(clears, 0, "automatic history restore must preserve attachments too");
  restore(detail);
  assert.equal(findComposer(render())!.props!.value, "", "explicitly opening another conversation clears the prior draft");
  assert.equal(clears, 1);
});

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
    useMemo: (read: () => unknown) => read(), useEffect: () => {}, useEffectEvent: (callback: unknown) => callback, useId: () => "composer",
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
    "@/lib/ai/chat-history": history, "@/lib/ai/research-request": researchRequest, "@/lib/ai/research-progress": researchProgress,
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
    useMemo: (read: () => unknown) => read(), useEffect: () => {}, useEffectEvent: (callback: unknown) => callback, useId: () => "composer",
  };
  function Composer() {}
  const ui = new Proxy({}, { get: () => () => null });
  const controller = { scope: history.conversationScope({ mode: "chat", pathname: "/email", pageContext: {} }), conversation: null, loading: false, newConversation: (target: unknown) => { freshScope = target; } };
  const chatController = { ...controller, newConversation: () => { throw new Error("The handoff must reset the Agent controller, not the Chat controller"); } };
  const dependencies: Record<string, unknown> = {
    react, "next/navigation": { usePathname: () => "/email", useRouter: () => ({}) }, "motion/react": { motion: ui },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (value: string) => value }) },
    "@/components/use-ai-conversation": { useAiConversation: (input: { mode: string }) => input.mode === "agent" ? controller : chatController },
    "@/components/ui/ai-mascot-input": { AiMascotInput: Composer },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false, setImages: (value: unknown) => { attached = value; } }) },
    "@/lib/ai/chat-history": history, "@/lib/ai/assistant-intent": intent, "@/lib/ai/research-request": researchRequest,
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
