"use client";

import { useLanguage } from "@/components/language-provider";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUpRight, ChevronDown, Copy, CornerDownLeft, MessageCircle, PanelRightClose, Plus, RotateCcw } from "lucide-react";
import { AiIcon } from "@/components/ai-icon";
import { ColumnResizeHandle } from "@/components/column-resize-handle";
import { Button } from "@/components/ui/button";
import { StreamingText, ThinkingState } from "@/components/ui/ai-agent-response";
import AgentAvatar from "@/components/ui/components-primitives-avatar";
import { AgentActionCard } from "@/components/agent-action-card";
import type { AgentActionResult, AgentProposal } from "@/lib/ai/agent-actions";
import { actionWorkProgress, pageWorkArea, requestedWorkProgress, type AgentWorkProgress } from "@/lib/ai/agent-progress";
import { AgentWorkIcon } from "@/components/agent-work-icon";
import { AgentApprovalMenu } from "@/components/agent-approval-menu";

type Mode = "chat" | "agent";
type Message = { id: string; role: "user" | "assistant"; content: string; actions?: AgentProposal[]; durationMs?: number; work?: AgentWorkProgress };

const pageNames: Array<[RegExp, string]> = [
  [/^\/companies\/[^/]+/, "Company profile"],
  [/^\/companies/, "Companies"],
  [/^\/segments/, "Segments"],
  [/^\/invoices/, "Invoices"],
  [/^\/emails/, "Email"],
  [/^\/messenger/, "Messenger"],
  [/^\/lead-channel\/ai-agent/, "AI Automation"],
  [/^\/catalogs\/companies/, "Company Catalogs"],
  [/^\/catalogs/, "Products"],
  [/^\/settings/, "Settings"],
  [/^\/$/, "Overview"],
];

const starters: Record<Mode, Array<[string, string]>> = {
  chat: [
    ["Summarize this page", "Summarize the most important information on this page."],
    ["Find risks", "What risks, gaps, or items needing attention can you identify on this page?"],
    ["Recommend next steps", "Based on what is visible here, what should I focus on next?"],
  ],
  agent: [
    ["Create an invoice", "Create an invoice using this email or customer profile. Use the conversation and saved customer details, and ask only for missing information."],
    ["Email this invoice", "Prepare an email for this invoice using the customer's past correspondence and attach the invoice PDF in the inbox composer."],
    ["Update customer details", "Help me fill in this customer's profile using the open email and saved information. Ask which fields to update if I haven't specified them."],
    ["Update invoice items", "Help me update this draft invoice's products, quantities and bank details. Ask me what to change."],
  ],
};

function visiblePageText() {
  const main = document.querySelector<HTMLElement>("#workspace-content");
  if (!main) return "";
  return (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 14_000);
}

export function WorkspaceAiAssistant({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { language, t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const pageLabel = useMemo(() => pageNames.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Workspace", [pathname]);
  const [mode, setMode] = useState<Mode>("chat");
  const [recordScope, setRecordScope] = useState("");
  const [approvalMode, setApprovalMode] = useState<"ask" | "auto">("ask");
  const [question, setQuestion] = useState("");
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, AgentActionResult>>({});
  const [activeWork, setActiveWork] = useState<AgentWorkProgress | null>(null);
  const [workPage, setWorkPage] = useState(pageLabel);
  const actionLock = useRef(false);
  const [animation, setAnimation] = useState<{ id: string; run: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chatKey = `${pathname}:${recordScope}:${mode}`;
  const messages = useMemo(() => chats[chatKey] ?? [], [chatKey, chats]);
  const busy = pending || Boolean(animation) || Boolean(applying);

  useEffect(() => {
    const main = document.querySelector("#workspace-content");
    if (!main) return;
    const readScope = () => setRecordScope(main.querySelector<HTMLElement>("[data-ai-email-id]")?.dataset.aiEmailId || main.querySelector<HTMLElement>("[data-ai-invoice-id]")?.dataset.aiInvoiceId || main.querySelector<HTMLElement>("[data-ai-company-id]")?.dataset.aiCompanyId || "");
    readScope();
    const observer = new MutationObserver(readScope);
    observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ai-email-id", "data-ai-invoice-id", "data-ai-company-id"] });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => () => abort.current?.abort(), [language]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, animation, applying]);
  useEffect(() => {
    if (!applying) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function readProgress() {
      let finished = false;
      try {
        const response = await fetch(`/api/ai/assistant/action?id=${encodeURIComponent(applying!)}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (response.ok && !controller.signal.aborted) {
          if (result.progress?.label) setActiveWork(result.progress);
          finished = ["completed", "failed", "declined"].includes(result.status);
        }
      } catch { /* The action response remains authoritative if progress is unavailable. */ }
      if (!controller.signal.aborted && !finished) timer = setTimeout(() => void readProgress(), 1_000);
    }
    void readProgress();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [applying]);
  async function send(value = question) {
    const content = value.trim();
    if (!content || busy || abort.current || actionLock.current) return;
    const next: Message[] = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    setChats((current) => ({ ...current, [chatKey]: next }));
    setQuestion("");
    setError(null);
    const work = mode === "agent" ? requestedWorkProgress(content, pageLabel) : undefined;
    setActiveWork(work ?? null);
    setWorkPage(pageLabel);
    setPending(true);
    const controller = new AbortController();
    abort.current = controller;
    const started = performance.now();
    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          mode: mode === "agent" ? "work" : "analyze",
          approvalMode,
          completedActionIds: Object.values(chats).flat().flatMap((message) => message.actions ?? []).filter((proposal) => ["completed", "failed", "unknown"].includes(actionResults[proposal.id]?.status ?? "")).map((proposal) => proposal.id).slice(-20),
          pageContext: {
            emailId: document.querySelector<HTMLElement>("[data-ai-email-id]")?.dataset.aiEmailId || undefined,
            invoiceId: document.querySelector<HTMLElement>("[data-ai-invoice-id]")?.dataset.aiInvoiceId || undefined,
            companyId: document.querySelector<HTMLElement>("[data-ai-company-id]")?.dataset.aiCompanyId || new URLSearchParams(window.location.search).get("companyId") || undefined,
          },
          pathname,
          pageLabel,
          pageText: visiblePageText(),
          messages: next.slice(-15).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.output !== "string") throw new Error(result?.error || "Unable to reach Filazoo AI.");
      const id = crypto.randomUUID();
      setChats((current) => ({
        ...current,
        [chatKey]: [...(current[chatKey] ?? next), { id, role: "assistant", content: result.output, actions: result.actions, durationMs: performance.now() - started, work }],
      }));
      setAnimation({ id, run: 1 });
      // Auto approval applies only to proposals created by this request. Changing
      // the selector never executes older proposals waiting for review.
      if (mode === "agent" && approvalMode === "auto") {
        for (const proposal of (result.actions ?? []) as AgentProposal[]) {
          if (controller.signal.aborted) break;
          if (!await applyAction(proposal, "approve", "auto")) break;
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Unable to reach Filazoo AI.");
        setChats((current) => ({ ...current, [chatKey]: (current[chatKey] ?? []).filter((message) => message.id !== next.at(-1)?.id) }));
        setQuestion(content);
      }
    } finally {
      if (abort.current === controller) abort.current = null;
      setPending(false);
    }
  }

  function newChat() {
    abort.current?.abort();
    abort.current = null;
    setPending(false);
    setAnimation(null);
    setChats((current) => ({ ...current, [chatKey]: [] }));
    setQuestion("");
    setError(null);
    input.current?.focus();
  }

  async function copy(message: Message) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => current === message.id ? null : current), 1_500);
    } catch {
      setError("Copy is unavailable. Select the response and copy it manually.");
    }
  }

  async function applyAction(proposal: AgentProposal, decision: "approve" | "decline" = "approve", approval: "manual" | "auto" = "manual") {
    const actionId = proposal.id;
    if (actionLock.current || actionResults[actionId]?.status) return false;
    actionLock.current = true;
    setApplying(actionId);
    const progress = actionWorkProgress(proposal.action);
    setActiveWork(decision === "decline" ? { ...progress, label: "Declining action…" } : progress);
    setWorkPage(pageLabel);
    setActionResults((current) => ({ ...current, [actionId]: {} }));
    try {
      const response = await fetch("/api/ai/assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: actionId, decision, approval }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.success !== "string") {
        setActionResults((current) => ({ ...current, [actionId]: { error: result?.error || "The action could not be completed.", href: result?.href, status: result?.status || "failed" } }));
        router.refresh();
        return false;
      }
      setActionResults((current) => ({ ...current, [actionId]: result }));
      if (decision === "approve") {
        router.refresh();
        window.dispatchEvent(new CustomEvent("filazoo:agent-action", { detail: { draftId: result.draft ? actionId : undefined } }));
        if (result.draft && !document.querySelector(".email-workspace")) router.push(`/emails?agentDraft=${actionId}`);
      }
      return true;
    } catch (reason) {
      setActionResults((current) => ({ ...current, [actionId]: { error: `${reason instanceof Error ? reason.message : "The action could not be confirmed."} Check Invoices and Sent before starting another task.`, status: "unknown" } }));
      return false;
    } finally {
      setApplying(null);
      actionLock.current = false;
    }
  }

  return <aside data-ai-workspace aria-label="Filazoo AI workspace" aria-hidden={!open} inert={!open ? true : undefined} className={`fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l bg-background transition-transform duration-300 ease-out lg:top-12 lg:w-[var(--workspace-ai-width)] ${open ? "translate-x-0" : "translate-x-full"}`}>
        <ColumnResizeHandle label="AI sidebar width" variable="--workspace-ai-preferred-width" container="[data-workspace-shell]" panel="[data-ai-workspace]" min={320} max={720} reverse className="ai-sidebar-resize" />
        <div className="flex items-center gap-2 border-b bg-background/95 p-3">
          <div className="grid min-w-0 flex-1 grid-cols-2 rounded-2xl bg-muted/70 p-1" role="tablist" aria-label="AI mode">
            {(["chat", "agent"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} disabled={busy} onClick={() => { setMode(value); setAnimation(null); setError(null); setQuestion(""); }} className={`flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl px-3 text-left transition-all disabled:opacity-50 ${mode === value ? "bg-background text-foreground shadow-[0_1px_5px_rgba(15,23,42,.08)] ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground"}`}>
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${mode === value ? "bg-muted" : ""}`}>{value === "chat" ? <MessageCircle className="size-[18px]" /> : <AgentAvatar size="sm" color="violet" shape="squircle" glow={false} className="!size-6" />}</span><span className="min-w-0"><span className="block text-xs font-semibold">{value === "chat" ? "Chat" : "Agent"}</span><span className="block truncate text-[10px] font-normal text-muted-foreground">{value === "chat" ? "Ask & analyze" : "Plan & act"}</span></span>
            </button>)}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onOpenChange(false)} aria-label="Close AI workspace"><PanelRightClose /></Button>
        </div>

        <div ref={log} role="log" aria-live="polite" aria-busy={busy} className="relative min-h-0 flex-1 overflow-y-auto px-5 py-6">
          {!messages.length ? <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden rounded-3xl py-8 before:pointer-events-none before:absolute before:inset-x-8 before:top-[18%] before:h-56 before:rounded-full before:bg-violet-500/[0.045] before:blur-3xl dark:before:bg-violet-400/[0.055]">
            <div className="mx-auto flex max-w-sm flex-col items-center text-center">
              <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3, ease: "easeInOut", repeat: Infinity }} className="relative z-10 mb-5 flex items-center justify-center">
                {mode === "agent" ? <AgentAvatar size="lg" color="violet" shape="squircle" glow={false} className="!size-20" /> : <AiIcon className="size-12" />}
              </motion.div>
              <h2 className="relative z-10 text-lg font-semibold tracking-tight">{mode === "chat" ? "What would you like to know?" : "What should I take care of?"}</h2>
              <p className="relative z-10 mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{mode === "chat" ? `Ask about ${pageLabel}, find patterns, or get a concise recommendation.` : approvalMode === "ask" ? "Use the open email, invoice or customer profile to create invoices, prepare replies and update customer details. Review each action before it runs." : "Use the open email, invoice or customer profile to create invoices, prepare replies and update customer details. Requested actions run automatically."}</p>
            </div>
            <div className="relative z-10 mx-auto mt-7 grid w-full max-w-sm gap-2">{starters[mode].map(([label, prompt]) => <button key={label} type="button" onClick={() => void send(t(prompt))} className="group flex min-h-12 items-center justify-between rounded-2xl border bg-background/90 px-4 text-left text-sm shadow-[0_1px_3px_rgba(15,23,42,.03)] transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"><span>{label}</span><ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" /></button>)}</div>
            <motion.button type="button" aria-label="Focus the AI message box" onClick={() => input.current?.focus()} animate={{ y: [0, 5, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }} className="mt-7 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronDown className="size-5" /></motion.button>
          </div> : <div className="space-y-5">{messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-muted px-4 py-3" : "group max-w-full"}>
            {message.role === "user" ? <p data-no-translate className="whitespace-pre-wrap text-sm leading-6">{message.content}</p> : <>
              <ThinkingState working={false} writing={animation?.id === message.id} durationMs={message.durationMs} scope={t(pageLabel)} activity={message.work} className="mb-2" />
              <StreamingText key={`${message.id}-${animation?.id === message.id ? animation.run : 0}`} text={message.content} animate={animation?.id === message.id} onProgress={() => { const viewport = log.current; if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120) viewport.scrollTop = viewport.scrollHeight; }} onComplete={() => setAnimation((current) => current?.id === message.id ? null : current)} />
              {animation?.id === message.id ? <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => setAnimation(null)}>Show full reply</Button> : <>
              <div className="mt-2 flex gap-1"><Button type="button" variant="ghost" size="xs" className="text-muted-foreground" disabled={busy} onClick={() => setAnimation({ id: message.id, run: performance.now() })}><RotateCcw />Replay</Button><Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void copy(message)}><Copy />{copiedId === message.id ? "Copied" : "Copy"}</Button></div>
              </>}
              {message.actions?.length ? <div className="mt-4 space-y-3">{message.actions.map((proposal) => <AgentActionCard key={proposal.id} proposal={proposal} result={actionResults[proposal.id]} executing={applying === proposal.id} progress={applying === proposal.id ? activeWork ?? undefined : undefined} disabled={pending || Boolean(applying)} onApprove={() => void applyAction(proposal)} onDecline={() => void applyAction(proposal, "decline")} />)}</div> : null}
            </>}
          </div>)}</div>}
          {pending && mode === "chat" ? <div className="mt-5"><ThinkingState working scope={t(pageLabel)} /></div> : null}
          {error ? <div role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{error}</div> : null}
        </div>

        <div className="shrink-0 border-t bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {mode === "agent" && (pending || applying) && activeWork ? <div role="status" aria-live="polite" className="mb-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2"><ThinkingState key={applying || "preparing"} working scope={t(workPage)} activity={activeWork} /></div> : null}
          {messages.length ? <div className="mb-2 flex justify-end"><Button type="button" variant="ghost" size="xs" disabled={busy} onClick={newChat}><Plus />New chat</Button></div> : null}
          <div className="rounded-2xl border bg-card p-2.5 shadow-[0_6px_24px_rgba(15,23,42,.07)] transition focus-within:border-primary/40 focus-within:shadow-[0_8px_30px_rgba(15,23,42,.10)]">
            <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium text-muted-foreground">{mode === "agent" ? <AgentAvatar size="sm" color="violet" shape="squircle" glow={false} className="!size-5" /> : <AiIcon className="size-4" />}<span>{mode === "agent" ? "Agent mode" : "Chat"}</span><span className="text-border">/</span><AgentWorkIcon area={pageWorkArea(pageLabel)} className="size-3 shrink-0" /><span className="truncate">{pageLabel}</span></div>
            <textarea ref={input} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={mode === "chat" ? `Ask about ${pageLabel}…` : `Tell the agent what to do…`} disabled={busy} rows={3} maxLength={6_000} className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
            <div className="flex items-center justify-between gap-3 px-1 pb-0.5">{mode === "agent" ? <AgentApprovalMenu value={approvalMode} onChange={setApprovalMode} disabled={busy} /> : <span className="text-[10px] text-muted-foreground">Enter to send · Shift Enter for a new line</span>}<Button type="button" size="icon-sm" className="rounded-full" disabled={busy || !question.trim()} onClick={() => void send()} aria-label="Send to Filazoo AI"><CornerDownLeft /></Button></div>
          </div>
          <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">AI can make mistakes. Review suggestions before using them.</p>
        </div>
  </aside>;
}
