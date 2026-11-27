"use client";

import { Fragment, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArrowLeft, Check, CheckCheck, ChevronDown, Clock3, Copy, Globe2, Inbox, Languages, MessageCircleMore, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, Search, SendHorizonal, Settings2, Smile, Wifi, X } from "lucide-react";
import { AiIcon } from "@/components/ai-icon";
import { useLanguage } from "@/components/language-provider";
import { PageActions, PageHeaderDetails } from "@/components/page-header";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { launchWorkspaceAi } from "@/lib/ai/launch";
import type { MetaThreadMessage } from "@/lib/meta-messenger";
import { mergeWebsiteThreads, type MessengerThread, type MessengerInboxData, type WebsiteInboxData } from "@/lib/messenger";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar as ContactAvatar, AvatarFallback } from "@/components/ui/avatar";
import { InputGroup, InputGroupInput, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group";
import { NotificationToast } from "@/components/ui/notification-toast";
import { EmptyState } from "@/components/data-state";
import styles from "@/components/messenger-inbox.module.css";

type Channel = "all" | "web" | "whatsapp" | "facebook" | "instagram";
type InboxFilter = "all" | "unread" | "resolved";
const channelOptions: Array<{
  id: Channel;
  label: string;
  shortLabel: string;
  markClass: string;
}> = [
  { id: "all", label: "All conversations", shortLabel: "All", markClass: "bg-foreground text-background" },
  { id: "web", label: "Website chat", shortLabel: "Website", markClass: "bg-[#8b5cf6] text-white" },
  { id: "whatsapp", label: "WhatsApp", shortLabel: "WhatsApp", markClass: "bg-[#25d366] text-white" },
  { id: "facebook", label: "Facebook", shortLabel: "Facebook", markClass: "bg-[#1877f2] text-white" },
  { id: "instagram", label: "Instagram", shortLabel: "Instagram", markClass: "bg-gradient-to-br from-[#7c3aed] via-[#e1306c] to-[#f59e0b] text-white" },
];

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


const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(" ");
const channelName = (channel: Channel) => channelOptions.find((option) => option.id === channel)!.shortLabel;
const quickReplies = [
  { label: "Say hello", text: "Thanks for reaching out! How can I help you today?" },
  { label: "Ask about quantity", text: "What quantity are you considering for your order?" },
  { label: "Shipping destination", text: "Which country and postal code would you like us to ship to?" },
];
function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
function formatTime(value: string, language: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit" }).format(date);
}
function formatDate(value: string, language: string, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(language, { month: "short", day: "numeric", year: "numeric", ...(includeTime ? { hour: "numeric", minute: "2-digit" } as const : {}) }).format(date);
}
function dayKey(value: string) { return new Date(value).toDateString(); }
function Avatar({ thread, large = false }: { thread: MessengerThread; large?: boolean }) {
  return <div className="relative shrink-0" aria-hidden="true"><ContactAvatar size={large ? "lg" : "default"}><AvatarFallback>{initials(thread.customer)}</AvatarFallback></ContactAvatar><span className="absolute -bottom-1 -right-1 rounded-full border-2 border-background"><ChannelMark channel={thread.channel} size="sm" /></span></div>;
}

export function MessengerInbox({ data }: { data: MessengerInboxData }) {
  const { language, t } = useLanguage();
  const [threads, setThreads] = useState(data.threads);
  const [selectedId, setSelectedId] = useState(data.threads[0]?.id ?? "");
  const [activeChannel, setActiveChannel] = useState<Channel>("all");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const [sortNewest, setSortNewest] = useState(true);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const pendingWebsiteReplies = useRef<Record<string, { id: string; body: string }>>({});
  const websiteReadThrough = useRef<Record<string, string>>({});
  const [websiteConnected, setWebsiteConnected] = useState(data.connection.webConfigured);
  const [websiteCanReply, setWebsiteCanReply] = useState(data.canReply);
  const [websiteError, setWebsiteError] = useState(data.websiteError);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [mobileReading, setMobileReading] = useState(false);
  const [detailsMode, setDetailsMode] = useState<"open" | "closed">("closed");
  const detailsOpen = detailsMode === "open";
  const [quickRepliesOpen, setQuickRepliesOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const detailsTriggerRef = useRef<HTMLButtonElement>(null);
  const detailsCloseRef = useRef<HTMLButtonElement>(null);
  const previousDetailsOpen = useRef(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const channelThreads = useMemo(() => threads.filter((thread) => activeChannel === "all" || thread.channel === activeChannel), [activeChannel, threads]);
  const filteredThreads = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return channelThreads.filter((thread) => {
      const matchesSearch = !normalized || (thread.customer + " " + thread.customerId + " " + (thread.contextLabel ?? "") + " " + thread.lastMessage).toLowerCase().includes(normalized);
      const matchesFilter = filter === "unread" ? thread.unread > 0 : filter === "resolved" ? resolvedIds.has(thread.id) : true;
      return matchesSearch && matchesFilter;
    }).sort((a, b) => (new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) * (sortNewest ? 1 : -1));
  }, [channelThreads, filter, resolvedIds, search, sortNewest]);
  // Keep a conversation open after marking it read or resolving it.
  const selectedThread = channelThreads.find((thread) => thread.id === selectedId) ?? filteredThreads[0];
  const draft = drafts[selectedThread?.id ?? ""] ?? "";
  const unreadCount = threads.reduce((total, thread) => total + thread.unread, 0);
  const unreadThreads = channelThreads.filter((thread) => thread.unread > 0).length;
  const isResolved = Boolean(selectedThread && resolvedIds.has(selectedThread.id));
  const replyWindowOpen = Boolean(selectedThread && (selectedThread.channel === "web" || (selectedThread.replyWindowOpen && (!selectedThread.replyWindowEndsAt || new Date(selectedThread.replyWindowEndsAt).getTime() > now))));
  const channelConnected = (channel: Channel): boolean => channel === "all"
    ? websiteConnected || data.connection.facebookConfigured || data.connection.instagramConfigured || data.connection.whatsappConfigured
    : channel === "facebook" ? data.connection.facebookConfigured
    : channel === "instagram" ? data.connection.instagramConfigured
    : channel === "whatsapp" ? data.connection.whatsappConfigured : websiteConnected;
  const connectedCount = channelOptions.filter((option) => option.id !== "all" && channelConnected(option.id)).length;
  const canReply = Boolean(selectedThread && data.canReply && (selectedThread.channel !== "web" || websiteCanReply) && channelConnected(selectedThread.channel) && replyWindowOpen && !isResolved);
  const lastInbound = selectedThread?.messages.findLast((message) => message.direction === "inbound");
  const firstMessage = selectedThread?.messages[0];
  const activeOption = channelOptions.find((option) => option.id === activeChannel)!;

  const acceptWebsiteSnapshot = useEffectEvent((snapshot: WebsiteInboxData & { canReply: boolean }) => {
    const visible = document.visibilityState === "visible" && (window.matchMedia("(min-width: 768px)").matches || mobileReading);
    if (visible && selectedThread?.channel === "web") {
      const latest = snapshot.threads.find((thread) => thread.id === selectedThread.id);
      if (latest) websiteReadThrough.current[latest.id] = latest.updatedAt;
    }
    setThreads((current) => mergeWebsiteThreads(current, snapshot.threads, websiteReadThrough.current));
    setWebsiteConnected(snapshot.connected);
    setWebsiteCanReply(snapshot.canReply);
    setWebsiteError(null);
  });
  useEffect(() => {
    let pending: AbortController | null = null;
    let disposed = false;
    async function refresh() {
      if (pending || document.visibilityState !== "visible" || workspaceRef.current?.closest("[hidden], [inert]")) return;
      pending = new AbortController();
      const controller = pending;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/messenger/website", { cache: "no-store", signal: controller.signal });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          setThreads((current) => current.filter((thread) => thread.channel !== "web"));
          setWebsiteConnected(false); setWebsiteCanReply(false);
          throw new Error("Sign in with an active workspace account to refresh website messages.");
        }
        const snapshot = await response.json();
        if (!response.ok || !Array.isArray(snapshot.threads)) throw new Error(snapshot.error || "Website messages could not be refreshed.");
        if (!disposed) acceptWebsiteSnapshot(snapshot);
      } catch (error) {
        if (!disposed) setWebsiteError(error instanceof Error && error.name !== "AbortError" ? error.message : "Website messages could not be refreshed.");
      } finally { window.clearTimeout(timeout); pending = null; }
    }
    const resume = () => void refresh();
    const interval = window.setInterval(resume, 5_000);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { disposed = true; pending?.abort(); window.clearInterval(interval); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => {
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [selectedThread?.id, selectedThread?.messages.length, mobileReading]);
  useEffect(() => {
    if (detailsOpen && detailsMode === "open") detailsCloseRef.current?.focus();
    if (!detailsOpen && previousDetailsOpen.current) detailsTriggerRef.current?.focus();
    previousDetailsOpen.current = detailsOpen;
  }, [detailsMode, detailsOpen]);
  useEffect(() => {
    function keyboardShortcuts(event: KeyboardEvent) {
      if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable='true']")) return;
        event.preventDefault(); setMobileReading(false);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key === "Escape" && detailsOpen) {
        setDetailsMode("closed"); detailsTriggerRef.current?.focus();
      }
    }
    window.addEventListener("keydown", keyboardShortcuts);
    return () => window.removeEventListener("keydown", keyboardShortcuts);
  }, [detailsOpen]);
  useEffect(() => {
    function openAgentDraft(event: Event) {
      const prepared = (event as CustomEvent<{ draftMessage?: { conversationId: string; text: string } }>).detail?.draftMessage;
      if (!prepared) return;
      const target = threads.find((thread) => thread.id === prepared.conversationId);
      if (!target) { setNotice({ text: "Refresh Messenger to open the agent's conversation.", error: true }); return; }
      if (drafts[target.id]?.trim()) { setNotice({ text: "This conversation already has a draft. Finish or clear it before inserting the agent draft.", error: true }); return; }
      setActiveChannel("all"); setSearch(""); setFilter("all"); setSelectedId(target.id); setMobileReading(true);
      setDrafts((current) => ({ ...current, [target.id]: prepared.text }));
      setNotice({ text: "Agent draft ready. Review it before sending." });
    }
    window.addEventListener("filazoo:agent-action", openAgentDraft);
    return () => window.removeEventListener("filazoo:agent-action", openAgentDraft);
  }, [drafts, threads]);

  function setDraft(value: string) {
    if (selectedThread) setDrafts((current) => ({ ...current, [selectedThread.id]: value }));
  }
  function chooseThread(thread: MessengerThread) {
    if (thread.channel === "web") websiteReadThrough.current[thread.id] = thread.updatedAt;
    setSelectedId(thread.id); setMobileReading(true); setNotice(null);
    setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, unread: 0, status: item.status === "New" ? "Open" : item.status } : item));
  }
  function selectChannel(channel: Channel) {
    setMobileReading(false); setActiveChannel(channel); setNotice(null);
    setSelectedId(threads.find((thread) => channel === "all" || thread.channel === channel)?.id ?? "");
  }
  function toggleResolved() {
    if (!selectedThread) return;
    setResolvedIds((current) => {
      const next = new Set(current);
      if (next.has(selectedThread.id)) next.delete(selectedThread.id); else next.add(selectedThread.id);
      return next;
    });
    setNotice({ text: isResolved ? "Conversation reopened." : "Conversation marked as resolved." });
  }
  async function copyCustomerId() {
    if (!selectedThread) return;
    try { await navigator.clipboard.writeText(selectedThread.customerId); setNotice({ text: "Customer ID copied." }); }
    catch { setNotice({ text: "Customer ID: " + selectedThread.customerId }); }
  }
  function openAssistant(translate = false) {
    if (!selectedThread) return;
    setDetailsMode("closed");
    launchWorkspaceAi({ mode: translate || selectedThread.channel === "web" ? "chat" : "agent", submit: false, prompt: translate
      ? "Translate the latest incoming message in conversation " + selectedThread.id + " into " + (language === "zh-CN" ? "Chinese" : "English") + ":\n" + (lastInbound?.body ?? "")
      : "Prepare a reply draft for conversation " + selectedThread.id + " with " + selectedThread.customer + ". " + (draft.trim() ? "Improve my draft: " + draft : "Use the conversation context and ask for any missing details.") + " Do not send the message." });
  }
  async function handleSend() {
    const message = draft.trim();
    if (!selectedThread || !message || !canReply || sendingRef.current) return;
    if (selectedThread.channel !== "web" && selectedThread.replyWindowEndsAt && new Date(selectedThread.replyWindowEndsAt).getTime() <= Date.now()) {
      setNow(Date.now());
      return;
    }
    const thread = selectedThread;
    if (thread.channel === "web" && (!thread.invoiceId || message.length > 4000)) {
      setNotice({ text: "Enter a portal reply of 1–4,000 characters.", error: true });
      return;
    }
    let portalReply: { id: string; body: string } | undefined;
    if (thread.channel === "web") {
      const previous = pendingWebsiteReplies.current[thread.id];
      portalReply = previous?.body === message ? previous : { id: crypto.randomUUID(), body: message };
      pendingWebsiteReplies.current[thread.id] = portalReply;
    }
    sendingRef.current = true; setSending(true); setNotice(null);
    try {
      const endpoint = thread.channel === "web" ? "/api/invoices/" + thread.invoiceId + "/portal" + (thread.companyId ? "?companyId=" + encodeURIComponent(thread.companyId) : "") : "/api/meta/send";
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(portalReply ? { action: "reply", ...portalReply } : { to: thread.customerId, message, channel: thread.channel }) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || (portalReply && result.ok !== true)) throw new Error(result?.error || "Your message could not be sent. Please try again.");
      const sent: MetaThreadMessage = { id: portalReply?.id || result?.messageId || "local-" + Date.now(), direction: "outbound", body: message, type: "text", status: "sent", createdAt: result?.createdAt || new Date().toISOString() };
      if (portalReply) delete pendingWebsiteReplies.current[thread.id];
      setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, messages: [...item.messages, sent], lastMessage: message, updatedAt: sent.createdAt, status: "Open" } : item));
      setDrafts((current) => ({ ...current, [thread.id]: current[thread.id] === draft ? "" : current[thread.id] }));
      setNotice({ text: "Reply to " + thread.customer + " submitted through " + channelName(thread.channel) + "." });
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? reason.message : "Your message could not be sent. Please try again.", error: true });
    } finally { sendingRef.current = false; setSending(false); }
  }

  return (
    <div ref={workspaceRef} className={cx("messenger-workspace h-full min-h-0 min-w-0 overflow-hidden border-t bg-background", styles.workspace)} data-reading={mobileReading} data-ai-conversation-id={selectedThread?.id} data-ai-company-id={selectedThread?.companyId || undefined}>
      <PageHeaderDetails>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto" aria-label="Messaging channels">
          {channelOptions.map((channel) => {
            const count = channel.id === "all" ? unreadCount : threads.filter((thread) => thread.channel === channel.id).reduce((total, thread) => total + thread.unread, 0);
            return <Button key={channel.id} type="button" size="xs" variant="ghost" aria-pressed={activeChannel === channel.id} onClick={() => selectChannel(channel.id)} className={activeChannel === channel.id ? "bg-muted text-foreground" : "text-muted-foreground"}>
              {channel.id === "all" ? <Inbox className="size-3.5" /> : <ChannelMark channel={channel.id} size="sm" />}
              {channel.shortLabel}{count > 0 ? <Badge variant="secondary" className="min-h-4 px-1 py-0 text-[10px]">{count}</Badge> : null}
            </Button>;
          })}
          <Link href="/settings/apps" className={buttonVariants({ variant: "ghost", size: "icon-xs", className: "ml-1 text-muted-foreground" })} aria-label="Add channel" title="Add channel"><Plus /></Link>
        </nav>
      </PageHeaderDetails>
      <PageActions>
        <span className="hidden items-center gap-1.5 self-center text-xs text-muted-foreground xl:inline-flex"><span className={cx("size-1.5 rounded-full", connectedCount > 0 ? "bg-emerald-500" : "bg-amber-500")} />{connectedCount > 0 ? connectedCount + (connectedCount === 1 ? " channel connected" : " channels connected") : "Disconnected"}</span>
        <Link href="/settings/apps" className={buttonVariants({ variant: "outline", size: "xs" })}><Settings2 />Inbox settings</Link>
      </PageActions>
      {data.dataError ? <NotificationToast tone="error">Could not load all messages. Refresh to try again.</NotificationToast> : null}
      {websiteError ? <NotificationToast tone="error">{websiteError}</NotificationToast> : null}

      <div className={styles.layout} data-details={Boolean(selectedThread && detailsOpen)}>
        <section className={cx(styles.inbox, "flex min-h-0 min-w-0 flex-col border-r")} aria-label="Conversations">
          <div className="space-y-3 border-b p-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <h2 className="flex items-center gap-2 text-sm font-semibold">Inbox<Badge variant="secondary">{channelThreads.length}</Badge></h2>
              <DropdownMenu><DropdownMenuTrigger aria-label="Inbox actions" className={buttonVariants({ variant: "ghost", size: "icon-xs" })}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Inbox actions</DropdownMenuLabel><DropdownMenuItem onClick={() => setThreads((current) => current.map((thread) => ({ ...thread, unread: 0 })))}><CheckCheck />Mark all as read</DropdownMenuItem><DropdownMenuItem onClick={() => setSortNewest((value) => !value)}><Clock3 />{sortNewest ? "Show oldest first" : "Show newest first"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </div>
            <InputGroup className="h-9 bg-muted/20">
              <InputGroupAddon><Search className="size-3.5" /></InputGroupAddon>
              <InputGroupInput ref={searchRef} aria-label="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" className="h-9" />
              {search ? <InputGroupAddon align="inline-end"><Button type="button" size="icon-xs" variant="ghost" aria-label="Clear search" onClick={() => { setSearch(""); searchRef.current?.focus(); }}><X /></Button></InputGroupAddon> : null}
            </InputGroup>
            <div className="flex gap-1" role="group" aria-label="Filter conversations">
              <Button type="button" size="xs" variant="ghost" aria-pressed={filter === "all"} className={filter === "all" ? "bg-muted" : "text-muted-foreground"} onClick={() => setFilter("all")}>All</Button>
              <Button type="button" size="xs" variant="ghost" aria-pressed={filter === "unread"} className={filter === "unread" ? "bg-muted" : "text-muted-foreground"} onClick={() => setFilter("unread")}>Unread{unreadThreads > 0 ? <span className="text-muted-foreground">{unreadThreads}</span> : null}</Button>
              <Button type="button" size="xs" variant="ghost" aria-pressed={filter === "resolved"} className={filter === "resolved" ? "bg-muted" : "text-muted-foreground"} onClick={() => setFilter("resolved")}>Resolved</Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {filteredThreads.length === 0 ? <div className="p-3"><EmptyState compact icon={Inbox} className="border-0" title={search ? "No matching conversations" : filter === "unread" ? "No unread conversations" : filter === "resolved" ? "No resolved conversations" : "No conversations"}>
              {search || filter !== "all" ? <Button size="xs" variant="outline" onClick={() => { setSearch(""); setFilter("all"); }}>Clear filters</Button> : !channelConnected(activeChannel) ? <Link href={activeChannel === "web" ? "/customer-portal" : "/settings/apps"} className={buttonVariants({ size: "xs", variant: "outline" })}>{activeChannel === "web" ? "Portal settings" : "Connect " + (activeChannel === "all" ? "a channel" : activeOption.shortLabel)}</Link> : null}
            </EmptyState></div> : filteredThreads.map((thread) => <button key={thread.id} type="button" data-messenger-thread aria-pressed={selectedThread?.id === thread.id} onClick={() => chooseThread(thread)} className={cx("flex w-full gap-3 border-b px-4 py-4 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selectedThread?.id === thread.id && "bg-primary/5")}>
              <Avatar thread={thread} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2"><strong className="min-w-0 flex-1 truncate text-sm font-medium">{thread.customer}</strong><time className="shrink-0 text-xs text-muted-foreground" dateTime={thread.updatedAt} title={formatDate(thread.updatedAt, language, true)}>{formatTime(thread.updatedAt, language)}</time></div>
                <div className="mt-1 flex items-center gap-2"><p className={cx("min-w-0 flex-1 truncate text-xs", thread.unread > 0 ? "font-medium" : "text-muted-foreground")}>{drafts[thread.id]?.trim() ? <><span className="text-primary">Draft: </span>{drafts[thread.id]}</> : <>{thread.messages.at(-1)?.direction === "outbound" ? "You: " : ""}{thread.lastMessage}</>}</p>{thread.unread > 0 ? <Badge className="min-h-4 px-1.5 py-0 text-[10px]" aria-label={thread.unread + " unread messages"}>{thread.unread}</Badge> : resolvedIds.has(thread.id) ? <CheckCheck className="size-3.5 text-muted-foreground" /> : null}</div>
                <p className="mt-1 text-xs text-muted-foreground">{channelName(thread.channel)}{thread.contextLabel ? " · " + thread.contextLabel : ""}</p>
              </div>
            </button>)}
          </div>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-2 border-t px-4 text-xs text-muted-foreground"><span>{filteredThreads.length} {filteredThreads.length === 1 ? "conversation" : "conversations"}</span><Button type="button" size="xs" variant="ghost" className="px-1 text-xs text-muted-foreground" onClick={() => setSortNewest((value) => !value)}>{sortNewest ? "Newest first" : "Oldest first"}<ChevronDown className={cx("size-3", !sortNewest && "rotate-180")} /></Button></div>
        </section>

        <section className={cx(styles.conversation, "min-h-0 min-w-0 flex-col bg-background")} aria-label="Conversation">
          {selectedThread ? <>
            <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4">
              <Button type="button" size="icon-xs" variant="ghost" className="md:hidden" aria-label="Back to conversations" onClick={() => setMobileReading(false)}><ArrowLeft /></Button>
              <Avatar thread={selectedThread} />
              <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{selectedThread.customer}</h3><p className="mt-0.5 truncate text-xs text-muted-foreground">{channelName(selectedThread.channel)} · {selectedThread.customerId}</p></div>
              <Button type="button" size="xs" variant="outline" onClick={toggleResolved} className="hidden sm:inline-flex"><Check />{isResolved ? "Reopen" : "Resolve"}</Button>
              <Button ref={detailsTriggerRef} type="button" size="icon-xs" variant="ghost" className={detailsOpen ? "text-primary" : "text-muted-foreground"} aria-label={detailsOpen ? "Hide customer details" : "Show customer details"} aria-expanded={detailsOpen} aria-controls={detailsOpen ? "messenger-customer-details" : undefined} onClick={() => setDetailsMode(detailsOpen ? "closed" : "open")}><PanelRightOpen /></Button>
              <DropdownMenu><DropdownMenuTrigger className={buttonVariants({ size: "icon-xs", variant: "ghost" })} aria-label="Conversation actions"><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Conversation actions</DropdownMenuLabel><DropdownMenuItem onClick={() => { setThreads((current) => current.map((thread) => thread.id === selectedThread.id ? { ...thread, unread: Math.max(1, thread.unread) } : thread)); setNotice({ text: "Conversation marked as unread." }); }}><MessageCircleMore />Mark as unread</DropdownMenuItem><DropdownMenuItem onClick={() => void copyCustomerId()}><Copy />Copy customer ID</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={toggleResolved}><Archive />{isResolved ? "Reopen conversation" : "Mark as resolved"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </header>
            {selectedThread.channel === "whatsapp" && data.connection.whatsappSandbox ? <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground"><Wifi className="size-3.5" /><span>WhatsApp sandbox</span><Link href="/settings/apps" className="ml-auto hover:text-foreground">Manage</Link></div> : null}
            <div ref={messagesRef} className={cx(styles.messages, "min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6")}>
              <div className="mx-auto max-w-3xl">
                {selectedThread.messages.map((message, index) => {
                  const outbound = message.direction === "outbound";
                  const startsDay = index === 0 || dayKey(message.createdAt) !== dayKey(selectedThread.messages[index - 1].createdAt);
                  return <Fragment key={message.id}>
                    {startsDay ? <div className="mb-6 mt-1 flex items-center gap-4 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><time dateTime={message.createdAt}>{formatDate(message.createdAt, language)}</time><span className="h-px flex-1 bg-border" /></div> : null}
                    <div className={cx("mb-5 flex items-end gap-2", outbound && "justify-end")}>
                      <div className={cx("flex min-w-0 max-w-[85%] flex-col sm:max-w-[75%]", outbound ? "items-end" : "items-start")}>
                        <div className={cx("rounded-xl px-3.5 py-2.5 text-sm leading-6", outbound ? "rounded-br-sm bg-primary/10" : "rounded-bl-sm border bg-background")}><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p></div>
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"><time dateTime={message.createdAt}>{formatTime(message.createdAt, language)}</time>{outbound ? message.status === "failed" ? <span className="text-destructive">Failed</span> : <Check className="size-3" aria-label="Submitted" /> : null}</div>
                      </div>
                    </div>
                  </Fragment>;
                })}
              </div>
            </div>
            <div className={cx(styles.composerArea, "shrink-0 border-t p-3 sm:p-4")}>
              {!canReply ? <div data-reply-notice className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                {!data.canReply || (selectedThread.channel === "web" && !websiteCanReply) ? <span>Your account has read-only access.</span> : isResolved ? <><CheckCheck className="size-3.5 shrink-0" /><span>Conversation resolved.</span><Button type="button" size="xs" variant="link" className="h-auto p-0 text-xs" onClick={toggleResolved}>Reopen</Button></> : !channelConnected(selectedThread.channel) ? <><Wifi className="size-3.5 shrink-0" /><span>{selectedThread.channel === "web" ? "Portal messaging is disabled." : "Connect " + channelName(selectedThread.channel) + " to reply."}</span><Link href={selectedThread.channel === "web" ? "/customer-portal" : "/settings/apps"} className="font-medium text-foreground underline underline-offset-2">Settings</Link></> : <><Clock3 className="size-3.5 shrink-0" /><span>The reply window has ended.</span></>}
              </div> : null}
              <InputGroup className="h-auto flex-col items-stretch overflow-hidden">
                <InputGroupTextarea ref={composerRef} aria-label="Message" value={draft} maxLength={selectedThread.channel === "web" ? 4000 : undefined} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend(); } }} disabled={!canReply || sending} placeholder={canReply ? "Write a reply…" : "Replies unavailable"} rows={3} className="min-h-24 max-h-48 resize-none text-sm" />
                <InputGroupAddon align="block-end" className="flex-wrap gap-1 border-t bg-muted/20 px-2 py-2">
                  <Button type="button" size="xs" variant="ghost" className="text-xs text-violet-600 dark:text-violet-300" onClick={() => openAssistant()} disabled={!canReply || sending}><AiIcon className="size-3.5" />Draft with AI</Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Add emoji" title="Add emoji" disabled={!canReply || sending} onClick={() => { setDraft(draft + " 😊"); composerRef.current?.focus(); }}><Smile /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Translate latest incoming message" title="Translate latest message" disabled={!lastInbound} onClick={() => openAssistant(true)}><Languages /></Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label="Quick replies" title="Quick replies" aria-expanded={quickRepliesOpen} onClick={() => setQuickRepliesOpen((open) => !open)} disabled={!canReply || sending}><MessageCircleMore /></Button>
                  <Button type="button" size="xs" className="ml-auto" onClick={() => void handleSend()} disabled={sending || !draft.trim() || !canReply}><SendHorizonal />{sending ? "Sending…" : "Send"}</Button>
                </InputGroupAddon>
              </InputGroup>
              {quickRepliesOpen && canReply ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Quick replies">{quickReplies.map((reply) => <Button key={reply.label} type="button" variant="outline" size="xs" disabled={sending} onClick={() => { setDraft(draft + (draft ? "\n" : "") + t(reply.text)); composerRef.current?.focus(); }}>{reply.label}</Button>)}</div> : null}
            </div>
          </> : <div className="flex min-h-0 flex-1 items-center justify-center p-6"><EmptyState compact icon={MessageCircleMore} title="Select a conversation" className="w-full max-w-sm border-0" /></div>}
        </section>

        {selectedThread && detailsOpen ? <aside id="messenger-customer-details" className={cx(styles.details, "flex min-h-0 min-w-0 flex-col border-l bg-background")} aria-label="Customer details">
          <div className="flex h-16 shrink-0 items-center justify-between border-b px-4"><h3 className="text-sm font-semibold">Contact details</h3><Button ref={detailsCloseRef} type="button" size="icon-xs" variant="ghost" aria-label="Close customer details" onClick={() => setDetailsMode("closed")}><PanelRightClose /></Button></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-6 flex items-center gap-3"><Avatar thread={selectedThread} large /><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{selectedThread.customer}</h3><p className="mt-1 text-xs text-muted-foreground">{channelName(selectedThread.channel)}</p></div></div>
            <dl className="space-y-4 text-xs">
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd><Badge variant="secondary">{isResolved ? "Resolved" : selectedThread.status}</Badge></dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Connection</dt><dd>{channelConnected(selectedThread.channel) ? "Connected" : "Not connected"}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Messages</dt><dd>{selectedThread.messages.length}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-muted-foreground">Last activity</dt><dd className="text-right">{formatDate(selectedThread.updatedAt, language, true)}</dd></div>
              {firstMessage ? <div className="flex items-start justify-between gap-3"><dt className="shrink-0 text-muted-foreground">First message</dt><dd className="text-right">{formatDate(firstMessage.createdAt, language)}</dd></div> : null}
              <div className="border-t pt-4"><dt className="text-muted-foreground">Customer ID</dt><dd className="mt-2 flex items-center gap-2"><span className="min-w-0 flex-1 break-all">{selectedThread.customerId}</span><Button type="button" size="icon-xs" variant="ghost" aria-label="Copy customer ID" onClick={() => void copyCustomerId()}><Copy /></Button></dd></div>
            </dl>
          </div>
        </aside> : null}
      </div>
      {notice ? <NotificationToast tone={notice.error ? "error" : "message"}>{notice.text}{notice.text.includes("21654") ? <a href="https://console.twilio.com/account/upgrade" target="_blank" rel="noreferrer" className="ml-2 underline">Open Twilio upgrade</a> : null}</NotificationToast> : null}
    </div>
  );
}
