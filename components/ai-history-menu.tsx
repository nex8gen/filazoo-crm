"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useState } from "react";
import { usePathname } from "next/navigation";
import { Archive, ArchiveRestore, ArrowLeft, History, MoreHorizontal, Pin, PinOff, Pencil, RefreshCw, Settings2, SquarePen, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Conversation } from "@/lib/ai/chat-history";
import type { AiConversationController } from "./use-ai-conversation";
import { HistoryHttpError, requestHistoryJson } from "@/lib/ai/history-http";
import { useAiHistoryList } from "@/components/use-ai-history-list";
import type { HistoryListCache } from "@/lib/ai/history-list-cache";

function HistoryFailure({ message, signIn, disabled, onRetry, retryLabel = "Retry loading conversations" }: { message: string; signIn: boolean; disabled: boolean; onRetry: () => void; retryLabel?: string }) {
  const pathname = usePathname();
  return <NotificationToast>
    <p>{message}</p>
    {signIn ? <><a className="underline" href={`/login?${new URLSearchParams({ next: pathname || "/" })}`} target="_blank" rel="noopener noreferrer" onClick={(event) => { event.currentTarget.href = `/login?${new URLSearchParams({ next: window.location.pathname + window.location.search + window.location.hash })}`; }}>Sign in in a new tab</a><p className="text-muted-foreground">Keep this tab open to preserve your edits. After signing in, return here and retry.</p></> : null}
    <button type="button" className="underline disabled:opacity-50" disabled={disabled} onClick={onRetry}>{retryLabel}</button>
  </NotificationToast>;
}
export function AiHistoryMenu({ history, disabled, onNew, onRetry, onClose, onSettings, cache, closeLabel = "Close AI workspace" }: { history: AiConversationController; disabled: boolean; onNew: () => void; onRetry?: () => void; onClose?: () => void; onSettings?: () => void; cache?: HistoryListCache; closeLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const all = history.browseAll;
  const list = useAiHistoryList({ scope: history.scope, all, search, archived }, open, cache, history.conversation);
  const { items, loading, unavailable } = list;
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const error = mutationError ?? list.error;
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const blocked = disabled || history.loading || mutating;
  const mutationBlocked = disabled || mutating;

  async function change(item: Conversation, patch?: { title?: string; pinned?: boolean; archived?: boolean }) {
    setMutating(true); setMutationError(null);
    try {
      await requestHistoryJson(`/api/ai/history/${item.id}`, { method: patch ? "PATCH" : "DELETE", headers: { "Content-Type": "application/json" }, body: patch ? JSON.stringify(patch) : undefined });
      list.change(item.id, patch);
      setDeleting(null); setEditing(null); list.refresh();
      if (!patch) history.forget(item.id);
      if (history.conversation?.id === item.id && (!patch || patch.archived)) onNew();
      else if (history.conversation?.id === item.id && patch) history.update(patch);
    } catch (error) { setMutationError(error instanceof Error ? error : new Error("Unable to update history.")); }
    finally { setMutating(false); }
  }

  return <div className="shrink-0 border-b px-2 py-1.5">
    <header className="flex min-h-8 min-w-0 items-center gap-1">
      {onClose ? <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" aria-label={open ? "Back to conversation" : closeLabel} title={open ? "Back to conversation" : closeLabel} onClick={() => { if (open) setOpen(false); else onClose(); }}><ArrowLeft aria-hidden="true" /></Button> : null}
      <h2 className="min-w-0 flex-1 truncate px-1 text-xs font-medium" title={history.conversation?.title || "New conversation"}>{history.loading ? "Loading history…" : history.conversation ? <span data-no-translate>{history.conversation.title}</span> : "New conversation"}</h2>
      <div role="group" aria-label="Conversation actions" className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
        <DropdownMenu>
          <DropdownMenuTrigger disabled={mutationBlocked} render={<Button type="button" variant="ghost" size="icon-xs" aria-label="More conversation actions" title="More actions" />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" positionerClassName="z-[80]" className="w-56">
            {history.conversation ? <>
              <DropdownMenuItem disabled={blocked} onClick={() => void change(history.conversation!, { pinned: !history.conversation!.pinned })}>{history.conversation.pinned ? <PinOff /> : <Pin />}{history.conversation.pinned ? "Unpin conversation" : "Pin conversation"}</DropdownMenuItem>
              <DropdownMenuItem disabled={blocked} onClick={() => void change(history.conversation!, { archived: !history.conversation!.archived })}>{history.conversation.archived ? <ArchiveRestore /> : <Archive />}{history.conversation.archived ? "Restore conversation" : "Archive conversation"}</DropdownMenuItem>
            </> : null}
            <DropdownMenuItem onClick={() => { setArchived(true); setOpen(true); }}><Archive />Archived conversations</DropdownMenuItem>
            <DropdownMenuItem disabled={loading} onClick={() => { setOpen(true); setMutationError(null); list.refresh(); }}><RefreshCw />Refresh history</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant={open ? "secondary" : "ghost"} size="icon-xs" disabled={disabled} aria-label="History" title="Conversation history" aria-expanded={open} onClick={() => setOpen(!open)}><History aria-hidden="true" /></Button>
        {onSettings ? <Button type="button" variant="ghost" size="icon-xs" aria-label="AI settings" title="AI settings" onClick={onSettings}><Settings2 aria-hidden="true" /></Button> : null}
        <Button type="button" variant="ghost" size="icon-xs" disabled={mutationBlocked} aria-label="New chat" title="New chat" onClick={() => { setOpen(false); onNew(); }}><SquarePen aria-hidden="true" /></Button>
      </div>
    </header>
    {history.error ? <><HistoryFailure message={history.error} signIn={history.errorStatus === 401} disabled={disabled || history.loading} onRetry={() => { onRetry?.(); history.retry(); setMutationError(null); list.refresh(); }} />{history.errorStatus !== 401 ? <button type="button" className="mt-1 text-xs underline" disabled={disabled} onClick={() => { history.newConversation(); onNew(); }}>Start a new conversation</button> : null}</> : null}
    {error && !open ? <HistoryFailure message={error.message} signIn={error instanceof HistoryHttpError && error.status === 401} disabled={disabled || loading} onRetry={() => { setOpen(true); setMutationError(null); list.refresh(); onRetry?.(); history.retry(); }} /> : null}
    {open ? <section aria-label="Saved conversation history" className="mt-3 max-h-[45dvh] space-y-3 overflow-y-auto pb-2">
      <label className="block"><span className="sr-only">Search saved conversations</span><Input value={search} maxLength={160} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles and messages…" /></label>
      <div className="flex items-center gap-2"><Button type="button" size="xs" variant={!archived ? "secondary" : "ghost"} onClick={() => setArchived(false)}>Recent</Button><Button type="button" size="xs" variant={archived ? "secondary" : "ghost"} onClick={() => setArchived(true)}>Archived</Button></div>
      {error ? <HistoryFailure message={error.message} signIn={error instanceof HistoryHttpError && error.status === 401} disabled={disabled || loading} onRetry={() => { setMutationError(null); list.refresh(); onRetry?.(); history.retry(); }} /> : null}
      {unavailable ? <p className="text-xs text-muted-foreground">Some conversations are unavailable because their records or access have changed.</p> : null}
      {loading && !items.length ? <p role="status" className="text-xs text-muted-foreground">Loading conversations…</p> : !error && list.loaded && !items.length ? <p className="py-3 text-xs text-muted-foreground">{search ? "No matching conversations." : archived ? "No archived conversations." : "Your saved conversations will appear here."}</p> : null}
      <ul className="space-y-2">{items.map((item) => <li key={item.id} className={`rounded-lg border p-2 ${history.conversation?.id === item.id ? "border-primary/40 bg-primary/5" : ""}`}>
        <div className="flex items-center gap-2">
          {editing === item.id ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); void change(item, { title }); }}><Input autoFocus className="min-w-0 flex-1" aria-label="Conversation title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /><Button size="xs" type="submit" disabled={blocked || !title.trim()}>Save</Button><Button size="icon-xs" variant="ghost" type="button" aria-label="Cancel rename" onClick={() => setEditing(null)}><X /></Button></form> : <>
            <button type="button" disabled={blocked} title={`${item.title} · ${new Date(item.updated_at).toLocaleString(undefined, { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" })} · ${item.mode === "agent" ? "Agent" : "Chat"}${all ? ` · ${item.pathname}` : ""}`} onClick={async () => { setOpen(false); await history.open(item.id); }} className="min-w-0 flex-1 rounded py-1 text-left focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"><span data-no-translate className="block truncate text-xs font-medium">{item.pinned ? "📌 " : ""}{item.title}</span></button>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label={item.pinned ? "Unpin conversation" : "Pin conversation"} title={item.pinned ? "Unpin" : "Pin"} onClick={() => void change(item, { pinned: !item.pinned })}>{item.pinned ? <PinOff /> : <Pin />}</Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label="Rename conversation" title="Rename" onClick={() => { setEditing(item.id); setTitle(item.title); }}><Pencil /></Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={blocked} aria-label={archived ? "Restore conversation" : "Archive conversation"} title={archived ? "Restore" : "Archive"} onClick={() => void change(item, { archived: !item.archived })}>{archived ? <ArchiveRestore /> : <Archive />}</Button>
              <Button type="button" size="icon-xs" variant="ghost" disabled={mutationBlocked} aria-label="Delete conversation" title="Delete" className="text-destructive" onClick={() => setDeleting(item.id)}><Trash2 /></Button>
            </div>
          </>}
        </div>
        {deleting === item.id ? <div className="mt-2 text-xs"><p>Delete this conversation and its messages? Pending proposals are cancelled. Completed CRM actions stay in the audit log.</p><div className="mt-2 flex gap-2"><Button type="button" size="xs" variant="destructive" disabled={mutationBlocked} onClick={() => void change(item)}>Delete permanently</Button><Button type="button" size="xs" variant="ghost" disabled={mutating} onClick={() => setDeleting(null)}>Cancel</Button></div></div> : null}
      </li>)}</ul>
      {list.more ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void list.loadMore()}>Load more conversations</Button> : null}
    </section> : null}
    {history.hasMore ? <Button type="button" variant="ghost" size="xs" className="mt-1" disabled={blocked} onClick={() => void history.loadOlder()}>Load older messages</Button> : null}
    {history.conversation?.summary ? <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Earlier conversation summary</summary><p className="my-2">Selected excerpts keep longer conversations within the AI&apos;s context limit. Check current CRM records before acting.</p><p data-no-translate className="max-h-32 overflow-auto whitespace-pre-wrap leading-5">{history.conversation.summary}</p></details> : null}
  </div>;
}
