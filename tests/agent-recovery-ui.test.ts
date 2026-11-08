import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { recoverAgentAction } from "../lib/ai/action-recovery.ts";
import * as history from "../lib/ai/chat-history.ts";

const require = createRequire(import.meta.url);
type Element = { type?: unknown; props?: { children?: unknown; onApprove?: () => Promise<boolean>; result?: { status?: string; success?: string; error?: string } } };
function find(value: unknown, component: unknown): Element | undefined {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.map(child => find(child, component)).find(Boolean);
  const element = value as Element;
  return element.type === component ? element : find(element.props?.children, component);
}

for (const interruption of ["disconnect", "html-response"]) test(`approval recovers a committed action after ${interruption}, with one POST and the saved result shown`, async () => {
  const proposal = { id: "saved-proposal", approvalMode: "ask", action: { type: "write_email" } };
  const slots: unknown[] = [];
  let cursor = 0, seeded = false, writes = 0, reads = 0, refreshes = 0;
  const events: CustomEvent[] = [];
  const react = {
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) {
        if (initial && typeof initial === "object" && "pathname" in initial) slots[index] = { pathname: "/email", context: {} };
        else if (initial && typeof initial === "object" && Object.keys(initial).length === 0 && !seeded) {
          seeded = true;
          slots[index] = { "/email::agent": [{ id: "reply", role: "assistant", content: "Ready for review.", actions: [proposal] }] };
        } else slots[index] = initial;
      }
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useMemo: (read: () => unknown) => read(), useEffect() {}, useEffectEvent: (callback: unknown) => callback, useId: () => "composer",
  };
  function Card() {}
  const ui = new Proxy({}, { get: () => () => null });
  const fetcher: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") {
      writes++;
      if (interruption === "disconnect") throw new Error("Response lost after commit");
      return new Response("<html>proxy interruption</html>", { status: 502 });
    }
    reads++;
    return Response.json({ status: "completed", success: "Email draft prepared.", draft: { to: "buyer@example.com" } });
  };
  const dependencies: Record<string, unknown> = {
    react, "motion/react": { motion: ui },
    "next/navigation": { usePathname: () => "/email", useRouter: () => ({ refresh: () => { refreshes++; } }) },
    "@/components/language-provider": { useLanguage: () => ({ language: "en", t: (text: string) => text }) },
    "@/components/use-ai-conversation": { useAiConversation: () => ({ scope: history.conversationScope({ mode: "agent", pathname: "/email" }), loading: false }) },
    "@/components/ui/ai-image-attachments": { useAiImageAttachments: () => ({ images: [], processing: false }) },
    "@/components/agent-action-card": { AgentActionCard: Card },
    "@/lib/ai/chat-history": history,
    "@/lib/ai/agent-progress": { actionWorkProgress: () => ({ area: "email", label: "Preparing draft…" }), pageWorkArea: () => "email" },
    "@/lib/ai/action-recovery": { recoverAgentAction: (id: string) => recoverAgentAction(id, { fetcher, pause: async () => {} }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../components/workspace-ai-assistant.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: Record<string, (props: unknown) => unknown> = {};
  vm.runInNewContext(code, { exports, require: (name: string) => name === "react/jsx-runtime" ? require(name) : dependencies[name] ?? ui,
    fetch: fetcher, window: { dispatchEvent: (event: CustomEvent) => events.push(event) }, document: { querySelector: () => ({}) }, CustomEvent,
  });
  function render() { cursor = 0; return exports.WorkspaceAiAssistant({ open: true, onOpenChange() {}, launchRequest: { id: "test", mode: "agent" } }); }
  const card = find(render(), Card)!;
  assert.ok(card);
  // The JSX handler intentionally returns void; flush its asynchronous work.
  card.props!.onApprove!();
  for (let attempt = 0; attempt < 20 && !find(render(), Card)?.props?.result?.status; attempt++) await new Promise(resolve => setImmediate(resolve));
  const result = find(render(), Card)!.props!.result!;
  assert.equal(result.status, "completed");
  assert.equal(result.success, "Email draft prepared.");
  assert.equal(result.error, undefined);
  assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(refreshes, 1);
  assert.equal(events[0].detail.draftId, proposal.id);
});
