"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Bot, Building2, CalendarClock, Check,
  Clock3, FileText, Filter, Forward, Inbox, Languages, Mail, MoreHorizontal,
  Paperclip, Plus, RefreshCw, Reply, Search, Send, Settings2, ShieldCheck,
  Smile, Sparkles, Star, Tag, Trash2, UserRound, WandSparkles, Workflow, Zap,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { groupEmailConversations, replyReferences, threadKeyForEmail } from "@/lib/email-threading";

export type EmailWorkspaceItem = {
  id: string;
  from?: string;
  direction: "inbound" | "outbound";
  status: string;
  subject: string;
  contact: string;
  company: string;
  preview: string;
  body: string;
  html?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  timestamp: string;
  step?: string;
  demo?: boolean;
  category?: Category | null;
  starred?: boolean;
  read?: boolean;
  folder?: "inbox" | "archive" | "trash";
  followUpAt?: string | null;
};

type Folder = "inbox" | "all" | "drafts" | "scheduled" | "sent" | "starred" | "archive" | "trash";
type Category = "Needs follow-up" | "Waiting on customer" | "Interested" | "Big order" | "No action";
type Automation = { enabled: boolean; queueCount: number; steps: Array<{ id: string; title: string; delay: string; action: string; enabled: boolean }> };

const categoryOptions: Category[] = ["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"];

const categoryStyles: Record<Category, string> = {
  "Needs follow-up": "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  "Waiting on customer": "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  Interested: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  "Big order": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  "No action": "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
};

function conversationState(conversation: EmailConversation) {
  const hasInbound = conversation.messages.some((message) => message.direction === "inbound");
  const hasOutbound = conversation.messages.some((message) => message.direction === "outbound");
  if (conversation.latest.direction === "outbound") {
    return hasInbound
      ? { label: "Replied", badge: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" }
      : { label: "Sent", badge: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300" };
  }
  if (hasOutbound) return { label: "Customer replied", badge: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300" };
  return { label: "Received", badge: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300" };
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

type EmailConversation = { id: string; messages: EmailWorkspaceItem[]; latest: EmailWorkspaceItem };

function buildConversations(emails: EmailWorkspaceItem[]): EmailConversation[] {
  return [...groupEmailConversations(emails).entries()].map(([id, messages]) => {
    const ordered = messages.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    return { id, messages: ordered, latest: ordered[ordered.length - 1]! };
  });
}

function emailDocument(html: string) {
  const safeHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?\s*>/gi, "");
  const additions = '<base target="_blank"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;padding:0;background:transparent}img{max-width:100%;height:auto}</style>';
  return /<head[\s>]/i.test(safeHtml)
    ? safeHtml.replace(/<head([^>]*)>/i, `<head$1>${additions}`)
    : `<!doctype html><html><head>${additions}</head><body>${safeHtml}</body></html>`;
}

function PlainEmailBody({ body }: { body: string }) {
  const linkPattern = /(https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/gi;
  return <div className="whitespace-pre-wrap text-sm leading-7">{body.split(linkPattern).map((part, index) => {
    if (!part) return null;
    const isWebLink = /^(https?:\/\/|www\.)/i.test(part);
    const isEmail = /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/i.test(part);
    if (!isWebLink && !isEmail) return <span key={index}>{part}</span>;
    const trailing = isWebLink ? part.match(/[),.!?;:]+$/)?.[0] ?? "" : "";
    const label = trailing ? part.slice(0, -trailing.length) : part;
    const href = isEmail ? `mailto:${label}` : /^https?:\/\//i.test(label) ? label : `https://${label}`;
    return <span key={index}><a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">{label}</a>{trailing}</span>;
  })}</div>;
}

function EmailBody({ email }: { email: EmailWorkspaceItem }) {
  if (!email.html) return <PlainEmailBody body={email.body} />;
  return <iframe title={`Email content from ${email.contact}`} srcDoc={emailDocument(email.html)} sandbox="allow-popups allow-popups-to-escape-sandbox" className="min-h-[420px] w-full border-0 bg-white" />;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-5 w-9 rounded-full ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${checked ? "translate-x-4" : ""}`} /></button>;
}

function emailMatchesFolder(
  email: EmailWorkspaceItem,
  folder: Folder,
  folderStates: Record<string, "inbox" | "archive" | "trash">,
  starred: Set<string>,
) {
  const state = folderStates[email.id] ?? "inbox";
  if (folder === "all") return state !== "trash";
  if (folder === "inbox") return state === "inbox" && email.direction === "inbound";
  if (folder === "drafts") return state !== "trash" && email.status.toLowerCase().includes("draft");
  if (folder === "scheduled") return state !== "trash" && email.status.toLowerCase().includes("scheduled");
  if (folder === "sent") return state !== "trash" && email.status.toLowerCase().includes("sent");
  if (folder === "starred") return state !== "trash" && starred.has(email.id);
  return folder === state;
}

export function EmailInboxWorkspace({
  initialEmails,
  mailboxConfigured,
  sendConfigured,
  inboxConfigured,
  inboxError,
  aiConfigured,
  defaultMailboxEmail,
  dataMode,
  initialAutomation,
}: {
  initialEmails: EmailWorkspaceItem[];
  mailboxConfigured: boolean;
  sendConfigured: boolean;
  inboxConfigured: boolean;
  inboxError: string | null;
  aiConfigured: boolean;
  defaultMailboxEmail: string | null;
  dataMode: "demo" | "live";
  initialAutomation: Automation;
}) {
  const sourceEmails = initialEmails;
  const [emails, setEmails] = useState(sourceEmails);
  const [folder, setFolder] = useState<Folder>("inbox");
  const [selectedId, setSelectedId] = useState(sourceEmails[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [draft, setDraft] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeSending, setComposeSending] = useState(false);
  const [translationOn, setTranslationOn] = useState(true);
  const [aiReplyOn, setAiReplyOn] = useState(true);
  const [starred, setStarred] = useState<Set<string>>(() => new Set(sourceEmails.filter((email) => email.starred).map((email) => email.id)));
  const [readMessages, setReadMessages] = useState<Set<string>>(() => new Set(sourceEmails.filter((email) => email.read || email.direction === "outbound").map((email) => email.id)));
  const [categories, setCategories] = useState<Record<string, Category>>(() => Object.fromEntries(sourceEmails.flatMap((email) => email.category ? [[email.id, email.category]] : [])));
  const [followUps, setFollowUps] = useState<Record<string, string>>(() => Object.fromEntries(sourceEmails.flatMap((email) => email.followUpAt ? [[email.id, email.followUpAt]] : [])));
  const [folderStates, setFolderStates] = useState<Record<string, "inbox" | "archive" | "trash">>(() => Object.fromEntries(sourceEmails.map((email) => [email.id, email.folder ?? "inbox"])));
  const [flowEnabled, setFlowEnabled] = useState(initialAutomation.enabled);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState("Just now");
  const [syncError, setSyncError] = useState<string | null>(inboxError);
  const [syncing, setSyncing] = useState(false);
  const syncInProgress = useRef(false);

  const applyMailboxSnapshot = useCallback((nextEmails: EmailWorkspaceItem[]) => {
    setEmails(nextEmails);
    setStarred(new Set(nextEmails.filter((email) => email.starred).map((email) => email.id)));
    setReadMessages(new Set(nextEmails.filter((email) => email.read || email.direction === "outbound").map((email) => email.id)));
    setCategories(Object.fromEntries(nextEmails.flatMap((email) => email.category ? [[email.id, email.category]] : [])));
    setFollowUps(Object.fromEntries(nextEmails.flatMap((email) => email.followUpAt ? [[email.id, email.followUpAt]] : [])));
    setFolderStates(Object.fromEntries(nextEmails.map((email) => [email.id, email.folder ?? "inbox"])));
    setSelectedId((current) => nextEmails.some((email) => email.id === current) ? current : nextEmails[0]?.id ?? "");
  }, []);

  const syncInbox = useCallback(async (manual = false) => {
    if (!inboxConfigured || syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncing(true);
    try {
      const response = await fetch("/api/email/inbox", { cache: "no-store" });
      const result = await response.json().catch(() => ({ error: "The inbox returned an invalid response." }));
      if (!response.ok || !Array.isArray(result.emails)) {
        throw new Error(result.error || "Unable to sync the mailbox inbox.");
      }
      if (result.inboxError) {
        throw new Error(result.inboxError);
      }
      applyMailboxSnapshot(result.emails as EmailWorkspaceItem[]);
      setSyncError(null);
      setLastSync("Just now");
      if (manual) setNotice(`Inbox synced. ${result.emails.length} conversations loaded.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync the mailbox inbox.";
      setSyncError(message);
      if (manual) setNotice(message);
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
    }
  }, [applyMailboxSnapshot, inboxConfigured]);

  useEffect(() => {
    if (!inboxConfigured) return;
    const initialSyncTimer = window.setTimeout(() => void syncInbox(false), 0);
    const timer = window.setInterval(() => void syncInbox(false), 30_000);
    return () => {
      window.clearTimeout(initialSyncTimer);
      window.clearInterval(timer);
    };
  }, [inboxConfigured, syncInbox]);

  const conversations = useMemo(() => buildConversations(emails), [emails]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesFolder = conversation.messages.some((email) => emailMatchesFolder(email, folder, folderStates, starred));
      const matchesCategory = !categoryFilter || conversation.messages.some((email) => categories[email.id] === categoryFilter);
      const searchable = conversation.messages.map((email) => `${email.subject} ${email.contact} ${email.company} ${email.preview}`).join(" ").toLowerCase();
      return matchesFolder && matchesCategory && (!query || searchable.includes(query));
    }).sort((a, b) => new Date(b.latest.timestamp).getTime() - new Date(a.latest.timestamp).getTime());
  }, [categories, categoryFilter, conversations, folder, folderStates, search, starred]);
  const selectedConversation = visible.find((item) => item.messages.some((email) => email.id === selectedId)) ?? visible[0];
  const selected = selectedConversation?.latest;
  const conversation = selectedConversation?.messages ?? [];

  const folderCounts = useMemo(() => {
    const counts: Record<Folder, number> = { inbox: 0, all: 0, drafts: 0, scheduled: 0, sent: 0, starred: 0, archive: 0, trash: 0 };
    const folders = Object.keys(counts) as Folder[];
    for (const item of conversations) {
      for (const targetFolder of folders) {
        if (item.messages.some((email) => emailMatchesFolder(email, targetFolder, folderStates, starred))) {
          counts[targetFolder] += 1;
        }
      }
    }
    return counts;
  }, [conversations, folderStates, starred]);

  async function persistState(id: string, override: Partial<{ category: Category | null; starred: boolean; read: boolean; folder: "inbox" | "archive" | "trash"; followUpAt: string | null }>) {
    const email = emails.find((item) => item.id === id);
    const response = await fetch("/api/email/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageKey: id,
        category: override.category !== undefined ? override.category : categories[id] ?? null,
        starred: override.starred !== undefined ? override.starred : starred.has(id),
        read: override.read !== undefined ? override.read : readMessages.has(id),
        folder: override.folder ?? folderStates[id] ?? "inbox",
        followUpAt: override.followUpAt !== undefined ? override.followUpAt : followUps[id] ?? null,
        contactEmail: email?.direction === "inbound" ? email.contact : undefined,
        threadId: email?.threadId ?? null,
      }),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "Unable to save this change." }));
    if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save this change.");
  }

  function toggleStar(id: string) {
    const nextValue = !starred.has(id);
    setStarred((current) => {
      const next = new Set(current);
      if (nextValue) next.add(id); else next.delete(id);
      return next;
    });
    void persistState(id, { starred: nextValue }).catch((error) => setNotice(error.message));
  }

  function openConversation(item: EmailConversation) {
    const email = item.latest;
    setSelectedId(email.id);
    if (email.direction !== "inbound" || readMessages.has(email.id)) return;
    setReadMessages((current) => new Set(current).add(email.id));
    void persistState(email.id, { read: true }).catch((error) => setNotice(error.message));
  }

  function setCategory(category: Category) {
    if (!selected) return;
    setCategories((current) => ({ ...current, [selected.id]: category }));
    setNotice(`Category changed to ${category}.`);
    void persistState(selected.id, { category }).catch((error) => setNotice(error.message));
  }

  function setFollowUp(value: string) {
    if (!selected) return;
    const date = new Date();
    if (value === "Tomorrow") date.setDate(date.getDate() + 1);
    if (value === "In 3 days") date.setDate(date.getDate() + 3);
    date.setHours(9, 0, 0, 0);
    const followUpAt = date.toISOString();
    setFollowUps((current) => ({ ...current, [selected.id]: followUpAt }));
    setCategories((current) => ({ ...current, [selected.id]: "Needs follow-up" }));
    setNotice(`Follow-up scheduled for ${value}.`);
    void persistState(selected.id, { followUpAt, category: "Needs follow-up" }).catch((error) => setNotice(error.message));
  }

  function moveSelected(folderState: "archive" | "trash") {
    if (!selected) return;
    setFolderStates((current) => ({ ...current, [selected.id]: folderState }));
    setNotice(folderState === "archive" ? "Email archived." : "Email moved to trash.");
    void persistState(selected.id, { folder: folderState }).catch((error) => setNotice(error.message));
  }

  async function toggleAutomation() {
    const enabled = !flowEnabled;
    setFlowEnabled(enabled);
    try {
      const response = await fetch("/api/email/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, steps: initialAutomation.steps }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Unable to save automation." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save automation.");
      setNotice(`Follow-up automation ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setFlowEnabled(!enabled);
      setNotice(error instanceof Error ? error.message : "Unable to save automation.");
    }
  }

  async function saveReply() {
    if (!selected || !draft.trim()) return;
    const trimmedDraft = draft.trim();
    const recipient = selected.contact.trim();
    const replyParent = conversation[conversation.length - 1] ?? selected;

    if (!sendConfigured || !defaultMailboxEmail) {
      setNotice("Add a default mailbox in Settings before sending from the CRM.");
      return;
    }

    if (!recipient.includes("@")) {
      setNotice("This contact does not have a valid email address yet, so the CRM cannot send a live email.");
      return;
    }

    try {
      setSending(true);
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: recipient,
          subject: `Re: ${selected.subject.replace(/^Re:\s*/i, "")}`,
          text: trimmedDraft,
          html: `<p>${trimmedDraft.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character).replace(/\n/g, "<br />")}</p>`,
          attachments: [],
          threadId: threadKeyForEmail(selected),
          inReplyTo: replyParent.messageId || undefined,
          references: replyReferences(replyParent),
        }),
      });

      const result = await response.json().catch(() => ({ ok: false, error: "Unable to send the email." }));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Unable to send the email.");
      }

      const reply: EmailWorkspaceItem = result.email;
      setEmails((current) => [reply, ...current]);
      setDraft("");
      setNotice(`Email sent successfully from ${defaultMailboxEmail}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The CRM could not send this email.");
    } finally {
      setSending(false);
    }
  }

  function openComposer() {
    setComposeError(null);
    setComposeOpen(true);
  }

  async function sendNewEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const to = composeTo.trim();
    const subject = composeSubject.trim();
    const text = composeBody.trim();
    if (!sendConfigured || !defaultMailboxEmail) {
      setComposeError("Add a default mailbox in Settings before sending from the CRM.");
      return;
    }
    if (!to || !subject || !text) {
      setComposeError("Enter a recipient, subject, and message.");
      return;
    }

    try {
      setComposeSending(true);
      setComposeError(null);
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, text, attachments: [] }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Unable to send the email." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to send the email.");

      const sentEmail: EmailWorkspaceItem = result.email;
      setEmails((current) => [sentEmail, ...current]);
      setFolderStates((current) => ({ ...current, [sentEmail.id]: "inbox" }));
      setSelectedId(sentEmail.id);
      setFolder("sent");
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeOpen(false);
      setNotice(`Email sent successfully from ${defaultMailboxEmail}.`);
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "The CRM could not send this email.");
    } finally {
      setComposeSending(false);
    }
  }

  const folderItems: Array<{ id: Folder; label: string; icon: typeof Inbox }> = [
    { id: "inbox", label: "Inbox", icon: Inbox }, { id: "all", label: "All mail", icon: Mail },
    { id: "drafts", label: "Drafts", icon: FileText }, { id: "scheduled", label: "Scheduled", icon: Clock3 },
    { id: "sent", label: "Sent", icon: Send }, { id: "starred", label: "Starred", icon: Star },
    { id: "archive", label: "Archive", icon: Archive }, { id: "trash", label: "Trash", icon: Trash2 },
  ];

  return (
    <div className="email-workspace messenger-workspace -mx-5 -my-7 flex h-[calc(100dvh-3rem)] flex-col overflow-hidden bg-[#f7f8fa] dark:bg-background sm:-mx-7 lg:-mx-10 lg:-my-10">
      <header className="border-b bg-background px-5 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
          <div className="flex items-center gap-2.5"><h1 className="text-2xl font-semibold tracking-[-0.02em]">Email</h1><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">CRM inbox</span></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={openComposer} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background hover:bg-foreground/90"><Plus className="size-4" />Compose</button>
            <button type="button" onClick={() => void syncInbox(true)} disabled={syncing || !inboxConfigured} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing..." : "Sync now"}</button>
            <Link href="/settings" className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"><Settings2 className="size-4" />Mailbox settings</Link>
          </div>
        </div>
        <div className="flex items-center gap-3 pb-4 text-xs">
          <span className={`size-2 rounded-full ${mailboxConfigured ? "bg-emerald-500" : sendConfigured || inboxConfigured ? "bg-amber-400" : "bg-red-400"}`} />
          <span className="font-medium">{mailboxConfigured ? "SMTP and IMAP connected" : sendConfigured || inboxConfigured ? "Mailbox partially configured" : "Mailbox setup required"}</span>
          <span className="text-muted-foreground">{syncError ? `Inbox sync failed: ${syncError}` : inboxConfigured ? `Scanning inbox every 30 seconds · ${lastSync}` : sendConfigured ? "Sending is ready; add IMAP settings for inbox sync" : "Connect SMTP + IMAP to enable live mail"}</span>
          <span className="ml-auto hidden items-center gap-1.5 text-muted-foreground sm:flex"><ShieldCheck className="size-3.5" />{dataMode === "live" ? "Live CRM data" : "Safe demo data"}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-background md:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[190px_340px_minmax(480px,1fr)_310px]">
        <aside className="hidden min-h-0 flex-col border-r bg-muted/10 2xl:flex" aria-label="Email folders">
          <div className="p-3"><button type="button" onClick={openComposer} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-xs font-semibold text-background hover:bg-foreground/90"><Plus className="size-4" />Compose</button></div>
          <nav className="space-y-1 px-2 py-1">
            {folderItems.map((item) => <button key={item.id} type="button" onClick={() => { setFolder(item.id); const first = conversations.find((conversation) => conversation.messages.some((email) => emailMatchesFolder(email, item.id, folderStates, starred) && (!categoryFilter || categories[email.id] === categoryFilter))); setSelectedId(first?.latest.id ?? ""); }} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-xs font-medium ${folder === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon className={`size-4 ${folder === item.id ? "text-primary" : ""}`} /><span className="flex-1 text-left">{item.label}</span><span className="text-[11px]">{folderCounts[item.id]}</span></button>)}
          </nav>
          <div className="mx-4 my-4 h-px bg-border" />
          <div className="px-5"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Automation</p><div className="mt-3 rounded-lg border bg-background p-3"><p className="flex items-center gap-2 text-xs font-semibold"><Workflow className="size-4 text-violet-600" />Follow-up flow</p><p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">Automatically continue conversations that need attention.</p><Link href="/lead-channel/ai-agent?flow=default" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Open builder →</Link></div></div>
        </aside>

        <section className="flex min-h-0 flex-col border-r" aria-label="Email list">
          <div className="border-b p-3"><div className="mb-3 flex items-center justify-between px-1"><div><h2 className="text-base font-semibold">{folderItems.find((item) => item.id === folder)?.label}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{visible.length} conversations{categoryFilter ? ` · ${categoryFilter}` : ""}</p></div><DropdownMenu><DropdownMenuTrigger aria-label="Filter email by category" className={`rounded-md p-2 outline-none hover:bg-muted ${categoryFilter ? "text-primary" : "text-muted-foreground"}`}><Filter className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuLabel>Filter by category</DropdownMenuLabel><DropdownMenuItem onClick={() => setCategoryFilter(null)}>{!categoryFilter ? <Check /> : <span className="size-4" />}All categories</DropdownMenuItem><DropdownMenuSeparator />{categoryOptions.map((category) => <DropdownMenuItem key={category} onClick={() => setCategoryFilter(category)}>{categoryFilter === category ? <Check /> : <span className="size-4" />}{category}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div><label className="flex h-9 items-center gap-2 rounded-md border bg-muted/30 px-2.5 focus-within:border-primary/50"><Search className="size-4 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search mail" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth p-2">
            {visible.length ? visible.map((item) => {
              const email = item.latest;
              const active = item.id === selectedConversation?.id;
              const category = [...item.messages].reverse().map((message) => categories[message.id]).find(Boolean);
              const state = conversationState(item);
              const unread = email.direction === "inbound" && !readMessages.has(email.id);
              return <button key={item.id} type="button" onClick={() => openConversation(item)} className={`relative mb-1.5 flex w-full gap-3 rounded-xl p-3.5 text-left transition-colors ${active ? "bg-blue-50/80 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)] dark:bg-blue-500/10" : unread ? "bg-background hover:bg-blue-50/50 dark:hover:bg-blue-500/5" : "bg-muted/25 hover:bg-muted/60"}`}>{active ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-r bg-blue-500" /> : null}<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(email.contact)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-xs ${unread ? "font-bold text-foreground" : "font-normal text-muted-foreground"}`}>{email.contact}{item.messages.length > 1 ? <span className="ml-1 font-normal text-muted-foreground">({item.messages.length})</span> : null}</p><span className={`shrink-0 text-[11px] ${unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{formatTime(email.timestamp)}</span></div><p className={`mt-1 truncate text-xs ${unread ? "font-bold text-foreground" : "font-normal text-foreground/80"}`}>{email.subject}</p><p className="mt-1.5 line-clamp-2 text-[11px] font-normal leading-4 text-muted-foreground">{email.preview}</p><div className="mt-2 flex flex-wrap items-center gap-1.5"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${state.badge}`}>{state.label}</span>{unread ? <span className="size-2 rounded-full bg-blue-500" aria-label="Unread email" /> : null}{category ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${categoryStyles[category]}`}>{category}</span> : null}</div></div></button>;
            }) : <div className="m-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No email matches this folder.</div>}
          </div>
        </section>

        <main className="hidden min-h-0 flex-col bg-[#fbfbfc] dark:bg-background md:flex" aria-label="Email reader">
          {selected ? <>
            <div className="flex min-h-16 items-center justify-between gap-3 border-b bg-background px-5"><div className="min-w-0"><h2 className="truncate text-base font-semibold">{selected.subject}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.direction === "inbound" ? "From" : "To"} {selected.contact} · {selected.company}</p></div><div className="flex items-center gap-1"><button type="button" title={starred.has(selected.id) ? "Remove star" : "Star email"} onClick={() => toggleStar(selected.id)} className={`rounded-md p-2 hover:bg-muted ${starred.has(selected.id) ? "text-amber-500" : "text-muted-foreground"}`}><Star className="size-4" fill={starred.has(selected.id) ? "currentColor" : "none"} /></button><button type="button" title="Archive" onClick={() => moveSelected("archive")} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Archive className="size-4" /></button><DropdownMenu><DropdownMenuTrigger aria-label="More email actions" className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>Email actions</DropdownMenuLabel><DropdownMenuItem onClick={() => setNotice("Reply composer opened.")}><Reply />Reply</DropdownMenuItem><DropdownMenuItem onClick={() => setNotice("Forward draft created.")}><Forward />Forward</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => moveSelected("trash")}><Trash2 />Move to trash</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-6 py-6"><div className="mx-auto max-w-3xl space-y-6">{conversation.map((message) => <article key={message.id} className={`flex items-start gap-3 ${message.direction === "outbound" ? "flex-row-reverse" : ""}`}><div className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-[#e8eef7] text-[#38536f] dark:bg-muted dark:text-foreground"}`}>{initials(message.direction === "outbound" ? message.from || defaultMailboxEmail || "Me" : message.contact)}</div><div className={`min-w-0 flex-1 ${message.direction === "outbound" ? "max-w-[88%]" : ""}`}><div className={`flex flex-wrap items-baseline justify-between gap-2 ${message.direction === "outbound" ? "flex-row-reverse" : ""}`}><div className={message.direction === "outbound" ? "text-right" : ""}><p className="text-sm font-semibold">{message.direction === "outbound" ? message.from || defaultMailboxEmail || "You" : message.contact}</p><p className="mt-0.5 text-xs text-muted-foreground">{message.direction === "outbound" ? `To ${message.contact}` : message.company}</p></div><time className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</time></div><div className={`mt-3 overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${message.direction === "outbound" ? "border-primary/20 bg-primary/5 p-5" : message.html ? "bg-background p-0" : "bg-background p-5"}`}><EmailBody email={message} /></div></div></article>)}</div></div>
            <div className="border-t bg-background p-4"><div className="mx-auto max-w-3xl"><div className="mb-2 flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-md border bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><Languages className="size-4" />Auto-translate<Toggle checked={translationOn} onChange={() => setTranslationOn((value) => !value)} label="Toggle email translation" /></div><div className="flex items-center gap-2 rounded-md border bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Bot className="size-4" />AI writing<Toggle checked={aiReplyOn} onChange={() => setAiReplyOn((value) => !value)} label="Toggle AI writing" /></div>{!aiConfigured ? <span className="text-[11px] text-amber-700">AI provider not configured — using safe suggestions</span> : null}</div>{aiReplyOn ? <div className="mb-2 flex gap-2 overflow-x-auto"><span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600"><Sparkles className="size-3.5" />Suggestions</span>{["Send pricing + MOQ", "Confirm shipping details", "Schedule a follow-up"].map((item) => <button key={item} type="button" onClick={() => setDraft(item === "Send pricing + MOQ" ? `Hi ${selected.contact.split(" ")[0]},\n\nThanks for your message. I’ll send our current wholesale pricing and minimum order quantities for your review.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : item === "Confirm shipping details" ? `Hi ${selected.contact.split(" ")[0]},\n\nWe can prepare a shipping quote. Could you confirm the delivery postcode and expected quantity?\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : `Hi ${selected.contact.split(" ")[0]},\n\nI’ll follow up with you shortly with the latest availability and next steps.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}`)} className="shrink-0 rounded-full border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">{item}</button>)}</div> : null}<div className="mb-3 flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground"><span>From</span><span className="font-medium text-foreground">{defaultMailboxEmail || "No mailbox selected"}</span></div><div className="rounded-xl border bg-background focus-within:border-primary/50"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Write a reply to ${selected.contact}…`} className="min-h-24 w-full resize-none bg-transparent p-3.5 text-sm leading-6 outline-none" /><div className="flex items-center justify-between border-t px-2 py-2"><div className="flex gap-1"><button type="button" disabled title="Attachments require mailbox media setup" className="cursor-not-allowed rounded-md p-2 text-muted-foreground opacity-40"><Paperclip className="size-4" /></button><button type="button" title="Add emoji" onClick={() => setDraft((value) => `${value}${value ? " " : ""}😊`)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Smile className="size-4" /></button><button type="button" title="Write with AI" onClick={() => setDraft((value) => value || `Hi ${selected.contact.split(" ")[0]},\n\nThanks for your email. I’d be happy to help.\n\nBest,\nFilazoo`)} className="rounded-md p-2 text-violet-600 hover:bg-violet-50"><WandSparkles className="size-4" /></button></div><button type="button" onClick={saveReply} disabled={!draft.trim() || sending} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-40"><Send className="size-4" />{sending ? "Sending..." : "Send email"}</button></div></div>{notice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}</div></div>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select an email to read it.</div>}
        </main>

        {selected ? <aside className="hidden min-h-0 flex-col border-l bg-background 2xl:flex" aria-label="Email follow-up details">
          <div className="flex h-16 items-center justify-between border-b px-5"><h2 className="text-sm font-semibold">Follow-up details</h2><Tag className="size-4 text-muted-foreground" /></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b p-5"><div className="flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f]">{initials(selected.contact)}</div><div><p className="text-sm font-semibold">{selected.contact}</p><p className="mt-0.5 text-xs text-muted-foreground">{selected.company}</p></div></div><div className="mt-4 grid grid-cols-2 gap-2"><Link href="/companies" className="flex h-9 items-center justify-center gap-2 rounded-md border text-xs font-semibold hover:bg-muted"><Building2 className="size-4" />CRM profile</Link><button type="button" onClick={() => setNotice("Contact owner is now assigned.")} className="flex h-9 items-center justify-center gap-2 rounded-md border text-xs font-semibold hover:bg-muted"><UserRound className="size-4" />Assign</button></div></div>
            <div className="border-b p-5"><h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Category</h3><div className="mt-3 space-y-2">{categoryOptions.map((category) => <button key={category} type="button" onClick={() => setCategory(category)} className={`flex h-9 w-full items-center gap-2 rounded-md border px-3 text-left text-xs font-medium transition-colors ${categories[selected.id] === category ? categoryStyles[category] : "bg-background hover:bg-muted"}`}><span className={`size-2 rounded-full ${category === "Big order" ? "bg-amber-500" : category === "Interested" ? "bg-emerald-500" : category === "Needs follow-up" ? "bg-blue-500" : category === "Waiting on customer" ? "bg-violet-500" : "bg-slate-400"}`} /><span className="flex-1">{category}</span>{categories[selected.id] === category ? <Check className="size-3.5" /> : null}</button>)}</div></div>
            <div className="border-b p-5"><h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><CalendarClock className="size-4" />Next follow-up</h3><p className="mt-3 text-sm font-semibold">{followUps[selected.id] ? formatTime(followUps[selected.id]) : "Not scheduled"}</p><div className="mt-3 grid grid-cols-3 gap-2">{["Today", "Tomorrow", "In 3 days"].map((value) => <button key={value} type="button" onClick={() => setFollowUp(value)} className="rounded-md border px-2 py-2 text-[11px] font-medium hover:bg-muted">{value}</button>)}</div></div>
            <div className="border-b p-5"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><Workflow className="size-4" />Automation flow</h3><Toggle checked={flowEnabled} onChange={() => void toggleAutomation()} label="Toggle follow-up automation" /></div><div className={`mt-3 rounded-lg border p-3 ${flowEnabled ? "bg-emerald-50/60 dark:bg-emerald-500/5" : "bg-muted/20"}`}><p className="text-xs font-semibold">3-step follow-up</p><div className="mt-3 space-y-3 text-[11px]"><p className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-background font-semibold">1</span>Wait 2 days</p><p className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-background font-semibold">2</span>Send helpful reminder</p><p className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-background font-semibold">3</span>Create CRM task</p></div><Link href="/lead-channel/ai-agent?flow=default" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border bg-background py-2 text-xs font-semibold hover:bg-muted"><Workflow className="size-4" />Edit automation</Link></div></div>
            <div className="p-5"><h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">AI insight</h3><div className="mt-3 rounded-lg border border-violet-200/70 bg-violet-50/60 p-4 dark:bg-violet-500/5"><p className="flex items-center gap-2 text-xs font-semibold text-violet-700"><Zap className="size-4" />Buying signal detected</p><p className="mt-2 text-xs leading-5 text-muted-foreground">The contact asked about pricing, MOQ, or delivery. Follow up within one business day.</p></div></div>
          </div>
        </aside> : null}
      </div>
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="w-[min(680px,calc(100%-2rem))] max-w-none gap-0 overflow-hidden p-0">
          <form onSubmit={sendNewEmail}>
            <DialogHeader className="border-b px-5 py-4">
              <DialogTitle>New email</DialogTitle>
              <DialogDescription>Send a new conversation through {defaultMailboxEmail || "your default mailbox"}.</DialogDescription>
            </DialogHeader>
            <div className="space-y-0 px-5 py-2">
              <label className="grid grid-cols-[64px_1fr] items-center border-b py-2 text-sm"><span className="text-muted-foreground">From</span><span className="truncate font-medium">{defaultMailboxEmail || "No mailbox selected"}</span></label>
              <label className="grid grid-cols-[64px_1fr] items-center border-b py-2 text-sm"><span className="text-muted-foreground">To</span><input type="email" required autoFocus value={composeTo} onChange={(event) => setComposeTo(event.target.value)} placeholder="customer@example.com" className="min-w-0 bg-transparent py-1 outline-none placeholder:text-muted-foreground/60" /></label>
              <label className="grid grid-cols-[64px_1fr] items-center border-b py-2 text-sm"><span className="text-muted-foreground">Subject</span><input required value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)} placeholder="Email subject" className="min-w-0 bg-transparent py-1 outline-none placeholder:text-muted-foreground/60" /></label>
              <textarea required value={composeBody} onChange={(event) => setComposeBody(event.target.value)} placeholder="Write your message…" className="min-h-64 w-full resize-y bg-transparent py-4 text-sm leading-6 outline-none placeholder:text-muted-foreground/60" />
              {composeError ? <p role="alert" className="pb-3 text-xs font-medium text-red-600 dark:text-red-400">{composeError}</p> : null}
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-3">
              <button type="button" onClick={() => setComposeOpen(false)} disabled={composeSending} className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-xs font-semibold hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={composeSending || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-40"><Send className="size-4" />{composeSending ? "Sending…" : "Send email"}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
