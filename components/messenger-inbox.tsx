"use client";

import { useMemo, useState } from "react";
import {
  Archive, ArrowDownToLine, Bot, Check, CheckCheck, ChevronDown, CircleUserRound,
  Clock3, Copy, Filter, Flag, Globe2, Inbox, Languages, MessageCircleMore,
  MoreHorizontal, PanelRightClose, Paperclip, Phone, Plus, Search, SendHorizonal,
  Settings2, Smile, Sparkles, UserCheck, UserRound, WandSparkles, Wifi, Zap,
} from "lucide-react";
import Link from "next/link";
import type { MetaConversationThread, MetaInboxData, MetaThreadMessage } from "@/lib/meta-messenger";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Channel = "all" | "facebook" | "instagram" | "whatsapp" | "web";
type InboxThread = MetaConversationThread & {
  channel: Exclude<Channel, "all">;
  company?: string;
  operator?: string;
  language?: string;
  priority?: "High" | "Normal";
};

const channelOptions: Array<{
  id: Channel;
  label: string;
  shortLabel: string;
  markClass: string;
  connected: boolean;
}> = [
  { id: "all", label: "All conversations", shortLabel: "All", markClass: "bg-foreground text-background", connected: true },
  { id: "facebook", label: "Facebook", shortLabel: "Facebook", markClass: "bg-[#1877f2] text-white", connected: true },
  { id: "instagram", label: "Instagram", shortLabel: "Instagram", markClass: "bg-gradient-to-br from-[#7c3aed] via-[#e1306c] to-[#f59e0b] text-white", connected: true },
  { id: "whatsapp", label: "WhatsApp", shortLabel: "WhatsApp", markClass: "bg-[#25d366] text-white", connected: false },
  { id: "web", label: "Website chat", shortLabel: "Website", markClass: "bg-[#8b5cf6] text-white", connected: false },
];

const translations: Record<string, string> = {};

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatReplyWindow(value: string | null) {
  if (!value) return "Closed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Closed";
  return `Open until ${new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

function ChannelMark({ channel, size = "md" }: { channel: Exclude<Channel, "all">; size?: "sm" | "md" }) {
  const option = channelOptions.find((item) => item.id === channel)!;
  const iconClass = size === "sm" ? "size-2.5" : "size-3.5";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full ${option.markClass} ${size === "sm" ? "size-4" : "size-7"}`} aria-hidden="true">
      {channel === "facebook" ? (
        <svg viewBox="0 0 24 24" className={iconClass} fill="currentColor"><path d="M13.7 21v-8h2.7l.4-3.1h-3.1v-2c0-.9.3-1.5 1.6-1.5H17V3.6c-.7-.1-1.5-.2-2.4-.2-2.4 0-4.1 1.5-4.1 4.2v2.3H7.8V13h2.7v8h3.2Z" /></svg>
      ) : channel === "instagram" ? (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.4" cy="6.7" r="1" fill="currentColor" stroke="none" /></svg>
      ) : channel === "whatsapp" ? (
        <svg viewBox="0 0 24 24" className={iconClass} fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z" /><path d="M9 8.5c.6 2.4 2.1 4 4.6 5l1.2-1.1 1.7.8c-.3 1.6-1.2 2.3-2.8 2.1-3.4-.7-5.8-3.1-6.5-6.5C7 7.4 7.7 6.5 9.2 6.2l.8 1.6L9 8.5Z" /></svg>
      ) : <Globe2 className={iconClass} />}
    </span>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}>
      <span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

export function MessengerInbox({ data }: { data: MetaInboxData }) {
  const initialThreads = useMemo<InboxThread[]>(() => data.threads.map((thread) => ({ ...thread, operator: "You", language: "Auto-detect", priority: "Normal" })), [data.threads]);
  const [threads, setThreads] = useState(initialThreads);
  const [selectedId, setSelectedId] = useState(initialThreads[0]?.id ?? "");
  const [activeChannel, setActiveChannel] = useState<Channel>("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [translationOn, setTranslationOn] = useState(true);
  const [autoReplyOn, setAutoReplyOn] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const [sortNewest, setSortNewest] = useState(true);

  const filteredThreads = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return threads.filter((thread) => {
      const matchesChannel = activeChannel === "all" || thread.channel === activeChannel;
      const matchesSearch = !normalized || `${thread.customer} ${thread.company ?? ""} ${thread.lastMessage}`.toLowerCase().includes(normalized);
      return matchesChannel && matchesSearch && (!onlyUnread || thread.unread > 0);
    }).sort((a, b) => (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) * (sortNewest ? 1 : -1));
  }, [activeChannel, onlyUnread, search, sortNewest, threads]);

  const selectedThread = threads.find((thread) => thread.id === selectedId) ?? filteredThreads[0];
  const activeOption = channelOptions.find((item) => item.id === activeChannel)!;
  const unreadCount = threads.reduce((total, thread) => total + thread.unread, 0);
  const isChannelConnected = (channel: Channel) => channel === "all"
    ? data.connection.configured
    : channel === "facebook"
      ? data.connection.facebookConfigured
      : channel === "instagram"
        ? data.connection.instagramConfigured
        : false;

  function chooseThread(thread: InboxThread) {
    setSelectedId(thread.id);
    setNotice(null);
    setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, unread: 0, status: item.status === "New" ? "Open" : item.status } : item));
  }

  function selectChannel(channel: Channel) {
    setActiveChannel(channel);
    const first = threads.find((thread) => channel === "all" || thread.channel === channel);
    if (first) setSelectedId(first.id);
  }

  function assignToMe() {
    if (!selectedThread) return;
    setThreads((current) => current.map((thread) => thread.id === selectedThread.id ? { ...thread, operator: "You" } : thread));
    setNotice(`${selectedThread.customer} is now assigned to you.`);
  }

  function markUnread() {
    if (!selectedThread) return;
    setThreads((current) => current.map((thread) => thread.id === selectedThread.id ? { ...thread, unread: Math.max(1, thread.unread) } : thread));
    setNotice("Conversation marked as unread.");
  }

  function toggleResolved() {
    if (!selectedThread) return;
    setResolvedIds((current) => {
      const next = new Set(current);
      if (next.has(selectedThread.id)) next.delete(selectedThread.id);
      else next.add(selectedThread.id);
      return next;
    });
    setNotice(resolvedIds.has(selectedThread.id) ? "Conversation reopened." : "Conversation marked as resolved.");
  }

  async function copyCustomerId() {
    if (!selectedThread) return;
    try {
      await navigator.clipboard.writeText(selectedThread.customerId);
      setNotice("Customer ID copied to clipboard.");
    } catch {
      setNotice(`Customer ID: ${selectedThread.customerId}`);
    }
  }

  async function handleSend() {
    const message = draft.trim();
    if (!selectedThread || !message || !selectedThread.replyWindowOpen || resolvedIds.has(selectedThread.id)) return;
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/meta/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: selectedThread.customerId, message, channel: selectedThread.channel }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Messenger reply could not be sent.");
      const sent: MetaThreadMessage = { id: result?.messageId || `local-${Date.now()}`, direction: "outbound", body: message, type: "text", status: "sent", createdAt: result?.createdAt || new Date().toISOString() };
      setThreads((current) => current.map((thread) => thread.id === selectedThread.id
        ? { ...thread, messages: [...thread.messages, sent], lastMessage: message, updatedAt: sent.createdAt, status: "Open" }
        : thread));
      setDraft("");
      setNotice(`Reply sent through ${selectedThread.channel === "instagram" ? "Instagram" : "Facebook Messenger"}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Messenger reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="messenger-workspace flex h-[calc(100dvh-3rem)] flex-col overflow-hidden bg-[#f7f8fa] dark:bg-background">
      <div className="border-b bg-background px-4 pb-3 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[1.9rem] font-semibold tracking-[-0.02em]">Messenger</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground sm:flex"><span className={`size-2 rounded-full ${data.connection.configured ? "bg-emerald-500" : "bg-amber-400"}`} />{data.connection.configured ? `Live · ${[data.connection.pageName, data.connection.instagramName].filter(Boolean).join(" + ") || "Meta"}` : "Disconnected · Meta setup needed"}</div>
            <Link href="/settings" className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"><Settings2 className="size-4" />Inbox settings</Link>
          </div>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto" aria-label="Messaging channels">
          {channelOptions.map((channel) => {
            const active = channel.id === activeChannel;
            const connected = isChannelConnected(channel.id);
            const count = channel.id === "all" ? unreadCount : threads.filter((thread) => thread.channel === channel.id).reduce((total, thread) => total + thread.unread, 0);
            return (
              <button key={channel.id} type="button" onClick={() => selectChannel(channel.id)} className={`relative flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium ${active ? "bg-muted text-foreground ring-1 ring-border" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                {channel.id === "all" ? <span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-background"><Inbox className="size-3" /></span> : <ChannelMark channel={channel.id} size="sm" />}{channel.shortLabel}
                {count > 0 ? <span className="min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-foreground">{count}</span> : null}
                {!connected ? <span className="size-1.5 rounded-full bg-muted-foreground/30" title="Not connected" /> : null}
                {active ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
          <Link href="/settings" className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" />Add channel</Link>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-background md:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(480px,1fr)_300px]">
        <section className="flex min-h-0 flex-col border-r" aria-label="Conversations">
          <div className="border-b p-3">
            <div className="flex items-center justify-between px-1 pb-3"><div className="flex items-center gap-2"><h2 className="text-base font-semibold">Inbox</h2><span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{filteredThreads.length}</span></div><div className="flex items-center gap-1"><button type="button" title={onlyUnread ? "Show all conversations" : "Show unread only"} aria-pressed={onlyUnread} onClick={() => setOnlyUnread((value) => !value)} className={`rounded-md p-2 hover:bg-muted hover:text-foreground ${onlyUnread ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}><Filter className="size-4" /></button><DropdownMenu><DropdownMenuTrigger className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground" aria-label="Inbox actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>Inbox actions</DropdownMenuLabel><DropdownMenuItem onClick={() => setThreads((current) => current.map((thread) => ({ ...thread, unread: 0 })))}><CheckCheck />Mark all as read</DropdownMenuItem><DropdownMenuItem onClick={() => setOnlyUnread(true)}><Filter />Show unread only</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
            <label className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-2.5 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"><Search className="size-3.5 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or messages" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" /><kbd className="rounded border bg-background px-1 text-xs text-muted-foreground">⌘K</kbd></label>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!isChannelConnected(activeOption.id) && filteredThreads.length === 0 ? (
              <div className="m-2 rounded-xl border border-dashed bg-muted/20 p-5 text-center"><div className="mx-auto w-fit"><ChannelMark channel={activeOption.id as Exclude<Channel, "all">} /></div><h3 className="mt-3 text-sm font-semibold">Connect {activeOption.label}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Bring messages into Filazoo and assign them to your CRM operators.</p><Link href="/settings" className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background"><Wifi className="size-3.5" />Connect channel</Link></div>
            ) : filteredThreads.length === 0 ? (
              <div className="m-2 rounded-lg border border-dashed p-5 text-center text-xs text-muted-foreground">No conversations match your search.</div>
            ) : filteredThreads.map((thread) => {
              const selected = selectedThread?.id === thread.id;
              return (
                <button key={thread.id} type="button" onClick={() => chooseThread(thread)} className={`group relative mb-1.5 flex w-full gap-3.5 rounded-xl p-3.5 text-left transition-colors ${selected ? "bg-[#f0fdf7] shadow-[inset_0_0_0_1px_rgba(62,207,142,0.12)] dark:bg-primary/10" : "hover:bg-muted/60"}`}>
                  {selected ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-r bg-primary" /> : null}
                  <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(thread.customer)}<span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-background"><ChannelMark channel={thread.channel} size="sm" /></span></div>
                  <div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><p className="min-w-0 flex-1 truncate text-xs font-semibold">{thread.customer}</p><time className="shrink-0 text-xs text-muted-foreground">{formatTime(thread.updatedAt)}</time></div><p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.company || `Messenger ID ${thread.customerId}`}</p><div className="mt-2 flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-xs ${thread.unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>{thread.lastMessage}</p>{thread.unread > 0 ? <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{thread.unread}</span> : null}</div></div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground"><span>{threads.length} total conversations</span><button type="button" onClick={() => setSortNewest((value) => !value)} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground">{sortNewest ? "Newest first" : "Oldest first"} <ChevronDown className={`size-3 transition-transform ${sortNewest ? "" : "rotate-180"}`} /></button></div>
        </section>

        <section className="hidden min-h-0 flex-col bg-[#fbfbfc] dark:bg-background md:flex" aria-label="Conversation">
          {selectedThread && (activeChannel === "all" || selectedThread.channel === activeChannel) ? (
            <>
              <header className="flex min-h-16 items-center justify-between gap-3 border-b bg-background px-4 sm:px-5">
                <div className="flex min-w-0 items-center gap-3"><div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(selectedThread.customer)}<span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-background"><ChannelMark channel={selectedThread.channel} size="sm" /></span></div><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-base font-semibold">{selectedThread.customer}</h2><span className="size-2 rounded-full bg-emerald-500" /></div><p className="mt-0.5 truncate text-xs text-muted-foreground">{selectedThread.company || "CRM contact"}</p></div></div>
                <div className="flex items-center gap-1"><button type="button" title="Call customer" onClick={() => setNotice("No phone number is saved for this customer.")} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Phone className="size-4" /></button><button type="button" title={detailsOpen ? "Hide customer details" : "Show customer details"} aria-pressed={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className={`rounded-md p-2 hover:bg-muted ${detailsOpen ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}><UserRound className="size-4" /></button><DropdownMenu><DropdownMenuTrigger className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground" aria-label="Conversation actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuLabel>Conversation actions</DropdownMenuLabel><DropdownMenuItem onClick={assignToMe}><UserCheck />Assign to me</DropdownMenuItem><DropdownMenuItem onClick={markUnread}><MessageCircleMore />Mark as unread</DropdownMenuItem><DropdownMenuItem onClick={() => void copyCustomerId()}><Copy />Copy customer ID</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={toggleResolved}><Archive />{resolvedIds.has(selectedThread.id) ? "Reopen conversation" : "Mark as resolved"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
                <div className="mx-auto max-w-2xl"><div className="mb-5 flex items-center gap-3 text-xs uppercase tracking-[0.08em] text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>Today</span><span className="h-px flex-1 bg-border" /></div><div className="space-y-4">
                  {selectedThread.messages.map((message) => {
                    const outbound = message.direction === "outbound";
                    const translated = translationOn && translations[message.body];
                    return (
                      <div key={message.id} className={`flex items-end gap-2 ${outbound ? "justify-end" : "justify-start"}`}>
                        {!outbound ? <div className="mb-5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(selectedThread.customer)}</div> : null}
                        <div className={`max-w-[82%] sm:max-w-[70%] ${outbound ? "items-end" : "items-start"} flex flex-col`}><div className={`rounded-2xl px-4 py-2.5 text-xs leading-5 shadow-[0_1px_1px_rgba(0,0,0,0.03)] ${outbound ? "rounded-br-md bg-[#153f33] text-white dark:bg-primary dark:text-primary-foreground" : "rounded-bl-md border bg-background text-foreground"}`}><p>{message.body}</p>{translated ? <div className="mt-2 border-t border-border/50 pt-2"><p className="mb-0.5 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-primary"><Languages className="size-3" />Translated to English</p><p className="text-xs text-muted-foreground">{translated}</p></div> : null}</div><p className="mt-1 flex items-center gap-1 px-1 text-xs text-muted-foreground">{formatTime(message.createdAt)}{outbound ? <CheckCheck className="size-3 text-primary" /> : null}</p></div>
                      </div>
                    );
                  })}
                </div></div>
              </div>
              <div className="border-t bg-background p-3 sm:p-4"><div className="mx-auto max-w-3xl">
                <div className="mb-2 flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-md border bg-[#faf5ff] px-2.5 py-1.5 text-xs text-[#6d28d9] dark:bg-violet-500/10 dark:text-violet-300"><Languages className="size-3.5" /><span>Chinese → English</span><Toggle checked={translationOn} onChange={() => setTranslationOn((value) => !value)} label="Toggle automatic translation" /></div><div className="flex items-center gap-2 rounded-md border bg-[#f0fdf4] px-2.5 py-1.5 text-xs text-[#047857] dark:bg-emerald-500/10 dark:text-emerald-300"><Bot className="size-3.5" /><span>AI auto-reply</span><Toggle checked={autoReplyOn} onChange={() => setAutoReplyOn((value) => !value)} label="Toggle AI auto-reply" /></div><span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{formatReplyWindow(selectedThread.replyWindowEndsAt)}</span></div>
                {autoReplyOn ? <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-0.5"><span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600 dark:text-violet-300"><Sparkles className="size-3" />AI suggestions</span>{["Share the latest catalog", "Confirm shipping options", "Ask about order quantity"].map((suggestion) => <button key={suggestion} type="button" onClick={() => setDraft(suggestion === "Share the latest catalog" ? "Absolutely — I’ll send our latest pet bed catalog with wholesale pricing and MOQ details now." : suggestion === "Confirm shipping options" ? "Yes, we can help with international shipping. Which country and quantity should I quote?" : "What quantity are you considering for your first order?")} className="shrink-0 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">{suggestion}</button>)}</div> : null}
                <div className="rounded-xl border bg-background shadow-[0_8px_30px_rgba(15,23,42,0.05)] focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} disabled={!selectedThread.replyWindowOpen || resolvedIds.has(selectedThread.id)} placeholder={resolvedIds.has(selectedThread.id) ? "Reopen this conversation to reply" : selectedThread.replyWindowOpen ? `Reply to ${selectedThread.customer}…` : "The reply window is closed"} className="min-h-20 w-full resize-none bg-transparent px-3.5 pt-3 text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed" /><div className="flex items-center justify-between border-t px-2 py-1.5"><div className="flex items-center gap-0.5"><button type="button" disabled title="Attachments require Meta media-message setup" className="cursor-not-allowed rounded-md p-1.5 text-muted-foreground opacity-40"><Paperclip className="size-4" /></button><button type="button" title="Add emoji" onClick={() => setDraft((value) => `${value}${value ? " " : ""}😊`)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Smile className="size-4" /></button><button type="button" title="Draft with AI" onClick={() => setDraft((value) => value || "Thanks for reaching out! I’d be happy to help with your request.")} className="rounded-md p-1.5 text-violet-600 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10"><WandSparkles className="size-4" /></button></div><div className="flex items-center gap-2"><span className="hidden text-xs text-muted-foreground sm:inline">Enter to send</span><button type="button" onClick={() => void handleSend()} disabled={sending || !draft.trim() || !selectedThread.replyWindowOpen || resolvedIds.has(selectedThread.id)} className="inline-flex h-8 items-center gap-2 rounded-md bg-[#153f33] px-3 text-xs font-semibold text-white hover:bg-[#0f3329] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-primary dark:text-primary-foreground"><SendHorizonal className="size-3.5" />{sending ? "Sending" : "Send"}</button></div></div></div>
                {notice ? <p role="status" className="mt-2 text-xs text-muted-foreground">{notice}</p> : null}
              </div></div>
            </>
          ) : <div className="flex flex-1 items-center justify-center p-8 text-center"><div><MessageCircleMore className="mx-auto size-10 text-muted-foreground/40" /><h2 className="mt-3 text-sm font-semibold">No conversation selected</h2><p className="mt-1 text-xs text-muted-foreground">Choose a conversation or connect this channel to get started.</p></div></div>}
        </section>

        {selectedThread && detailsOpen ? (
          <aside className="hidden min-h-0 flex-col border-l bg-background 2xl:flex" aria-label="Customer details">
            <div className="flex h-16 items-center justify-between border-b px-5">
              <h2 className="text-base font-semibold">Customer details</h2>
              <button type="button" title="Hide customer details" onClick={() => setDetailsOpen(false)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><PanelRightClose className="size-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b px-5 py-5 text-center">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-[#e8eef7] text-base font-semibold text-[#38536f] ring-4 ring-[#f5f8fc] dark:bg-muted dark:text-foreground dark:ring-muted/40">{initials(selectedThread.customer)}</div>
                <h3 className="mt-3 text-[1.05rem] font-semibold leading-none">{selectedThread.customer}</h3>
                <p className="mt-2 text-xs text-muted-foreground">{selectedThread.company || "CRM contact"}</p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <Link href="/companies" className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90"><CircleUserRound className="size-4" />View CRM profile</Link>
                  <DropdownMenu><DropdownMenuTrigger className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground outline-none hover:bg-muted hover:text-foreground" aria-label="Customer actions"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>Customer actions</DropdownMenuLabel><DropdownMenuItem onClick={assignToMe}><UserCheck />Assign to me</DropdownMenuItem><DropdownMenuItem onClick={() => void copyCustomerId()}><Copy />Copy customer ID</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={toggleResolved}><Archive />{resolvedIds.has(selectedThread.id) ? "Reopen" : "Resolve"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                </div>
              </div>

              <div className="border-b p-5">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Conversation</h4>
                <dl className="overflow-hidden rounded-lg border bg-muted/10">
                  <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2 border-b px-3 py-2.5"><span className="flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground"><MessageCircleMore className="size-3.5" /></span><dt className="text-sm text-muted-foreground">Status</dt><dd className={`rounded-full px-2.5 py-1 text-xs font-semibold ${resolvedIds.has(selectedThread.id) ? "bg-muted text-muted-foreground" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}>{resolvedIds.has(selectedThread.id) ? "Resolved" : selectedThread.status}</dd></div>
                  <button type="button" onClick={assignToMe} className="grid w-full grid-cols-[28px_1fr_auto] items-center gap-2 border-b px-3 py-2.5 text-left hover:bg-muted/60"><span className="flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground"><UserRound className="size-3.5" /></span><span className="text-sm text-muted-foreground">Assigned to</span><span className="flex items-center gap-2 text-sm font-medium"><span className="flex size-6 items-center justify-center rounded-full bg-background text-xs">{selectedThread.operator === "Unassigned" ? "+" : initials(selectedThread.operator || "You")}</span>{selectedThread.operator || "Unassigned"}</span></button>
                  <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2 border-b px-3 py-2.5"><span className="flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground"><Languages className="size-3.5" /></span><dt className="text-sm text-muted-foreground">Language</dt><dd className="text-sm font-medium">{selectedThread.language}</dd></div>
                  <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2 border-b px-3 py-2.5"><span className="flex size-7 items-center justify-center rounded-md bg-background text-muted-foreground"><Flag className="size-3.5" /></span><dt className="text-sm text-muted-foreground">Priority</dt><dd className={`text-sm font-medium ${selectedThread.priority === "High" ? "text-amber-600" : ""}`}>{selectedThread.priority}</dd></div>
                  <div className="grid grid-cols-[28px_1fr_auto] items-center gap-2 px-3 py-2.5"><span className="flex size-7 items-center justify-center rounded-md bg-background"><ChannelMark channel={selectedThread.channel} size="sm" /></span><dt className="text-sm text-muted-foreground">Channel</dt><dd className="text-sm font-medium">{selectedThread.channel === "instagram" ? "Instagram" : "Facebook"}</dd></div>
                </dl>
              </div>

              <div className="border-b p-5">
                <div className="flex items-center justify-between"><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">CRM activity</h4><Link href="/companies" className="text-xs font-semibold text-primary hover:underline">View all</Link></div>
                <div className="relative mt-4 space-y-4 pl-6 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-border"><div className="relative"><span className="absolute -left-6 top-1 size-3 rounded-full border-[3px] border-background bg-primary" /><p className="text-sm font-medium leading-5">Messenger conversation</p><p className="mt-1 text-xs text-muted-foreground">Active today</p></div><div className="relative"><span className="absolute -left-6 top-1 size-3 rounded-full border-[3px] border-background bg-muted-foreground/40" /><p className="text-sm font-medium leading-5">Added to B2B leads</p><p className="mt-1 text-xs text-muted-foreground">Oct 12, 2026</p></div></div>
              </div>

              <div className="p-5"><h4 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">AI summary</h4><div className="mt-3 rounded-xl border border-violet-200/70 bg-violet-50/60 p-3.5 dark:border-violet-500/20 dark:bg-violet-500/5"><p className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300"><Sparkles className="size-4" />Conversation brief</p><p className="mt-2 text-sm leading-5 text-muted-foreground">Customer is interested in wholesale pet beds and needs the latest catalog, pricing, and minimum order details.</p></div></div>
            </div>
            <div className="border-t p-4"><button type="button" onClick={toggleResolved} className={`flex h-10 w-full items-center justify-center gap-2 rounded-md text-xs font-semibold ${resolvedIds.has(selectedThread.id) ? "border bg-background hover:bg-muted" : "bg-foreground text-background hover:bg-foreground/90"}`}><Check className="size-4" />{resolvedIds.has(selectedThread.id) ? "Reopen conversation" : "Mark conversation resolved"}</button></div>
          </aside>
        ) : null}
      </div>

      {!data.connection.configured || data.dataError ? <div className="flex flex-wrap items-center gap-2 border-t bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"><Zap className="size-3.5" /><span>{data.connection.configured ? "CRM data connection needs attention." : "Connect Meta in Settings to receive and send live messages."}</span>{data.connection.missing.length > 0 ? <span className="font-mono opacity-70">Missing: {data.connection.missing.join(", ")}</span> : null}<Link href="/setup" className="ml-auto flex items-center gap-1 font-semibold hover:underline"><ArrowDownToLine className="size-3" />Setup guide</Link></div> : null}
    </div>
  );
}
