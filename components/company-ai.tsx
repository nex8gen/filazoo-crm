"use client";

import { useLanguage } from "@/components/language-provider";

import { useEffect, useRef, useState } from "react";
import { Clock3, Copy, FileText, RotateCcw, SquarePen, Target } from "lucide-react";
import { AiIcon } from "@/components/ai-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StreamingText, ThinkingState } from "@/components/ui/ai-agent-response";
import { AiChatInput } from "@/components/ui/ai-chat-input";
import { CustomerResearchSources, type ResearchResult } from "@/components/ui/customer-research";
import type { AppLanguage } from "@/lib/i18n";
import type { Company } from "@/lib/types";
import type { CompanyChatMessage, CompanyChatSource } from "@/lib/ai/company-chat";
import { AiImagePreviews, useAiImageAttachments } from "@/components/ui/ai-image-attachments";
import { chatImageLimitError } from "@/lib/ai/image-input";
import { useAiConversation } from "@/components/use-ai-conversation";
import { AiHistoryMenu } from "@/components/ai-history-menu";
import type { HistoryReference } from "@/lib/ai/chat-history";

const shortcuts = [
  { label: "Analyze customer", icon: FileText, prompt: "Analyze this customer and write a report on their company, what they do, how big they are, their likely filament needs and the best sales approach. Separate facts from estimates and identify what we need to confirm." },
  { label: "Customer brief", icon: FileText, prompt: "Give me a concise brief on this customer: their business, needs, buying intent and what we know so far." },
  { label: "Next best action", icon: Target, prompt: "What should we do next for this customer, and why? Use the latest activity and identify anything we need to confirm." },
  { label: "Draft a reply", icon: SquarePen, prompt: "Draft a short, helpful reply to this customer's latest received email. If there is no saved inbound email, tell me what information you need instead." },
  { label: "Follow-up plan", icon: Clock3, prompt: "Suggest a follow-up plan for this customer, including timing in Shanghai time, talking points, and questions to ask. Distinguish the existing schedule from your suggestions." },
];

type ChatEntry = CompanyChatMessage & { id: string; attachmentNames?: string[]; sources?: CompanyChatSource[]; omittedActivity?: number; durationMs?: number; research?: ResearchResult };

async function requestCustomerReply(companyId: string, messages: ChatEntry[], signal: AbortSignal, language: AppLanguage, webSearch: boolean, history: HistoryReference) {
  const started = performance.now();
  const response = await fetch(`/api/companies/${companyId}/chat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, webSearch, history, messages: messages.slice(-1).map(({ role, content, images }) => ({ role, content, images })) }),
    signal,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.output !== "string") throw new Error(result?.error || "Unable to reach the assistant. Check your connection and sign in again if needed.");
  return { ...result, durationMs: performance.now() - started };
}

export function CompanyAi({ company }: { company: Company }) {
  const { language, t } = useLanguage();
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [question, setQuestion] = useState("");
  const attachments = useAiImageAttachments();
  const [webSearch, setWebSearch] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [animation, setAnimation] = useState<{ id: string; run: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const [retryMessages, setRetryMessages] = useState<ChatEntry[] | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const historyScroll = useRef<{ height: number; top: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useAiConversation({ mode: "customer", pathname: `/companies/${company.id}`, pageContext: { companyId: company.id } }, (detail, prepend) => {
    if (prepend && thread.current) historyScroll.current = { height: thread.current.scrollHeight, top: thread.current.scrollTop };
    setMessages((current) => prepend ? [...detail.messages as ChatEntry[], ...current] : detail.messages as ChatEntry[]);
    if (!prepend) { setAnimation(null); setError(null); setQuestion(""); setRetryMessages(null); attachments.clear(); }
  });
  const busy = pending || Boolean(animation) || history.loading;

  function newChat() {
    history.newConversation(); setMessages([]); setError(null); setRetryMessages(null); setAnimation(null); setQuestion(""); attachments.clear(); input.current?.focus();
  }

  useEffect(() => () => { request.current?.abort(); }, [language]);
  useEffect(() => {
    if (historyScroll.current && thread.current) {
      thread.current.scrollTop = historyScroll.current.top + thread.current.scrollHeight - historyScroll.current.height;
      historyScroll.current = null;
      return;
    }
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages, pending, error]);

  async function generate(next: ChatEntry[]) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRetryMessages(next);
    setPending(true);
    setError(null);
    const timeout = setTimeout(() => controller.abort(), webSearch ? 110_000 : 55_000);
    try {
      const reference = await history.ensure(crypto.randomUUID());
      if (controller.signal.aborted) return;
      const result = await requestCustomerReply(company.id, next, controller.signal, language, webSearch, reference);
      if (controller.signal.aborted) return;
      history.accept(result.history);
      const id = crypto.randomUUID();
      setMessages([...next, { id, role: "assistant", content: result.output, sources: result.sources, omittedActivity: result.coverage?.omittedActivity, durationMs: result.durationMs, research: result.research }]);
      setAnimation({ id, run: 1 });
      setRetryMessages(null);
    } catch (error) {
      if (request.current !== controller) return;
      setError(controller.signal.aborted ? "The assistant took too long to respond. Please retry." : error instanceof Error ? error.message : "Unable to reach the assistant.");
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) { request.current = null; setPending(false); }
    }
  }

  function send(content = question) {
    const text = content.trim();
    if ((!text && !attachments.images.length) || text.length > 6_000 || attachments.processing || request.current || retryMessages || busy) return;
    const next: ChatEntry[] = [...messages, { id: crypto.randomUUID(), role: "user", content: text, ...(attachments.images.length ? { images: attachments.images } : {}) }];
    const imageError = chatImageLimitError([next.at(-1)!]);
    if (imageError) { setError(imageError); return; }
    setMessages(next);
    setQuestion("");
    attachments.clear();
    void generate(next);
  }

  async function copy(entry: ChatEntry) {
    try { await navigator.clipboard.writeText(entry.content); setCopiedId(entry.id); }
    catch { setCopiedId(null); setError("Copy is unavailable. Select the answer and copy it manually."); }
  }

  function followReply() {
    const viewport = thread.current;
    if (viewport && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 100) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }

  return <section aria-label="Customer AI workspace" className="min-w-0">
    <Card className="h-[min(48rem,calc(100dvh-5rem))] min-h-[32rem] min-w-0 gap-0 overflow-clip py-0">
      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        <AiHistoryMenu key={history.scope} history={history} disabled={pending || Boolean(animation)} onNew={newChat} />
        <div ref={thread} role="log" aria-label="Customer AI conversation" aria-live="polite" aria-relevant="additions" aria-busy={busy} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
          {!messages.length ? <div className="flex min-h-full flex-col items-center justify-center text-center">
            <span className="mb-5 grid size-14 place-items-center rounded-2xl border border-violet-200/60 bg-violet-50 dark:border-violet-500/20 dark:bg-violet-500/10"><AiIcon className="size-7" /></span>
            <h2 className="text-lg font-semibold tracking-tight">Get to know {company.name}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">Ask about their needs, review the relationship, or prepare your next conversation.</p>
            <div className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-2">{shortcuts.map(({ label, icon: Icon, prompt }) => <button key={label} type="button" onClick={() => send(t(prompt))} className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><Icon className="size-4 text-muted-foreground" />{label}</button>)}</div>
          </div> : <div className="space-y-6">{messages.map((entry) => <div key={entry.id} className={entry.role === "user" ? "ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-muted px-4 py-3 sm:max-w-[80%]" : "max-w-full"}>
            {entry.role === "assistant" ? <>
              <ThinkingState working={false} writing={animation?.id === entry.id} durationMs={entry.durationMs} scope={company.name} steps={(entry.sources ?? []).map((source) => ({ id: source.id, label: `[${source.id}] ${t(source.label)}`, detail: source.recordedAt ? new Date(source.recordedAt).toLocaleDateString(language, { timeZone: "Asia/Shanghai" }) : undefined }))} className="mb-2" />
              <StreamingText key={`${entry.id}-${animation?.id === entry.id ? animation.run : 0}`} text={entry.content} animate={animation?.id === entry.id} onProgress={followReply} onComplete={() => setAnimation((current) => current?.id === entry.id ? null : current)} />
              <CustomerResearchSources research={entry.research} />
              {animation?.id === entry.id ? <Button type="button" variant="ghost" size="xs" className="mt-2" onClick={() => setAnimation(null)}>Show full reply</Button> : <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1 text-xs text-muted-foreground">{entry.sources?.length ? <span>{entry.sources.length} sources · Expand the response status to inspect</span> : null}{entry.omittedActivity ? <p className="mt-2 text-[11px]">Based on recent records; some older activity was outside this answer&apos;s context.</p> : null}</div>
                <div className="flex gap-1"><Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => setAnimation({ id: entry.id, run: performance.now() })} aria-label="Replay reply animation"><RotateCcw />Replay</Button><Button type="button" variant="ghost" size="xs" onClick={() => void copy(entry)} aria-label="Copy AI answer"><Copy />{copiedId === entry.id ? "Copied" : "Copy"}</Button></div>
              </div>}
            </> : <><p className="mb-2 text-xs font-medium text-muted-foreground">You</p><AiImagePreviews images={entry.images} />{entry.attachmentNames?.length ? <p className="mb-2 text-xs text-muted-foreground">Attached: {entry.attachmentNames.join(", ")}. Images are not retained; reattach to inspect them again.</p> : null}<p data-no-translate className="whitespace-pre-wrap break-words text-sm leading-7 [overflow-wrap:anywhere]">{entry.content}</p></>}
          </div>)}</div>}
          {pending ? <div role="status" className="mt-6"><ThinkingState working scope={company.name} />{webSearch ? <p className="mt-2 text-xs text-muted-foreground">Searching Google and checking company websites…</p> : null}</div> : null}
          {error ? <div role="alert" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4"><p className="text-sm leading-6">{error}</p>{retryMessages ? <div className="mt-3 flex gap-2"><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void generate(retryMessages)}>Try again</Button><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { const last = retryMessages.at(-1); setQuestion(last?.content || ""); attachments.setImages(last?.images ?? []); setMessages((current) => current.slice(0, -1)); setRetryMessages(null); setError(null); input.current?.focus(); }}>Edit question</Button></div> : null}</div> : null}
        </div>
        <div className="sticky bottom-0 z-10 shrink-0 border-t bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 sm:px-6">
          {messages.length ? <div className="mb-3 flex flex-wrap items-center gap-2">{shortcuts.map(({ label, prompt }) => <button key={label} type="button" disabled={busy || Boolean(retryMessages)} onClick={() => send(t(prompt))} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">{label}</button>)}</div> : null}
          <AiChatInput attachments={attachments} contextLabel={company.name} value={question} onChange={setQuestion} onSend={() => send()} inputRef={input} disabled={busy || Boolean(retryMessages)} busy={busy} shortcuts={shortcuts} webSearch={webSearch} onWebSearchChange={setWebSearch} />
          <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">AI provides advice and drafts. Review before using. This chat lasts until you leave or refresh this page.</p>
        </div>
      </CardContent>
    </Card>
  </section>;
}
