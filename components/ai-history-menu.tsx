"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, History, Pin, PinOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Conversation } from "@/lib/ai/chat-history";
import type { AiConversationController } from "./use-ai-conversation";
import { requestHistoryJson } from "@/lib/ai/history-http";

import { AiUsagePanel } from "./ai-usage-panel";
import type { AiBudgetSummary } from "@/lib/ai/budget";

type Usage = { limits: AiBudgetSummary; requests: number; calls: number; failedCalls: number; inputTokens: number; outputTokens: number; totalTokens: number; unreportedCalls: number; estimatedCostUsd: number | null; unpricedCalls: number };
export function AiHistoryMenu({ history, disabled, onNew, onRetry }: { history: AiConversationController; disabled: boolean; onNew: () => void; onRetry?: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const all = history.browseAll;
  const [items, setItems] = useState<Conversation[]>([]);
  const [page, setPage] = useState<{ more: boolean; offset: number }>({ more: false, offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [unavailable, setUnavailable] = useState(0);
  const listRequest = useRef<AbortController | null>(null);
  const blocked = disabled || history.loading || mutating;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    listRequest.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const data = await requestHistoryJson(`/api/ai/history?${new URLSearchParams({ scope: history.scope, view: all ? "all" : "record", search, archived: String(archived) })}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setItems(data.conversations); setPage({ more: data.hasMore, offset: data.offset }); setUnavailable(data.unavailable ?? 0); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load history."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, history.scope, all, search, archived, refresh]);

  async function more() {
    const signal = listRequest.current?.signal;
    if (!signal || signal.aborted) return;
    setLoading(true); setError(null);
    try {
      const data = await requestHistoryJson(`/api/ai/history?${new URLSearchParams({ scope: history.scope, view: all ? "all" : "record", search, archived: String(archived), offset: String(page.offset) })}`, { signal });
      if (signal.aborted) return;
      setItems((current) => [...current, ...data.conversations]); setPage({ more: data.hasMore, offset: data.offset });
      setUnavailable((current) => current + (data.unavailable ?? 0));
    } catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : "Unable to load history."); }
    finally { if (!signal.aborted) setLoading(false); }
  }
  async function change(item: Conversation, patch?: { title?: string; pinned?: boolean; archived?: boolean }) {
    setMutating(true); setError(null);
    try {
      const response = await fetch(`/api/ai/history/${item.id}`, { method: patch ? "PATCH" : "DELETE", headers: { "Content-Type": "application/json" }, body: patch ? JSON.stringify(patch) : undefined });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update conversation.");
      setDeleting(null); setEditing(null); setRefresh((v) => v + 1);
      if (history.conversation?.id === item.id && (!patch || patch.archived)) onNew();
      else if (history.conversation?.id === item.id && patch) history.update(patch);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to update history."); }
    finally { setMutating(false); }
  }
  function readUsage() { setShowUsage(value => !value); }
  useEffect(() => {
    if (!showUsage) return;
    const controller = new AbortController();
    async function refreshUsage() {
      try {
        const response = await fetch("/api/ai/usage", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load usage.");
        if (!controller.signal.aborted) { setUsage(data); setError(null); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load usage."); }
    }
    void refreshUsage();
    const timer = setInterval(() => { if (!document.hidden) void refreshUsage(); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [showUsage, disabled]);

  return <div className="shrink-0 border-b px-3 py-2">
    <div className="flex items-center gap-2">
      <Button type="button" variant={open ? "secondary" : "ghost"} size="xs" disabled={disabled} aria-expanded={open} onClick={() => { setOpen(!open); setRefresh((v) => v + 1); }}><History />History</Button>
      <Button type="button" size="xs" variant={showUsage ? "secondary" : "ghost"} aria-expanded={showUsage} onClick={() => void readUsage()}>AI usage</Button>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{history.loading ? "Loading history…" : history.conversation ? <span data-no-translate>{history.conversation.title}</span> : "New conversation"}</span>
      <Button type="button" variant="ghost" size="xs" disabled={blocked} onClick={onNew}><Plus />New chat</Button>
    </div>
    {history.error ? <p role="alert" className="mt-2 text-xs text-destructive">{history.error} <button type="button" className="underline" disabled={disabled || history.loading} onClick={() => { onRetry?.(); history.retry(); }}>Retry loading conversations</button>{" · "}<button type="button" className="underline" disabled={disabled} onClick={() => { history.newConversation(); onNew(); }}>Start a new conversation</button></p> : null}
    {showUsage ? <div className="mt-2">{usage ? <AiUsagePanel limits={usage.limits} /> : <p role="status" className="text-xs text-muted-foreground">Loading usage…</p>}</div> : null}
    {error && !open ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
    {open ? <section aria-label="Saved conversation history" className="mt-3 max-h-[45dvh] space-y-3 overflow-y-auto pb-2">
      <label className="block"><span className="sr-only">Search saved conversations</span><Input value={search} maxLength={160} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles and messages…" /></label>
      <div className="flex items-center gap-2"><Button type="button" size="xs" variant={!archived ? "secondary" : "ghost"} onClick={() => setArchived(false)}>Recent</Button><Button type="button" size="xs" variant={archived ? "secondary" : "ghost"} onClick={() => setArchived(true)}>Archived</Button></div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {unavailable ? <p className="text-xs text-muted-foreground">Some conversations are unavailable because their records or access have changed.</p> : null}
      {loading ? <p role="status" className="text-xs text-muted-foreground">Loading conversations…</p> : !items.length ? <p className="py-3 text-xs text-muted-foreground">{search ? "No matching conversations." : archived ? "No archived conversations." : "Your saved conversations will appear here."}</p> : null}
      <ul className="space-y-2">{items.map((item) => <li key={item.id} className={`rounded-lg border p-2 ${history.conversation?.id === item.id ? "border-primary/40 bg-primary/5" : ""}`}>
        <div className="flex items-center gap-2">
          {editing === item.id ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void change(item, { title }); }}><Input autoFocus className="min-w-0 flex-1" aria-label="Conversation title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /><Button size="xs" type="submit" disabled={blocked || !title.trim()}>Save</Button><Button size="icon-xs" variant="ghost" type="button" aria-label="Cancel rename" onClick={() => setEditing(null)}><X /></Button></form> : <>
            <button type="button" disabled={blocked} title={`${item.title} · ${new Date(item.updated_at).toLocaleString(undefined, { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })} · ${item.mode === "agent" ? "Agent" : "Chat"}${all ? ` · ${item.pathname}` : ""}`} onClick={async () => { if (await history.open(item.id)) setOpen(false); }} className="min-w-0 flex-1 rounded py-1 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><span data-no-translate className="block truncate text-xs font-medium">{item.pinned ? "📌 " : ""}{item.title}</span></button>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label={item.pinned ? "Unpin conversation" : "Pin conversation"} title={item.pinned ? "Unpin" : "Pin"} onClick={() => void change(item, { pinned: !item.pinned })}>{item.pinned ? <PinOff /> : <Pin />}</Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label="Rename conversation" title="Rename" onClick={() => { setEditing(item.id); setTitle(item.title); }}><Pencil /></Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label={archived ? "Restore conversation" : "Archive conversation"} title={archived ? "Restore" : "Archive"} onClick={() => void change(item, { archived: !item.archived })}>{archived ? <ArchiveRestore /> : <Archive />}</Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label="Delete conversation" title="Delete" className="text-destructive" onClick={() => setDeleting(item.id)}><Trash2 /></Button>
            </div>
          </>}
        </div>
        {deleting === item.id ? <div className="mt-2 text-xs"><p>Delete this conversation and its messages? Completed CRM actions stay in the audit log.</p><div className="mt-2 flex gap-2"><Button type="button" size="xs" variant="destructive" disabled={blocked} onClick={() => void change(item)}>Delete permanently</Button><Button type="button" size="xs" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button></div></div> : null}
      </li>)}</ul>
      {page.more ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void more()}>Load more conversations</Button> : null}
    </section> : null}
    {history.hasMore ? <Button type="button" variant="ghost" size="xs" className="mt-1" disabled={blocked} onClick={() => void history.loadOlder()}>Load older messages</Button> : null}
    {history.conversation?.summary ? <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Earlier conversation summary</summary><p className="my-2">Selected excerpts keep longer conversations within the AI&apos;s context limit. Check current CRM records before acting.</p><p data-no-translate className="max-h-32 overflow-auto whitespace-pre-wrap leading-5">{history.conversation.summary}</p></details> : null}
  </div>;
}
