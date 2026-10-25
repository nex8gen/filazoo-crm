"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUpRight, Building2, Check, ChevronDown, Copy, CornerDownLeft, LoaderCircle, MessageCircle, PanelRightClose, Plus, RotateCcw } from "lucide-react";
import { AiIcon } from "@/components/ai-icon";
import { Button } from "@/components/ui/button";
import { StreamingText, ThinkingState } from "@/components/ui/ai-agent-response";
import AgentAvatar from "@/components/ui/components-primitives-avatar";
import type { WorkspaceAction } from "@/lib/ai/workspace-assistant";

type Mode = "chat" | "agent";
type Message = { id: string; role: "user" | "assistant"; content: string; actions?: WorkspaceAction[]; durationMs?: number };

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
    ["Prepare an action plan", "Prepare a practical action plan for the work shown on this page."],
    ["Draft follow-up", "Draft a concise follow-up using only the information visible on this page."],
    ["Propose updates", "Propose useful CRM updates from this page. List each change for review before applying."],
  ],
};

function visiblePageText() {
  const main = document.querySelector<HTMLElement>("#workspace-content");
  if (!main) return "";
  return (main.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 14_000);
}

export function WorkspaceAiAssistant({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const pageLabel = useMemo(() => pageNames.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Workspace", [pathname]);
  const [mode, setMode] = useState<Mode>("chat");
  const [question, setQuestion] = useState("");
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, { success?: string; error?: string }>>({});
  const [animation, setAnimation] = useState<{ id: string; run: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chatKey = `${pathname}:${mode}`;
  const messages = useMemo(() => chats[chatKey] ?? [], [chatKey, chats]);
  const busy = pending || Boolean(animation);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, animation]);
  async function send(value = question) {
    const content = value.trim();
    if (!content || busy) return;
    const next: Message[] = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    setChats((current) => ({ ...current, [chatKey]: next }));
    setQuestion("");
    setError(null);
    setPending(true);
    const controller = new AbortController();
    abort.current = controller;
    const started = performance.now();
    try {
      const response = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: mode === "agent" ? "work" : "analyze",
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
        [chatKey]: [...(current[chatKey] ?? next), { id, role: "assistant", content: result.output, actions: result.actions, durationMs: performance.now() - started }],
      }));
      setAnimation({ id, run: 1 });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to reach Filazoo AI.");
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

  async function applyAction(messageId: string, index: number, action: WorkspaceAction) {
    const actionId = `${messageId}:${index}`;
    if (applying || actionResults[actionId]?.success) return;
    setApplying(actionId);
    setActionResults((current) => ({ ...current, [actionId]: {} }));
    try {
      const response = await fetch("/api/ai/assistant/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.success !== "string") throw new Error(result?.error || "The action could not be completed.");
      setActionResults((current) => ({ ...current, [actionId]: { success: result.success } }));
    } catch (reason) {
      setActionResults((current) => ({ ...current, [actionId]: { error: reason instanceof Error ? reason.message : "The action could not be completed." } }));
    } finally {
      setApplying(null);
    }
  }

  return <aside aria-label="Filazoo AI workspace" aria-hidden={!open} inert={!open ? true : undefined} className={`fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l bg-background transition-transform duration-300 ease-out lg:top-12 lg:w-[31rem] ${open ? "translate-x-0" : "translate-x-full"}`}>
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
              <p className="relative z-10 mt-2 max-w-xs text-sm leading-6 text-muted-foreground">{mode === "chat" ? `Ask about ${pageLabel}, find patterns, or get a concise recommendation.` : `Give me a task in ${pageLabel}. I’ll prepare the action and wait for your approval.`}</p>
            </div>
            <div className="relative z-10 mx-auto mt-7 grid w-full max-w-sm gap-2">{starters[mode].map(([label, prompt]) => <button key={label} type="button" onClick={() => void send(prompt)} className="group flex min-h-12 items-center justify-between rounded-2xl border bg-background/90 px-4 text-left text-sm shadow-[0_1px_3px_rgba(15,23,42,.03)] transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"><span>{label}</span><ArrowUpRight className="size-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" /></button>)}</div>
            <motion.button type="button" aria-label="Focus the AI message box" onClick={() => input.current?.focus()} animate={{ y: [0, 5, 0], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.8, ease: "easeInOut", repeat: Infinity }} className="mt-7 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronDown className="size-5" /></motion.button>
          </div> : <div className="space-y-5">{messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-muted px-4 py-3" : "group max-w-full"}>
            {message.role === "user" ? <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p> : <>
              <ThinkingState working={false} writing={animation?.id === message.id} durationMs={message.durationMs} scope={pageLabel} className="mb-2" />
              <StreamingText key={`${message.id}-${animation?.id === message.id ? animation.run : 0}`} text={message.content} animate={animation?.id === message.id} onProgress={() => { const viewport = log.current; if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120) viewport.scrollTop = viewport.scrollHeight; }} onComplete={() => setAnimation((current) => current?.id === message.id ? null : current)} />
              {animation?.id === message.id ? <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => setAnimation(null)}>Show full reply</Button> : <>
              <div className="mt-2 flex gap-1"><Button type="button" variant="ghost" size="xs" className="text-muted-foreground" disabled={busy} onClick={() => setAnimation({ id: message.id, run: performance.now() })}><RotateCcw />Replay</Button><Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void copy(message)}><Copy />{copiedId === message.id ? "Copied" : "Copy"}</Button></div>
              {message.actions?.length ? <div className="mt-4 space-y-3">{message.actions.map((action, index) => {
                const actionId = `${message.id}:${index}`;
                const result = actionResults[actionId];
                return <div key={actionId} className="rounded-xl border bg-muted/30 p-3.5">
                  <div className="flex items-start gap-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary"><Building2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Create company</p><p className="mt-1 truncate text-sm font-semibold">{action.company.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{action.company.country}{action.company.city ? ` · ${action.company.city}` : ""} · {action.company.segment}</p>{action.company.contactEmail ? <p className="truncate text-xs text-muted-foreground">{action.company.contactName || "Contact"} · {action.company.contactEmail}</p> : null}</div></div>
                  {result?.success ? <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="size-3.5" />{result.success}</p> : <Button type="button" size="sm" className="mt-3 w-full" disabled={Boolean(applying)} onClick={() => void applyAction(message.id, index, action)}>{applying === actionId ? <LoaderCircle className="animate-spin" /> : <Plus />}Review details above and create</Button>}
                  {result?.error ? <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{result.error}</p> : null}
                </div>;
              })}</div> : null}</>}
            </>}
          </div>)}</div>}
          {pending ? <div className="mt-5"><ThinkingState working scope={pageLabel} /></div> : null}
          {error ? <div role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{error}</div> : null}
        </div>

        <div className="shrink-0 border-t bg-background/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {messages.length ? <div className="mb-2 flex justify-end"><Button type="button" variant="ghost" size="xs" disabled={busy} onClick={newChat}><Plus />New chat</Button></div> : null}
          <div className="rounded-2xl border bg-card p-2.5 shadow-[0_6px_24px_rgba(15,23,42,.07)] transition focus-within:border-primary/40 focus-within:shadow-[0_8px_30px_rgba(15,23,42,.10)]">
            <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium text-muted-foreground">{mode === "agent" ? <AgentAvatar size="sm" color="violet" shape="squircle" glow={false} className="!size-5" /> : <AiIcon className="size-4" />}<span>{mode === "agent" ? "Agent mode" : "Chat"}</span><span className="text-border">/</span><span className="truncate">{pageLabel}</span></div>
            <textarea ref={input} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={mode === "chat" ? `Ask about ${pageLabel}…` : `Tell the agent what to do…`} disabled={busy} rows={3} maxLength={6_000} className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:opacity-60" />
            <div className="flex items-center justify-between gap-3 px-1 pb-0.5"><span className="text-[10px] text-muted-foreground">Enter to send · Shift Enter for a new line</span><Button type="button" size="icon-sm" className="rounded-full" disabled={busy || !question.trim()} onClick={() => void send()} aria-label="Send to Filazoo AI"><CornerDownLeft /></Button></div>
          </div>
          <p className="mt-2 text-center text-[10px] leading-4 text-muted-foreground">AI can make mistakes. Review suggestions before using them.</p>
        </div>
  </aside>;
}
