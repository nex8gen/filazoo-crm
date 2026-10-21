"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, Bot, Building2, CalendarClock, Check,
  Clock3, FileText, Filter, Forward, Inbox, Languages, Mail, MoreHorizontal,
  LoaderCircle, Library, Paperclip, Plus, RefreshCw, Reply, Search, Send, Settings2, ShieldCheck,
  Smile, Sparkles, Star, Tag, Trash2, UserRound, WandSparkles, Workflow, X, Zap,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AssignedOwner } from "@/components/assigned-owner";
import { groupEmailConversations, replyReferences, threadKeyForEmail } from "@/lib/email-threading";
import { buildCatalogPdf } from "@/lib/catalog-pdf";
import type { Catalog, Product } from "@/lib/types";

export type EmailWorkspaceItem = {
  id: string;
  from?: string;
  contactName?: string;
  source?: "mailbox" | "shopify" | "crm";
  direction: "inbound" | "outbound";
  status: string;
  subject: string;
  contact: string;
  company: string;
  companyId?: string | null;
  ownerId?: string | null;
  ownerName?: string;
  ownerInitials?: string;
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
type ComposerAttachment = { id: string; filename: string; content: string; contentType: string; size: number };

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

const allowedAttachmentTypes = new Set([
  "application/pdf", "text/csv", "text/plain", "image/jpeg", "image/png", "image/webp", "image/gif",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  }
  return btoa(binary);
}

async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  if (file.size > 7_500_000) throw new Error(`${file.name} is larger than the 7.5 MB attachment limit.`);
  if (!allowedAttachmentTypes.has(file.type)) throw new Error(`${file.name} is not a supported photo, PDF, CSV, document, or spreadsheet.`);
  return {
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    filename: file.name,
    content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    contentType: file.type,
    size: file.size,
  };
}

function AttachmentChips({ attachments, onRemove }: { attachments: ComposerAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return <div className="flex flex-wrap gap-2 px-3 pb-3">{attachments.map((attachment) => <span key={attachment.id} className="inline-flex max-w-full items-center gap-2 rounded-full border bg-muted/40 py-1 pl-2.5 pr-1.5 text-[11px]"><FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="max-w-52 truncate">{attachment.filename}</span><span className="text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} KB</span><button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.filename}`} className="rounded-full p-0.5 hover:bg-muted"><X className="size-3" /></button></span>)}</div>;
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
  products,
  catalogs,
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
  products: Product[];
  catalogs: Catalog[];
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
  const [replyAttachments, setReplyAttachments] = useState<ComposerAttachment[]>([]);
  const [composeAttachments, setComposeAttachments] = useState<ComposerAttachment[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogTarget, setCatalogTarget] = useState<"reply" | "compose">("reply");
  const [catalogTitle, setCatalogTitle] = useState("Filazoo product catalog");
  const [selectedCatalogSkus, setSelectedCatalogSkus] = useState<Set<string>>(new Set());
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiDraftSource, setAiDraftSource] = useState("");
  const [aiWriting, setAiWriting] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState<Set<string>>(new Set());
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
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
  const replyFileInput = useRef<HTMLInputElement>(null);
  const composeFileInput = useRef<HTMLInputElement>(null);

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
      const response = await fetch(manual ? "/api/email/inbox?scope=history" : "/api/email/inbox", { cache: "no-store" });
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
      if (manual) setNotice(`History imported. ${result.emails.length} messages and Shopify enquiries are now available.`);
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
      const searchable = conversation.messages.map((email) => `${email.subject} ${email.contactName || ""} ${email.contact} ${email.company} ${email.preview}`).join(" ").toLowerCase();
      return matchesFolder && matchesCategory && (!query || searchable.includes(query));
    }).sort((a, b) => new Date(b.latest.timestamp).getTime() - new Date(a.latest.timestamp).getTime());
  }, [categories, categoryFilter, conversations, folder, folderStates, search, starred]);
  const selectedConversation = visible.find((item) => item.messages.some((email) => email.id === selectedId)) ?? visible[0];
  const selected = selectedConversation?.latest;
  const conversation = useMemo(() => selectedConversation?.messages ?? [], [selectedConversation]);

  useEffect(() => {
    if (!translationOn) return;
    const pending = conversation.filter((message) => message.direction === "inbound" && message.body.trim() && !translations[message.id] && !translationErrors[message.id] && !translating.has(message.id));
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      setTranslating((current) => new Set([...current, ...pending.map((message) => message.id)]));
      for (const message of pending) {
        void fetch("/api/email/assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "translate", text: message.body }),
        }).then(async (response) => {
          const result = await response.json().catch(() => ({ ok: false, error: "The translation service returned an invalid response." }));
          if (!response.ok || !result.output) throw new Error(result.error || "Unable to translate this email.");
          setTranslations((current) => ({ ...current, [message.id]: result.output }));
        }).catch((error) => {
          setTranslationErrors((current) => ({
            ...current,
            [message.id]: error instanceof Error ? error.message : "Unable to translate this email.",
          }));
        }).finally(() => setTranslating((current) => {
          const next = new Set(current);
          next.delete(message.id);
          return next;
        }));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [conversation, translating, translationErrors, translationOn, translations]);

  useEffect(() => {
    if (!aiReplyOn || !aiConfigured || draft.trim().length < 2) {
      return;
    }
    const controller = new AbortController();
    const source = draft.trim();
    const timer = window.setTimeout(() => {
      setAiWriting(true);
      void fetch("/api/email/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rewrite", text: source, context: selected?.body || "", recipient: selected?.contact || "Customer" }),
        signal: controller.signal,
      }).then(async (response) => {
        const result = await response.json().catch(() => ({ ok: false, error: "Unable to write this email." }));
        if (!response.ok || !result.output) throw new Error(result.error || "Unable to write this email.");
        setAiDraft(result.output);
        setAiDraftSource(source);
      }).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setNotice(error instanceof Error ? error.message : "Unable to write this email.");
      }).finally(() => setAiWriting(false));
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [aiConfigured, aiReplyOn, draft, selected?.body, selected?.contact]);

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

  async function addFiles(files: FileList | null, target: "reply" | "compose") {
    if (!files?.length) return;
    try {
      setAttachmentBusy(true);
      const existing = target === "reply" ? replyAttachments : composeAttachments;
      if (existing.length + files.length > 10) throw new Error("You can attach up to 10 files to one email.");
      const next = await Promise.all(Array.from(files).map(fileToAttachment));
      if (target === "reply") setReplyAttachments((current) => [...current, ...next]);
      else setComposeAttachments((current) => [...current, ...next]);
      setNotice(`${next.length} attachment${next.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to attach this file.";
      if (target === "compose") setComposeError(message);
      else setNotice(message);
    } finally {
      setAttachmentBusy(false);
    }
  }

  function openCatalogPicker(target: "reply" | "compose") {
    setCatalogTarget(target);
    setCatalogTitle(target === "reply" && selected?.company && selected.company !== "Direct email" ? `${selected.company} product catalog` : "Filazoo product catalog");
    setSelectedCatalogSkus(new Set());
    setCatalogOpen(true);
  }

  function attachCatalog(productSkus: string[], title: string) {
    const currentAttachments = catalogTarget === "reply" ? replyAttachments : composeAttachments;
    if (currentAttachments.length >= 10) {
      setNotice("You can attach up to 10 files to one email.");
      return;
    }
    const selectedProducts = productSkus.length ? products.filter((product) => productSkus.includes(product.sku)) : products;
    if (!selectedProducts.length) {
      setNotice("This catalog does not contain any available products.");
      return;
    }
    try {
      const customer = catalogTarget === "reply" ? selected?.company : composeTo;
      const bytes = buildCatalogPdf(selectedProducts, { title, customer: customer || undefined });
      if (bytes.byteLength > 7_500_000) throw new Error("Catalog is too large to attach.");
      const attachment: ComposerAttachment = {
        id: `catalog-${crypto.randomUUID()}`,
        filename: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "filazoo-catalog"}.pdf`,
        content: bytesToBase64(bytes),
        contentType: "application/pdf",
        size: bytes.byteLength,
      };
      if (catalogTarget === "reply") setReplyAttachments((current) => [...current, attachment]);
      else setComposeAttachments((current) => [...current, attachment]);
      setCatalogOpen(false);
      setNotice(`${attachment.filename} is ready to send.`);
    } catch {
      setNotice("The catalog PDF could not be generated.");
    }
  }

  async function saveReply() {
    if (!selected || !draft.trim()) return;
    const trimmedDraft = aiReplyOn && aiDraft && aiDraftSource === draft.trim() ? aiDraft.trim() : draft.trim();
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
          attachments: replyAttachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
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
      setAiDraft("");
      setAiDraftSource("");
      setReplyAttachments([]);
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
        body: JSON.stringify({ to, subject, text, attachments: composeAttachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })) }),
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
      setComposeAttachments([]);
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
            <button type="button" onClick={() => void syncInbox(true)} disabled={syncing || !inboxConfigured} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Importing..." : "Import history"}</button>
            <Link href="/settings" className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-xs font-medium hover:bg-muted"><Settings2 className="size-4" />Mailbox settings</Link>
          </div>
        </div>
        <div className="flex items-center gap-3 pb-4 text-xs">
          <span className={`size-2 rounded-full ${mailboxConfigured ? "bg-emerald-500" : sendConfigured || inboxConfigured ? "bg-amber-400" : "bg-red-400"}`} />
          <span className="font-medium">{mailboxConfigured ? "SMTP and IMAP connected" : sendConfigured || inboxConfigured ? "Mailbox partially configured" : "Mailbox setup required"}</span>
          <span className="text-muted-foreground">{syncError ? `Inbox sync failed: ${syncError}` : inboxConfigured ? `Scanning inbox every 30 seconds · ${lastSync}` : sendConfigured ? "Sending is ready; add IMAP settings for inbox sync" : "Connect SMTP + IMAP to enable live mail"}</span>
          <span className="ml-auto hidden items-center gap-1.5 text-muted-foreground sm:flex"><ShieldCheck className="size-3.5" />{dataMode === "live" ? "Live CRM data" : "CRM connection unavailable"}</span>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-blue-200/70 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
          <span className="font-semibold">Unified customer inbox</span>
          <span>Shopify form enquiries appear automatically.</span>
          <span className="text-blue-700/70 dark:text-blue-200/70">Import history collects up to 250 past email replies from the connected mailbox.</span>
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
              const displayContact = email.contactName || email.contact;
              return <button key={item.id} type="button" onClick={() => openConversation(item)} className={`relative mb-1.5 flex w-full gap-3 rounded-xl p-3.5 text-left transition-colors ${active ? "bg-blue-50/80 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)] dark:bg-blue-500/10" : unread ? "bg-background hover:bg-blue-50/50 dark:hover:bg-blue-500/5" : "bg-muted/25 hover:bg-muted/60"}`}>{active ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-r bg-blue-500" /> : null}<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f] dark:bg-muted dark:text-foreground">{initials(displayContact)}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className={`min-w-0 flex-1 truncate text-xs ${unread ? "font-bold text-foreground" : "font-normal text-muted-foreground"}`}>{displayContact}{item.messages.length > 1 ? <span className="ml-1 font-normal text-muted-foreground">({item.messages.length})</span> : null}</p><span className={`shrink-0 text-[11px] ${unread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{formatTime(email.timestamp)}</span></div><p className={`mt-1 truncate text-xs ${unread ? "font-bold text-foreground" : "font-normal text-foreground/80"}`}>{email.subject}</p><p className="mt-1.5 line-clamp-2 text-[11px] font-normal leading-4 text-muted-foreground">{email.preview}</p><div className="mt-2 flex flex-wrap items-center gap-1.5"><AssignedOwner name={email.ownerName || "Unassigned"} initials={email.ownerInitials || "—"} assigned={Boolean(email.ownerId)} compact /><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${state.badge}`}>{state.label}</span>{email.source === "shopify" ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">Shopify form</span> : email.source === "mailbox" ? <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Email reply</span> : null}{unread ? <span className="size-2 rounded-full bg-blue-500" aria-label="Unread email" /> : null}{category ? <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${categoryStyles[category]}`}>{category}</span> : null}</div></div></button>;
            }) : <div className="m-2 rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">No email matches this folder.</div>}
          </div>
        </section>

        <main className="hidden min-h-0 flex-col bg-[#fbfbfc] dark:bg-background md:flex" aria-label="Email reader">
          {selected ? <>
            <div className="flex min-h-16 items-center justify-between gap-3 border-b bg-background px-5"><div className="min-w-0"><h2 className="truncate text-base font-semibold">{selected.subject}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.direction === "inbound" ? "From" : "To"} {selected.contact} · {selected.company}</p></div><div className="flex items-center gap-3"><AssignedOwner name={selected.ownerName || "Unassigned"} initials={selected.ownerInitials || "—"} assigned={Boolean(selected.ownerId)} compact className="hidden lg:inline-flex" /><div className="flex items-center gap-1"><button type="button" title={starred.has(selected.id) ? "Remove star" : "Star email"} onClick={() => toggleStar(selected.id)} className={`rounded-md p-2 hover:bg-muted ${starred.has(selected.id) ? "text-amber-500" : "text-muted-foreground"}`}><Star className="size-4" fill={starred.has(selected.id) ? "currentColor" : "none"} /></button><button type="button" title="Archive" onClick={() => moveSelected("archive")} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Archive className="size-4" /></button><DropdownMenu><DropdownMenuTrigger aria-label="More email actions" className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuLabel>Email actions</DropdownMenuLabel><DropdownMenuItem onClick={() => setNotice("Reply composer opened.")}><Reply />Reply</DropdownMenuItem><DropdownMenuItem onClick={() => setNotice("Forward draft created.")}><Forward />Forward</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => moveSelected("trash")}><Trash2 />Move to trash</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div></div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-6 py-6"><div className="mx-auto max-w-3xl space-y-6">{conversation.map((message) => <article key={message.id} className={`flex items-start gap-3 ${message.direction === "outbound" ? "flex-row-reverse" : ""}`}><div className={`flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${message.direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-[#e8eef7] text-[#38536f] dark:bg-muted dark:text-foreground"}`}>{initials(message.direction === "outbound" ? message.from || defaultMailboxEmail || "Me" : message.contact)}</div><div className={`min-w-0 flex-1 ${message.direction === "outbound" ? "max-w-[88%]" : ""}`}><div className={`flex flex-wrap items-baseline justify-between gap-2 ${message.direction === "outbound" ? "flex-row-reverse" : ""}`}><div className={message.direction === "outbound" ? "text-right" : ""}><p className="text-sm font-semibold">{message.direction === "outbound" ? message.from || defaultMailboxEmail || "You" : message.contact}</p><p className="mt-0.5 text-xs text-muted-foreground">{message.direction === "outbound" ? `To ${message.contact}` : message.company}</p></div><time className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</time></div><div className={`mt-3 overflow-hidden rounded-xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)] ${message.direction === "outbound" ? "border-primary/20 bg-primary/5 p-5" : message.html ? "bg-background p-0" : "bg-background p-5"}`}><EmailBody email={message} /></div>{translationOn && message.direction === "inbound" ? <div className="mt-2 rounded-xl border border-violet-200/70 bg-violet-50/60 p-4 dark:bg-violet-500/5"><p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-700 dark:text-violet-300"><Languages className="size-3.5" />Chinese translation</p>{translations[message.id] ? <p className="whitespace-pre-wrap text-sm leading-6">{translations[message.id]}</p> : translating.has(message.id) ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Translating customer email...</p> : translationErrors[message.id] ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-700 dark:text-amber-300"><span>{translationErrors[message.id]}</span><button type="button" onClick={() => setTranslationErrors((current) => { const next = { ...current }; delete next[message.id]; return next; })} className="rounded-md border border-amber-300/70 px-2 py-1 font-semibold hover:bg-amber-100/70 dark:hover:bg-amber-500/10">Retry</button></div> : <p className="text-xs text-muted-foreground">Waiting for the free translator...</p>}</div> : null}</div></article>)}</div></div>
            <div className="border-t bg-background p-4"><div className="mx-auto max-w-3xl"><div className="mb-2 flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-md border bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><Languages className="size-4" />Auto-translate<Toggle checked={translationOn} onChange={() => setTranslationOn((value) => !value)} label="Toggle email translation" /></div><div className="flex items-center gap-2 rounded-md border bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Bot className="size-4" />AI writing<Toggle checked={aiReplyOn} onChange={() => setAiReplyOn((value) => !value)} label="Toggle AI writing" /></div>{!aiConfigured ? <span className="text-[11px] text-amber-700">AI provider not configured — suggestions remain available</span> : null}</div>{aiReplyOn ? <div className="mb-2 flex gap-2 overflow-x-auto"><span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600"><Sparkles className="size-3.5" />Suggestions</span>{["Send pricing + MOQ", "Confirm shipping details", "Schedule a follow-up"].map((item) => <button key={item} type="button" onClick={() => setDraft(item === "Send pricing + MOQ" ? `Hi ${selected.contact.split(" ")[0]},\n\nThanks for your message. I’ll send our current wholesale pricing and minimum order quantities for your review.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : item === "Confirm shipping details" ? `Hi ${selected.contact.split(" ")[0]},\n\nWe can prepare a shipping quote. Could you confirm the delivery postcode and expected quantity?\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : `Hi ${selected.contact.split(" ")[0]},\n\nI’ll follow up with you shortly with the latest availability and next steps.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}`)} className="shrink-0 rounded-full border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground">{item}</button>)}</div> : null}<div className="mb-3 flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground"><span>From</span><span className="font-medium text-foreground">{defaultMailboxEmail || "No mailbox selected"}</span></div><div className="overflow-hidden rounded-xl border bg-background focus-within:border-primary/50"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Write in Chinese or English to reply to ${selected.contact}…`} className="min-h-24 w-full resize-none bg-transparent p-3.5 text-sm leading-6 outline-none" />{aiReplyOn && (aiWriting || aiDraft) ? <div className="border-t border-violet-200/70 bg-violet-50/60 p-3 dark:bg-violet-500/5"><p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold text-violet-700 dark:text-violet-300">{aiWriting ? <LoaderCircle className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}Professional English preview</p>{aiDraft ? <p className="whitespace-pre-wrap text-sm leading-6">{aiDraft}</p> : <p className="text-xs text-muted-foreground">Rewriting as you type…</p>}<p className="mt-2 text-[10px] text-muted-foreground">The current preview will be sent automatically. Edit your original draft to update it.</p></div> : null}<AttachmentChips attachments={replyAttachments} onRemove={(id) => setReplyAttachments((current) => current.filter((item) => item.id !== id))} /><div className="flex items-center justify-between border-t px-2 py-2"><div className="flex gap-1"><input ref={replyFileInput} type="file" multiple accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(event) => { void addFiles(event.target.files, "reply"); event.target.value = ""; }} /><button type="button" disabled={attachmentBusy} title="Attach files" onClick={() => replyFileInput.current?.click()} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><Paperclip className="size-4" /></button><button type="button" title="Attach product catalog" onClick={() => openCatalogPicker("reply")} className="rounded-md p-2 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10"><Library className="size-4" /></button><button type="button" title="Add emoji" onClick={() => setDraft((value) => `${value}${value ? " " : ""}😊`)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Smile className="size-4" /></button><button type="button" title="Start an AI-written reply" onClick={() => setDraft((value) => value || `你好，${selected.contact.split(" ")[0]}，\n\n感谢您的来信。我们很乐意为您提供帮助。\n\n此致\nFilazoo`)} className="rounded-md p-2 text-violet-600 hover:bg-violet-50"><WandSparkles className="size-4" /></button></div><button type="button" onClick={saveReply} disabled={!draft.trim() || sending || aiWriting} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-40"><Send className="size-4" />{sending ? "Sending..." : aiWriting ? "Writing..." : "Send email"}</button></div></div>{notice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}</div></div>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Select an email to read it.</div>}
        </main>

        {selected ? <aside className="hidden min-h-0 flex-col border-l bg-background 2xl:flex" aria-label="Email follow-up details">
          <div className="flex h-16 items-center justify-between border-b px-5"><h2 className="text-sm font-semibold">Follow-up details</h2><Tag className="size-4 text-muted-foreground" /></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b p-5"><div className="flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-full bg-[#e8eef7] text-xs font-semibold text-[#38536f]">{initials(selected.contact)}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{selected.contact}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{selected.company}</p></div></div><div className="mt-4 rounded-lg border bg-muted/20 p-3"><AssignedOwner name={selected.ownerName || "Unassigned"} initials={selected.ownerInitials || "—"} assigned={Boolean(selected.ownerId)} label="Assigned BD Manager" /></div><div className="mt-3 grid grid-cols-2 gap-2"><Link href={selected.companyId ? `/companies/${selected.companyId}` : "/companies"} className="flex h-9 items-center justify-center gap-2 rounded-md border text-xs font-semibold hover:bg-muted"><Building2 className="size-4" />CRM profile</Link><Link href="/pipeline" className="flex h-9 items-center justify-center gap-2 rounded-md border text-xs font-semibold hover:bg-muted"><UserRound className="size-4" />Manage owner</Link></div></div>
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
              <AttachmentChips attachments={composeAttachments} onRemove={(id) => setComposeAttachments((current) => current.filter((item) => item.id !== id))} />
              <div className="mb-2 flex items-center gap-2 border-t pt-2"><input ref={composeFileInput} type="file" multiple accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(event) => { void addFiles(event.target.files, "compose"); event.target.value = ""; }} /><button type="button" onClick={() => composeFileInput.current?.click()} disabled={attachmentBusy} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40"><Paperclip className="size-3.5" />Attach file</button><button type="button" onClick={() => openCatalogPicker("compose")} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300"><Library className="size-3.5" />Add catalog PDF</button></div>
              {composeError ? <p role="alert" className="pb-3 text-xs font-medium text-red-600 dark:text-red-400">{composeError}</p> : null}
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-3">
              <button type="button" onClick={() => setComposeOpen(false)} disabled={composeSending} className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-xs font-semibold hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={composeSending || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-40"><Send className="size-4" />{composeSending ? "Sending…" : "Send email"}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="w-[min(760px,calc(100%-2rem))] max-w-none gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Attach a product catalog</DialogTitle>
            <DialogDescription>Use a saved company selection, attach the complete catalog, or build a focused PDF for this email.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-4">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ready-made catalogs</h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => attachCatalog([], selected?.company ? `${selected.company} complete catalog` : "Filazoo complete catalog")} className="rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-muted/30"><span className="flex items-center gap-2 text-sm font-semibold"><Library className="size-4 text-sky-600" />Complete Filazoo catalog</span><span className="mt-1 block text-xs text-muted-foreground">All {products.length} available catalog items</span></button>
                {catalogs.map((catalog) => <button key={catalog.id} type="button" onClick={() => attachCatalog(catalog.productSkus, `${catalog.company} catalog v${catalog.version}`)} className="rounded-lg border p-3 text-left hover:border-primary/40 hover:bg-muted/30"><span className="block truncate text-sm font-semibold">{catalog.company} · v{catalog.version}</span><span className="mt-1 block text-xs text-muted-foreground">{catalog.productSkus.length} products · {catalog.currency}</span></button>)}
              </div>
            </section>
            <section>
              <div className="flex items-end justify-between gap-3"><label className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Custom catalog title<input value={catalogTitle} onChange={(event) => setCatalogTitle(event.target.value)} className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-primary/50" /></label><span className="pb-2 text-xs text-muted-foreground">{selectedCatalogSkus.size} selected</span></div>
              <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {products.map((product) => { const checked = selectedCatalogSkus.has(product.sku); return <label key={product.sku} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 ${checked ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted"}`}><input type="checkbox" checked={checked} onChange={() => setSelectedCatalogSkus((current) => { const next = new Set(current); if (next.has(product.sku)) next.delete(product.sku); else next.add(product.sku); return next; })} className="mt-0.5 accent-current" /><span className="min-w-0"><span className="block truncate text-xs font-semibold">{product.name}</span><span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{product.sku} · {product.price}</span></span></label>; })}
              </div>
            </section>
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-3"><button type="button" onClick={() => setCatalogOpen(false)} className="inline-flex h-9 items-center rounded-md border px-4 text-xs font-semibold hover:bg-muted">Cancel</button><button type="button" disabled={!selectedCatalogSkus.size || !catalogTitle.trim()} onClick={() => attachCatalog([...selectedCatalogSkus], catalogTitle.trim())} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-40"><FileText className="size-4" />Generate & attach PDF</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
