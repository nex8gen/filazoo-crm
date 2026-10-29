"use client";

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, History, Pin, PinOff, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Conversation } from "@/lib/ai/chat-history";
import type { AiConversationController } from "./use-ai-conversation";

type Usage = { requests: number; calls: number; failedCalls: number; inputTokens: number; outputTokens: number; totalTokens: number; unreportedCalls: number; estimatedCostUsd: number | null; unpricedCalls: number };
export function AiHistoryMenu({ history, disabled, onNew }: { history: AiConversationController; disabled: boolean; onNew: () => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
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
  const blocked = disabled || history.loading || mutating;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/ai/history?${new URLSearchParams({ scope: history.scope, search, archived: String(archived) })}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load history.");
        if (!controller.signal.aborted) { setItems(data.conversations); setPage({ more: data.hasMore, offset: data.offset }); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load history."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, history.scope, search, archived, refresh]);

  async function more() {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/ai/history?${new URLSearchParams({ scope: history.scope, search, archived: String(archived), offset: String(page.offset) })}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load history.");
      setItems((current) => [...current, ...data.conversations]); setPage({ more: data.hasMore, offset: data.offset });
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load history."); }
    finally { setLoading(false); }
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
  async function readUsage() {
    setShowUsage((value) => !value);
    if (showUsage) return;
    setError(null);
    try {
      const response = await fetch("/api/ai/usage", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load usage.");
      setUsage(data);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load usage."); }
  }

  return <div className="shrink-0 border-b px-3 py-2">
    <div className="flex items-center gap-2">
      <Button type="button" variant={open ? "secondary" : "ghost"} size="xs" disabled={disabled} aria-expanded={open} onClick={() => { setOpen(!open); setRefresh((v) => v + 1); }}><History />History</Button>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{history.loading ? "Loading history…" : history.conversation ? <span data-no-translate>{history.conversation.title}</span> : "New conversation"}</span>
      <Button type="button" variant="ghost" size="xs" disabled={blocked} onClick={onNew}><Plus />New chat</Button>
    </div>
    {history.error ? <p role="alert" className="mt-2 text-xs text-destructive">{history.error} <button type="button" className="underline" disabled={disabled} onClick={() => { history.newConversation(); onNew(); }}>Start a new conversation</button></p> : null}
    {open ? <section aria-label="Saved conversation history" className="mt-3 max-h-[45dvh] space-y-3 overflow-y-auto pb-2">
      <p className="text-xs leading-5 text-muted-foreground">Your conversations for this page and AI mode. Saved automatically after each reply.</p>
      <label className="block"><span className="sr-only">Search saved conversations</span><Input value={search} maxLength={160} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles and messages…" /></label>
      <div className="flex items-center gap-2"><Button type="button" size="xs" variant={!archived ? "secondary" : "ghost"} onClick={() => setArchived(false)}>Recent</Button><Button type="button" size="xs" variant={archived ? "secondary" : "ghost"} onClick={() => setArchived(true)}>Archived</Button><Button type="button" size="xs" variant="ghost" className="ml-auto" aria-expanded={showUsage} onClick={() => void readUsage()}>AI usage</Button></div>
      {showUsage ? <div className="rounded-lg bg-muted/50 p-3 text-xs leading-6" role="status">{usage ? <>
        <p className="font-medium">Your AI usage · last 30 days</p>
        <p>{usage.requests} requests · {usage.calls} provider calls · {usage.failedCalls} failed calls</p>
        <p>{Number(usage.totalTokens).toLocaleString()} reported tokens ({Number(usage.inputTokens).toLocaleString()} input / {Number(usage.outputTokens).toLocaleString()} output)</p>
        <p>{usage.estimatedCostUsd === null ? "Cost estimate unavailable" : `Estimated cost: $${Number(usage.estimatedCostUsd).toFixed(4)} USD`}{usage.unpricedCalls ? ` · ${usage.unpricedCalls} calls without configured prices` : ""}</p>
        {usage.unreportedCalls ? <p>{usage.unreportedCalls} calls did not report token usage.</p> : null}
        <p className="text-muted-foreground">Includes saved AI chats, agent lookups and their web research. Provider billing may include other charges.</p>
      </> : "Loading usage…"}</div> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {loading ? <p role="status" className="text-xs text-muted-foreground">Loading conversations…</p> : !items.length ? <p className="py-3 text-xs text-muted-foreground">{search ? "No matching conversations." : archived ? "No archived conversations." : "Your saved conversations will appear here."}</p> : null}
      <ul className="space-y-2">{items.map((item) => <li key={item.id} className={`rounded-lg border p-2 ${history.conversation?.id === item.id ? "border-primary/40 bg-primary/5" : ""}`}>
        {editing === item.id ? <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void change(item, { title }); }}><Input autoFocus aria-label="Conversation title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /><Button size="xs" type="submit" disabled={blocked || !title.trim()}>Save</Button><Button size="icon-sm" variant="ghost" type="button" aria-label="Cancel rename" onClick={() => setEditing(null)}><X /></Button></form> : <button type="button" disabled={blocked} onClick={() => { void history.open(item.id); setOpen(false); }} className="block w-full rounded text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><span className="line-clamp-2 text-xs font-medium">{item.pinned ? "📌 " : ""}{item.title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{new Date(item.updated_at).toLocaleString(undefined, { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })} · {item.mode === "agent" ? "Agent" : "Chat"}</span></button>}
        <div className="mt-1 flex flex-wrap gap-1">
          <Button type="button" size="icon-sm" variant="ghost" disabled={blocked} aria-label={item.pinned ? "Unpin conversation" : "Pin conversation"} title={item.pinned ? "Unpin" : "Pin"} onClick={() => void change(item, { pinned: !item.pinned })}>{item.pinned ? <PinOff /> : <Pin />}</Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={blocked} aria-label="Rename conversation" title="Rename" onClick={() => { setEditing(item.id); setTitle(item.title); }}><Pencil /></Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={blocked} aria-label={archived ? "Restore conversation" : "Archive conversation"} title={archived ? "Restore" : "Archive"} onClick={() => void change(item, { archived: !item.archived })}>{archived ? <ArchiveRestore /> : <Archive />}</Button>
          <Button type="button" size="icon-sm" variant="ghost" disabled={blocked} aria-label="Delete conversation" title="Delete" className="ml-auto text-destructive" onClick={() => setDeleting(item.id)}><Trash2 /></Button>
        </div>
        {deleting === item.id ? <div className="mt-2 text-xs"><p>Delete this conversation and its messages? Completed CRM actions stay in the audit log.</p><div className="mt-2 flex gap-2"><Button type="button" size="xs" variant="destructive" disabled={blocked} onClick={() => void change(item)}>Delete permanently</Button><Button type="button" size="xs" variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button></div></div> : null}
      </li>)}</ul>
      {page.more ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void more()}>Load more conversations</Button> : null}
    </section> : null}
    {history.hasMore ? <Button type="button" variant="ghost" size="xs" className="mt-1" disabled={blocked} onClick={() => void history.loadOlder()}>Load older messages</Button> : null}
    {history.conversation?.summary ? <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Earlier conversation summary</summary><p className="my-2">Selected excerpts keep longer conversations within the AI&apos;s context limit. Check current CRM records before acting.</p><p data-no-translate className="max-h-32 overflow-auto whitespace-pre-wrap leading-5">{history.conversation.summary}</p></details> : null}
  </div>;
}
