"use client";

import { useLanguage } from "@/components/language-provider";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUp, ArrowUpRight, ChevronDown, Copy, MessageCircle, PanelRightClose, Plus, RotateCcw, ShieldCheck, Zap } from "lucide-react";
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
import { CustomerResearchSources, WebSearchOption, type ResearchResult } from "@/components/ui/customer-research";
import { AiImageFeedback, AiImagePicker, AiImagePreviews, useAiImageAttachments } from "@/components/ui/ai-image-attachments";
import OrbitingCirclesGlobe from "@/components/ui/orbiting-circles-02";
import { chatImageLimitError, type ChatImage } from "@/lib/ai/image-input";
import { assistantRecordScope, readAssistantPageContext } from "@/lib/ai/page-context";

type Mode = "chat" | "agent";
type Message = { id: string; role: "user" | "assistant"; content: string; images?: ChatImage[]; actions?: AgentProposal[]; durationMs?: number; work?: AgentWorkProgress; research?: ResearchResult };

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
  [/^\/overview\/pages$/, "Pages"],
  [/^\/overview\/sections$/, "Sections"],
  [/^\/$/, "Analytics"],
];

const chatStarters: Array<[string, string]> = [
    ["Analyze customer", "Analyze this customer: their company, what they do, how big they are, likely filament needs and sales opportunities. Separate facts from estimates."],
    ["Summarize this page", "Summarize the most important information on this page."],
    ["Find risks", "What risks, gaps, or items needing attention can you identify on this page?"],
    ["Recommend next steps", "Based on what is visible here, what should I focus on next?"],
];

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
  const attachments = useAiImageAttachments();
  const [webSearch, setWebSearch] = useState(false);
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, AgentActionResult>>({});
  const [activeWork, setActiveWork] = useState<AgentWorkProgress | null>(null);
  const [workPage, setWorkPage] = useState(pageLabel);
  const actionLock = useRef(false);
  const proposalContexts = useRef(new Map<string, ReturnType<typeof readAssistantPageContext>>());
  const [animation, setAnimation] = useState<{ id: string; run: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const composerId = useId();
  const chatKey = `${pathname}:${recordScope}:${mode}`;
  const visibleChatKey = useRef(chatKey);
  const messages = useMemo(() => chats[chatKey] ?? [], [chatKey, chats]);
  const busy = pending || Boolean(animation) || Boolean(applying);

  useEffect(() => { visibleChatKey.current = chatKey; setAnimation(null); }, [chatKey]);

  useEffect(() => {
    const main = document.querySelector("#workspace-content");
    if (!main) return;
    const readScope = () => setRecordScope(assistantRecordScope(readAssistantPageContext(main)));
    readScope();
    const observer = new MutationObserver(readScope);
    observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-ai-email-id", "data-ai-mailbox-id", "data-ai-invoice-id", "data-ai-company-id", "data-ai-conversation-id", "data-ai-flow-id", "data-ai-flow-draft"] });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => () => abort.current?.abort(), [language]);
  useEffect(() => {
    log.current?.scrollTo({ top: messages.length || pending || animation || applying ? log.current.scrollHeight : 0, behavior: "smooth" });
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
    if ((!content && !attachments.images.length) || attachments.processing || busy || abort.current || actionLock.current) return;
    const pageContext = readAssistantPageContext(document.querySelector("#workspace-content"));
    const requestChatKey = `${pathname}:${assistantRecordScope(pageContext)}:${mode}`;
    const sentImages = attachments.images;
    const next: Message[] = [...(chats[requestChatKey] ?? []), { id: crypto.randomUUID(), role: "user", content, ...(sentImages.length ? { images: sentImages } : {}) }];
    const imageError = chatImageLimitError(next.slice(-15));
    if (imageError) { setError(imageError); return; }
    setChats((current) => ({ ...current, [requestChatKey]: next }));
    setQuestion("");
    attachments.clear();
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
          webSearch,
          mode: mode === "agent" ? "work" : "analyze",
          approvalMode,
          completedActionIds: Object.values(chats).flat().flatMap((message) => message.actions ?? []).filter((proposal) => ["completed", "failed", "unknown"].includes(actionResults[proposal.id]?.status ?? "")).map((proposal) => proposal.id).slice(-20),
          pageContext,
          pathname,
          pageLabel,
          pageText: visiblePageText(),
          messages: next.slice(-15).map(({ role, content: messageContent, images }) => ({ role, content: messageContent, images })),
        }),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.output !== "string") throw new Error(result?.error || "Unable to reach Filazoo AI.");
      const id = crypto.randomUUID();
      for (const proposal of (result.actions ?? []) as AgentProposal[]) proposalContexts.current.set(proposal.id, pageContext);
      setChats((current) => ({
        ...current,
        [requestChatKey]: [...(current[requestChatKey] ?? next), { id, role: "assistant", content: result.output, actions: result.actions, durationMs: performance.now() - started, work, research: result.research }],
      }));
      if (visibleChatKey.current === requestChatKey) setAnimation({ id, run: 1 });
      // Auto approval applies only to proposals created by this request. Changing
      // the selector never executes older proposals waiting for review.
      if (mode === "agent" && approvalMode === "auto") {
        for (const proposal of (result.actions ?? []) as AgentProposal[]) {
          if (controller.signal.aborted) break;
          if (proposal.approvalMode !== "auto") break;
          if (!await applyAction(proposal, "approve", "auto")) break;
        }
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "Unable to reach Filazoo AI.");
        setChats((current) => ({ ...current, [requestChatKey]: (current[requestChatKey] ?? []).filter((message) => message.id !== next.at(-1)?.id) }));
        setQuestion(content);
        attachments.setImages(sentImages);
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
    attachments.clear();
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
        window.dispatchEvent(new CustomEvent("filazoo:agent-action", { detail: { draftId: result.draft ? actionId : undefined, draftMessage: result.draftMessage, flowId: result.flowId, flowEditorBefore: proposalContexts.current.get(actionId)?.flowDraft } }));
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
            {(["chat", "agent"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={mode === value} disabled={busy} onClick={() => { setMode(value); setAnimation(null); setError(null); setQuestion(""); attachments.clear(); }} className={`flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl px-3 text-left transition-all disabled:opacity-50 ${mode === value ? "bg-background text-foreground shadow-[0_1px_5px_rgba(15,23,42,.08)] ring-1 ring-border/60" : "text-muted-foreground hover:text-foreground"}`}>
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${mode === value ? "bg-muted" : ""}`}>{value === "chat" ? <MessageCircle className="size-[18px]" /> : <AgentAvatar size="sm" color="violet" shape="squircle" className="!size-6" />}</span><span className="min-w-0"><span className="block text-xs font-semibold">{value === "chat" ? "Chat" : "Agent"}</span><span className="block truncate text-[10px] font-normal text-muted-foreground">{value === "chat" ? "Ask & analyze" : "Plan & act"}</span></span>
            </button>)}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" onClick={() => onOpenChange(false)} aria-label="Close AI workspace"><PanelRightClose /></Button>
        </div>

        <div ref={log} role="log" aria-live="polite" aria-busy={busy} className="relative min-h-0 flex-1 overflow-y-auto px-5 py-6">
          {!messages.length ? <div className={`relative flex min-h-full flex-col items-center justify-center overflow-hidden rounded-3xl before:pointer-events-none before:absolute before:inset-x-8 before:top-[18%] before:h-56 before:rounded-full before:bg-violet-500/[0.045] before:blur-3xl dark:before:bg-violet-400/[0.055] ${mode === "agent" ? "py-4" : "py-8"}`}>
            <div className="mx-auto flex w-full max-w-sm flex-col items-center text-center">
              {mode === "agent" ? <div className="relative z-10 mb-3 flex w-full justify-center"><OrbitingCirclesGlobe active={open} /></div> : <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 3, ease: "easeInOut", repeat: Infinity }} className="relative z-10 mb-5 flex items-center justify-center"><AiIcon className="size-12" /></motion.div>}
              <h2 className="relative z-10 text-lg font-semibold tracking-tight text-balance">{mode === "chat" ? "What would you like to know?" : "What should I take care of?"}</h2>
              <p className={`relative z-10 max-w-xs text-pretty text-muted-foreground ${mode === "agent" ? "mt-1.5 text-xs leading-5" : "mt-2 text-sm leading-6"}`}>{mode === "chat" ? `Ask about ${pageLabel}, find patterns, or get a concise recommendation.` : "Invoices, emails, and customer updates."}</p>
              {mode === "agent" ? <p className="relative z-10 mt-2 inline-flex items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">{approvalMode === "ask" ? <ShieldCheck aria-hidden="true" className="size-3 shrink-0" /> : <Zap aria-hidden="true" className="size-3 shrink-0 text-amber-500" />}<span>{approvalMode === "ask" ? "You review every action" : "Requested actions run automatically."}</span></p> : null}
            </div>
            {mode === "chat" ? <div role="group" aria-label="Suggested questions" className="relative z-10 mx-auto mt-7 grid w-full max-w-sm gap-2">{chatStarters.map(([label, prompt]) => <button key={label} type="button" disabled={busy} onClick={() => void send(t(prompt))} className="group flex min-h-12 items-center justify-between rounded-2xl border bg-background/90 px-4 text-left text-sm shadow-[0_1px_3px_rgba(15,23,42,.03)] transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"><span>{label}</span><ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100" /></button>)}</div> : null}
            {mode === "chat" ? <motion.button type="button" aria-label="Focus the AI message box" onClick={() => input.current?.focus()} animate={{ y: [0, 5, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }} className="mt-7 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronDown className="size-5" /></motion.button> : null}
          </div> : <div className="space-y-5">{messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-muted px-4 py-3" : "group max-w-full"}>
            {message.role === "user" ? <><AiImagePreviews images={message.images} /><p data-no-translate className="whitespace-pre-wrap text-sm leading-6">{message.content}</p></> : <>
              <ThinkingState working={false} writing={animation?.id === message.id} durationMs={message.durationMs} scope={t(pageLabel)} activity={message.work} className="mb-2" />
              <StreamingText key={`${message.id}-${animation?.id === message.id ? animation.run : 0}`} text={message.content} animate={animation?.id === message.id} onProgress={() => { const viewport = log.current; if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120) viewport.scrollTop = viewport.scrollHeight; }} onComplete={() => setAnimation((current) => current?.id === message.id ? null : current)} />
              <CustomerResearchSources research={message.research} />
              {animation?.id === message.id ? <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => setAnimation(null)}>Show full reply</Button> : <>
              <div className="mt-2 flex gap-1"><Button type="button" variant="ghost" size="xs" className="text-muted-foreground" disabled={busy} onClick={() => setAnimation({ id: message.id, run: performance.now() })}><RotateCcw />Replay</Button><Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void copy(message)}><Copy />{copiedId === message.id ? "Copied" : "Copy"}</Button></div>
              </>}
              {message.actions?.length ? <div className="mt-4 space-y-3">{message.actions.map((proposal) => <AgentActionCard key={proposal.id} proposal={proposal} result={actionResults[proposal.id]} executing={applying === proposal.id} progress={applying === proposal.id ? activeWork ?? undefined : undefined} disabled={pending || Boolean(applying)} onApprove={() => void applyAction(proposal)} onDecline={() => void applyAction(proposal, "decline")} />)}</div> : null}
            </>}
          </div>)}</div>}
          {pending && mode === "chat" ? <div className="mt-5"><ThinkingState working scope={t(pageLabel)} /></div> : null}
          {pending && webSearch ? <p role="status" className="mt-2 text-xs text-muted-foreground">Searching Google and checking company websites…</p> : null}
          {error ? <div role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{error}</div> : null}
        </div>

        <div className="shrink-0 bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {mode === "agent" && (pending || applying) && activeWork ? <div role="status" aria-live="polite" className="mb-3 rounded-xl border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2"><ThinkingState key={applying || "preparing"} working scope={t(workPage)} activity={activeWork} /></div> : null}
          <div className="mb-2.5 flex min-h-7 min-w-0 items-center justify-between gap-3 px-1">
            <div id={`${composerId}-context`} className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              {mode === "agent" ? <AgentAvatar size="sm" color="violet" shape="squircle" className="!size-4 shrink-0" /> : <MessageCircle aria-hidden="true" className="size-3.5 shrink-0" />}
              <span className="shrink-0 font-medium">{mode === "agent" ? "Agent" : "Chat"}</span>
              <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
              <AgentWorkIcon area={pageWorkArea(pageLabel)} className="size-3.5 shrink-0" />
              <span className="truncate">{pageLabel}</span>
            </div>
            {messages.length ? <Button type="button" variant="ghost" size="xs" className="shrink-0 text-muted-foreground" disabled={busy} onClick={newChat}><Plus />New chat</Button> : null}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="min-w-0 rounded-2xl border border-border/80 bg-card p-3 shadow-[0_2px_8px_rgba(15,23,42,.03)] transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/10 motion-reduce:transition-none">
            <label htmlFor={composerId} className="sr-only">{mode === "chat" ? "Message Filazoo AI" : "Instructions for Filazoo agent"}</label>
            <AiImagePreviews images={attachments.images} onRemove={attachments.remove} disabled={busy || attachments.processing} /><AiImageFeedback attachments={attachments} />
            <textarea ref={input} id={composerId} aria-describedby={`${composerId}-context ${composerId}-hint`} value={question} onPaste={busy ? undefined : attachments.onPaste} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={mode === "chat" ? `Ask about ${pageLabel}…` : `Tell the agent what to do…`} disabled={busy} rows={2} maxLength={6_000} className="block max-h-40 min-h-20 w-full resize-none overflow-y-auto bg-transparent px-1 pt-1 pb-3 text-base leading-6 outline-none [field-sizing:content] placeholder:text-muted-foreground/80 disabled:opacity-60 sm:text-sm" />
            {mode === "agent" ? <div className="mb-2 border-t border-border/50 pt-2"><AgentApprovalMenu value={approvalMode} onChange={setApprovalMode} disabled={busy} /></div> : null}
            <div className="flex min-w-0 items-end justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1 [&>button]:min-h-9 [&>button]:rounded-lg [&>button]:px-2 [&>button:not([aria-pressed=true])]:border-transparent [&>button:not([aria-pressed=true])]:bg-transparent [&>button:not([aria-pressed=true]):hover]:bg-muted [&>button]:focus-visible:outline-2 [&>button]:focus-visible:outline-offset-2 [&>button]:focus-visible:outline-ring">
                <AiImagePicker attachments={attachments} disabled={busy} />
                <WebSearchOption enabled={webSearch} onChange={setWebSearch} disabled={busy} />
              </div>
              <Button type="submit" size="icon" className="size-9 shrink-0 rounded-xl bg-foreground text-background shadow-none hover:bg-foreground/85 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-60" disabled={busy || attachments.processing || (!question.trim() && !attachments.images.length)} aria-label="Send to Filazoo AI" title="Send message (Enter)"><ArrowUp aria-hidden="true" className="size-4" /></Button>
            </div>
          </form>
          <p id={`${composerId}-hint`} className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">Enter to send · Shift + Enter for a new line</p>
          <p className="mt-1 text-center text-[10px] leading-4 text-muted-foreground">AI can make mistakes. Review suggestions before using them.</p>
        </div>
  </aside>;
}
