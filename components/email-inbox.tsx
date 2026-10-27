"use client";
import { usePreferences } from "@/components/preferences-provider";
import { withEmailSignature } from "@/lib/user-preferences";

import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";
import { ColumnResizeHandle } from "@/components/column-resize-handle";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import Link from "next/link";
import dynamic from "next/dynamic";
import type { InvoiceEmailContext } from "@/components/invoice-create-dialog";
import { mergeInvoiceAttachment } from "@/lib/invoice-pdf-meta";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowLeft, ChevronLeft, ChevronRight, PanelRight, MailOpen, CalendarClock, Check,
  Clock3, FileText, Filter, Forward, Inbox, Languages, Mail, MoreHorizontal,
  LoaderCircle, Library, Paperclip, Plus, RefreshCw, Reply, Search, Send,
  Smile, Star, Trash2, Workflow, X, ReceiptText,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { InboxCalculator } from "@/components/inbox-calculator";
import { EmailCatalogDialog } from "@/components/email-catalog-dialog";
import { EmailMessageList } from "@/components/email-message-list";
import { EmailAiSummary } from "@/components/email-ai-summary";
import { EmailAiTypewriter } from "@/components/email-ai-typewriter";
import "./email-workspace.css";
import "./email-ai-writing.css";
import { AssignedOwner } from "@/components/assigned-owner";
import { ContactSummary } from "@/components/contact-summary";
import { groupEmailConversations, replyReferences, replyTarget, threadKeyForEmail } from "@/lib/email-threading";
import { buildCatalogPdfWithImages } from "@/lib/catalog-pdf";
import { splitQuotedEmail } from "@/lib/email-content";
import { prepareEmailTranslation } from "@/lib/email-translation-document";
import { requestEmailTranslation } from "@/lib/email-translation-client";
import type { Catalog, Product } from "@/lib/types";
import type { CustomerProfileContext } from "@/lib/ai/email-rewrite";
import type { EmailSummary } from "@/lib/ai/email-summary";
import { emailReplyPlanSchema } from "@/lib/ai/email-reply";
import { prepareReplyInvoice } from "@/lib/email-reply-client";
import { filterCompanyEmails, type CompanyEmailScope } from "@/lib/company-email";

const InvoiceCreateDialog = dynamic(()=>import("@/components/invoice-create-dialog").then(module=>module.InvoiceCreateDialog));

export type EmailWorkspaceItem = {
  id: string;
  from?: string;
  replyTo?: string | null;
  uid?: number;
  uidValidity?: number;
  mailboxKey?: string;
  bodyLoaded?: boolean;
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
  ownerAvatarUrl?: string;
  customerProfile?: CustomerProfileContext;
  preview: string;
  body: string;
  html?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  attachments?: Array<{ filename: string; contentType: string; size: number; url?: string }>;
  timestamp: string;
  step?: string;
  demo?: boolean;
  category?: Category | null;
  starred?: boolean;
  read?: boolean;
  folder?: "inbox" | "archive" | "trash";
  followUpAt?: string | null;
};

type Folder = "inbox" | "unread" | "followup" | "all" | "drafts" | "scheduled" | "sent" | "starred" | "archive" | "trash";
type SourceFilter = "all" | "shopify" | "replies" | "unread";
type Category = "Needs follow-up" | "Waiting on customer" | "Interested" | "Big order" | "No action";
type Automation = { enabled: boolean; queueCount: number; steps: Array<{ id: string; title: string; delay: string; action: string; enabled: boolean }> };
type ComposerAttachment = { id: string; filename: string; content: string; contentType: string; size: number };
type MessageState = { category: Category | null; starred: boolean; read: boolean; folder: "inbox" | "archive" | "trash"; followUpAt: string | null };

function messageState(email: EmailWorkspaceItem): MessageState {
  return { category: email.category ?? null, starred: Boolean(email.starred), read: Boolean(email.read || email.direction === "outbound"), folder: email.folder ?? "inbox", followUpAt: email.followUpAt ?? null };
}

const categoryOptions: Category[] = ["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"];

const categoryStyles: Record<Category, string> = {
  "Needs follow-up": "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300",
  "Waiting on customer": "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  Interested: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  "Big order": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  "No action": "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
};

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
  return <div data-no-translate className="whitespace-pre-wrap text-sm leading-7">{body.split(linkPattern).map((part, index) => {
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

function OriginalEmailBody({ email }: { email: EmailWorkspaceItem }) {
  if (!email.html) return <PlainEmailBody body={email.body} />;
  return <iframe title={`Email content from ${email.contact}`} srcDoc={emailDocument(email.html)} sandbox="allow-popups allow-popups-to-escape-sandbox" className="min-h-[420px] w-full border-0 bg-white" />;
}

function EmailBody({ email, onLoad, loading, error }: { email: EmailWorkspaceItem; onLoad: () => void; loading: boolean; error?: string }) {
  if (email.bodyLoaded === false) return <div className="py-4 text-sm text-muted-foreground">{loading ? <span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />Loading message…</span> : <><p>{error || "Message content is ready to download."}</p><button type="button" onClick={onLoad} className="mt-2 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted">{error ? "Retry loading message" : "Load message"}</button></>}</div>;
  if (email.html) return <OriginalEmailBody email={email} />;
  const split = email.direction === "inbound" ? splitQuotedEmail(email.body) : null;
  if (!split?.quoted) return <OriginalEmailBody email={email} />;
  return <><PlainEmailBody body={split.current} /><details className="mt-3 border-t pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Show original email and quoted history</summary><div className="mt-3"><OriginalEmailBody email={email} /></div></details></>;
}

function SentAttachments({ email }: { email: EmailWorkspaceItem }) {
  if (!email.attachments?.length) return null;
  return <div className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">{email.attachments.map((attachment, index) => {
    const content = <><FileText className="size-4 shrink-0 text-sky-700" /><span className="max-w-52 truncate">{attachment.filename}</span><span className="text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} KB</span></>;
    return attachment.url ? <a key={index} href={attachment.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:border-primary/40 hover:bg-muted/30">{content}</a> : <span key={index} className="inline-flex max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs font-medium">{content}</span>;
  })}</div>;
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

function ComposerAttachmentChip({ attachment, onRemove }: { attachment: ComposerAttachment; onRemove: (id: string) => void }) {
  const linkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const bytes = Uint8Array.from(atob(attachment.content), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: attachment.contentType }));
    const link = linkRef.current;
    if (link) link.href = url;
    return () => {
      link?.removeAttribute("href");
      URL.revokeObjectURL(url);
    };
  }, [attachment.content, attachment.contentType]);

  return <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 py-1 pl-2.5 pr-1.5 text-xs">
    <a ref={linkRef} target="_blank" rel="noopener noreferrer" aria-label={`Open ${attachment.filename}`} title={`Open ${attachment.filename}`} className="inline-flex min-w-0 items-center gap-2 rounded-sm hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
      <FileText className="size-3.5 shrink-0 text-muted-foreground" /><span className="max-w-52 truncate">{attachment.filename}</span><span className="shrink-0 text-muted-foreground">{Math.max(1, Math.round(attachment.size / 1024))} KB</span>
    </a>
    <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.filename}`} className="shrink-0 rounded-full p-0.5 hover:bg-muted"><X className="size-3" /></button>
  </span>;
}

function AttachmentChips({ attachments, onRemove }: { attachments: ComposerAttachment[]; onRemove: (id: string) => void }) {
  if (!attachments.length) return null;
  return <div className="flex flex-wrap gap-2 px-3 pb-3">{attachments.map((attachment) => <ComposerAttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemove} />)}</div>;
}

function emailMatchesFolder(
  email: EmailWorkspaceItem,
  folder: Folder,
  folderStates: Record<string, "inbox" | "archive" | "trash">,
  starred: Set<string>,
  readMessages: Set<string>,
  categories: Record<string, Category>,
) {
  const state = folderStates[email.id] ?? "inbox";
  if (folder === "unread") return state === "inbox" && email.direction === "inbound" && !readMessages.has(email.id);
  if (folder === "followup") return state !== "trash" && categories[email.id] === "Needs follow-up";
  if (folder === "all") return state !== "trash";
  if (folder === "inbox") return state === "inbox" && email.direction === "inbound";
  if (folder === "drafts") return state !== "trash" && email.status.toLowerCase().includes("draft");
  if (folder === "scheduled") return state !== "trash" && email.status.toLowerCase().includes("scheduled");
  if (folder === "sent") return state !== "trash" && email.direction === "outbound";
  if (folder === "starred") return state !== "trash" && starred.has(email.id);
  return folder === state;
}

export function EmailInboxWorkspace({
  initialEmails,
  initialThreadId,
  initialComposeTo,
  sendConfigured,
  inboxConfigured,
  inboxError,
  aiConfigured,
  defaultMailboxEmail,
  initialAutomation,
  products,
  catalogs,
  canCreateInvoices = false,
  invoiceViewer,
  companyScope,
  initialAgentDraft,
}: {
  initialEmails: EmailWorkspaceItem[];
  initialThreadId?: string;
  initialComposeTo?: string;
  initialAgentDraft?: string;
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
  canCreateInvoices?: boolean;
  invoiceViewer?: { id: string; role: string };
  companyScope?: CompanyEmailScope;
}) {
  const sourceEmails = companyScope ? filterCompanyEmails(initialEmails, companyScope) : initialEmails;
  const { preferences } = usePreferences();
  const { language } = useLanguage();
  const initialTarget = initialThreadId ? sourceEmails.find((email) => threadKeyForEmail(email) === initialThreadId || email.id === initialThreadId) : undefined;
  const pendingThread = useRef(initialTarget ? null : initialThreadId);
  const [emails, setEmails] = useState(sourceEmails);
  const [folder, setFolder] = useState<Folder>(initialTarget?.folder && initialTarget.folder !== "inbox" ? initialTarget.folder : initialTarget?.direction === "outbound" ? "sent" : companyScope ? "all" : "inbox");
  const [mobileReading, setMobileReading] = useState(Boolean(initialThreadId));
  const [selectedId, setSelectedId] = useState(initialTarget?.id ?? "");
  const [replyExpanded, setReplyExpanded] = useState(Boolean(companyScope));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [draft, setDraft] = useState("");
  const [composeOpen, setComposeOpen] = useState(Boolean(initialComposeTo));
  const [composeTo, setComposeTo] = useState(initialComposeTo || "");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeThread, setComposeThread] = useState<{ to: string; threadId?: string; inReplyTo?: string; references?: string[] } | null>(null);
  const loadedAgentDraft = useRef<string | null>(null);
  const unsentDraft = useRef(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeSending, setComposeSending] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<ComposerAttachment[]>([]);
  const [composeAttachments, setComposeAttachments] = useState<ComposerAttachment[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [invoiceContext,setInvoiceContext]=useState<InvoiceEmailContext|null>(null);
  const [catalogTarget, setCatalogTarget] = useState<"reply" | "compose">("reply");
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState("");
  const [aiDraftSource, setAiDraftSource] = useState("");
  const [aiWriting, setAiWriting] = useState(false);
  const [aiWritingError, setAiWritingError] = useState<string | null>(null);
  const [aiRetryNonce, setAiRetryNonce] = useState(0);
  const [translations, setTranslations] = useState<Record<string, { body: string; html: string | null | undefined }>>({});
  const [translating, setTranslating] = useState<Set<string>>(new Set());
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const [translationOn, setTranslationOn] = useState(preferences.emailTranslate);
  const [aiReplyOn, setAiReplyOn] = useState(preferences.emailAiSuggestions);
  const [aiReplyBusy, setAiReplyBusy] = useState(false);
  const aiReplyInProgress = useRef(false);
  const aiReplyInvoices = useRef(new Map<string, string>());
  const [aiReplyInvoiceId, setAiReplyInvoiceId] = useState<string | null>(null);
  const [starred, setStarred] = useState<Set<string>>(() => new Set(sourceEmails.filter((email) => email.starred).map((email) => email.id)));
  const [readMessages, setReadMessages] = useState<Set<string>>(() => new Set(sourceEmails.filter((email) => email.read || email.direction === "outbound").map((email) => email.id)));
  const [categories, setCategories] = useState<Record<string, Category>>(() => Object.fromEntries(sourceEmails.flatMap((email) => email.category ? [[email.id, email.category]] : [])));
  const [followUps, setFollowUps] = useState<Record<string, string>>(() => Object.fromEntries(sourceEmails.flatMap((email) => email.followUpAt ? [[email.id, email.followUpAt]] : [])));
  const [aiFollowUpPlans, setAiFollowUpPlans] = useState<Record<string, { reason: string; status: "saving" | "saved" | "error" }>>({});
  const [folderStates, setFolderStates] = useState<Record<string, "inbox" | "archive" | "trash">>(() => Object.fromEntries(sourceEmails.map((email) => [email.id, email.folder ?? "inbox"])));
  const [flowEnabled, setFlowEnabled] = useState(initialAutomation.enabled);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(inboxError);
  const [syncing, setSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const bodyRequests = useRef(new Set<string>());
  const [loadingBodies, setLoadingBodies] = useState<Set<string>>(new Set());
  const [bodyErrors, setBodyErrors] = useState<Record<string, string>>({});
  const aiRequestId = useRef(0);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const replyFileInput = useRef<HTMLInputElement>(null);
  const composeFileInput = useRef<HTMLInputElement>(null);
  const replyInput = useRef<HTMLTextAreaElement>(null);
  const replySession = useRef(0);
  const stateRevision = useRef(0);
  const pendingStateWrites = useRef(0);
  const savedStates = useRef(new Map(sourceEmails.map((email) => [email.id, messageState(email)])));
  const stateWrites = useRef(new Map<string, Promise<void>>());

  useEffect(() => { unsentDraft.current = Boolean(composeTo.trim() || composeSubject.trim() || composeBody.trim() || draft.trim() || composeAttachments.length || replyAttachments.length); }, [composeTo, composeSubject, composeBody, draft, composeAttachments.length, replyAttachments.length]);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function openAgentDraft(id: string, reopen = false) {
      if ((!reopen && loadedAgentDraft.current === id) || loading) return;
      if (unsentDraft.current) {
        setNotice("You have an unsent draft. Finish or clear it, then open the agent's draft from its result link.");
        return;
      }
      loading = true;
      setAttachmentBusy(true);
      try {
        const response = await fetch(`/api/ai/assistant/draft?id=${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.draft) throw new Error(result.error || "Unable to open the agent draft.");
        const prepared = result.draft;
        const attachments: ComposerAttachment[] = [];
        if (prepared.invoiceId) {
          const pdf = await fetch(`/api/invoices/${prepared.invoiceId}/pdf`, { signal: controller.signal, cache: "no-store" });
          if (!pdf.ok) throw new Error("Unable to attach the invoice PDF. Open the draft again to retry.");
          const bytes = new Uint8Array(await pdf.arrayBuffer());
          if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The invoice PDF could not be generated.");
          attachments.push({ id: `invoice-${prepared.invoiceId}`, filename: pdf.headers.get("X-Invoice-Filename") || `invoice-${prepared.invoiceId}.pdf`, content: bytesToBase64(bytes), contentType: "application/pdf", size: bytes.byteLength });
        }
        if (controller.signal.aborted) return;
        if (unsentDraft.current) throw new Error("Your draft changed while the agent draft was loading. Open the result link after finishing it.");
        loadedAgentDraft.current = id;
        setComposeTo(prepared.to);
        setComposeSubject(prepared.subject);
        setComposeBody(prepared.text);
        setComposeThread({ to: prepared.to, threadId: prepared.threadId, inReplyTo: prepared.inReplyTo, references: prepared.references });
        setComposeAttachments(attachments);
        setComposeError(null);
        setComposeOpen(true);
      } catch (reason) {
        if (!controller.signal.aborted) setNotice(reason instanceof Error ? reason.message : "Unable to open the agent draft.");
      } finally {
        loading = false;
        if (!controller.signal.aborted) setAttachmentBusy(false);
      }
    }
    if (initialAgentDraft) void openAgentDraft(initialAgentDraft);
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ draftId?: string; reopen?: boolean }>).detail;
      if (detail?.draftId) void openAgentDraft(detail.draftId, detail.reopen);
    };
    window.addEventListener("filazoo:agent-action", onAction);
    return () => { controller.abort(); window.removeEventListener("filazoo:agent-action", onAction); };
  }, [initialAgentDraft]);

  const applyMailboxSnapshot = useCallback((nextEmails: EmailWorkspaceItem[]) => {
    if (companyScope) nextEmails = filterCompanyEmails(nextEmails, companyScope);
    savedStates.current = new Map(nextEmails.map((email) => [email.id, messageState(email)]));
    setEmails((current) => {
      const loaded = new Map(current.filter((email) => email.bodyLoaded).map((email) => [email.id, email]));
      return nextEmails.map((email) => {
        const previous = loaded.get(email.id);
        return email.bodyLoaded === false && previous ? { ...email, body: previous.body, html: previous.html, preview: previous.preview, bodyLoaded: true } : email;
      });
    });
    setStarred(new Set(nextEmails.filter((email) => email.starred).map((email) => email.id)));
    setReadMessages(new Set(nextEmails.filter((email) => email.read || email.direction === "outbound").map((email) => email.id)));
    setCategories(Object.fromEntries(nextEmails.flatMap((email) => email.category ? [[email.id, email.category]] : [])));
    setFollowUps(Object.fromEntries(nextEmails.flatMap((email) => email.followUpAt ? [[email.id, email.followUpAt]] : [])));
    setFolderStates(Object.fromEntries(nextEmails.map((email) => [email.id, email.folder ?? "inbox"])));
    const target = pendingThread.current ? nextEmails.find((email) => threadKeyForEmail(email) === pendingThread.current || email.id === pendingThread.current) : undefined;
    if (target) {
      pendingThread.current = undefined;
      setFolder(target.folder && target.folder !== "inbox" ? target.folder : target.direction === "outbound" ? "sent" : "inbox");
    }
    setSelectedId((current) => target?.id ?? (nextEmails.some((email) => email.id === current) ? current : ""));
  }, [companyScope]);

  const syncInbox = useCallback(async (manual = false) => {
    if (!inboxConfigured || syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncing(true);
    const revision = stateRevision.current;
    try {
      const params = new URLSearchParams();
      if (manual) params.set("scope", "history");
      if (companyScope) params.set("companyId", companyScope.id);
      const response = await fetch(`/api/email/inbox?${params}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({ error: "The inbox returned an invalid response." }));
      if (!response.ok || !Array.isArray(result.emails)) {
        throw new Error(result.error || "Unable to sync the mailbox inbox.");
      }
      // A poll started before a user action must not undo that action.
      if (revision !== stateRevision.current || pendingStateWrites.current) return;
      applyMailboxSnapshot(result.emails as EmailWorkspaceItem[]);
      setSyncError(result.inboxError || null);
      if (manual) setNotice("Loading the next batch of older emails. They will appear automatically as they are imported.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync the mailbox inbox.";
      setSyncError(message);
      if (manual) setNotice(message);
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
    }
  }, [applyMailboxSnapshot, companyScope, inboxConfigured]);

  useEffect(() => {
    if (!inboxConfigured || !preferences.emailSyncSeconds) return;
    const initialSyncTimer = window.setTimeout(() => void syncInbox(false), 0);
    const refresh = () => { if (document.visibilityState === "visible") void syncInbox(false); };
    const timer = window.setInterval(refresh, preferences.emailSyncSeconds * 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(initialSyncTimer);
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [inboxConfigured, syncInbox, preferences.emailSyncSeconds]);

  const conversations = useMemo(() => buildConversations(emails), [emails]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesFolder = conversation.messages.some((email) => emailMatchesFolder(email, folder, folderStates, starred, readMessages, categories))
        || (folder === "unread" && mobileReading && conversation.messages.some((email) => email.id === selectedId && emailMatchesFolder(email, "inbox", folderStates, starred, readMessages, categories)));
      const category = [...conversation.messages].reverse().map((email) => categories[email.id]).find(Boolean);
      const matchesCategory = !categoryFilter || category === categoryFilter;
      const matchesSource = sourceFilter === "all"
        || (sourceFilter === "shopify" && conversation.messages.some((email) => email.source === "shopify"))
        || (sourceFilter === "replies" && conversation.messages.some((email) => email.direction === "inbound" && email.source !== "shopify"))
        || (sourceFilter === "unread" && conversation.messages.some((email) => email.id === selectedId || (email.direction === "inbound" && !readMessages.has(email.id))));
      const searchable = conversation.messages.map((email) => `${email.subject} ${email.contactName || ""} ${email.contact} ${email.company} ${email.preview}`).join(" ").toLowerCase();
      return matchesFolder && matchesCategory && matchesSource && (!query || searchable.includes(query));
    }).sort((a, b) => new Date(b.latest.timestamp).getTime() - new Date(a.latest.timestamp).getTime());
  }, [categories, categoryFilter, conversations, folder, folderStates, mobileReading, readMessages, search, selectedId, sourceFilter, starred]);
  const selectedConversation = visible.find((item) => item.messages.some((email) => email.id === selectedId));
  const selected = selectedConversation?.latest;
  const reading = mobileReading && Boolean(selected);
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const checkedVisible = visible.filter((item) => checkedIds.has(item.id));
  const allPageChecked = pageItems.length > 0 && pageItems.every((item) => checkedIds.has(item.id));
  const selectionScope = [folder, search, sourceFilter, categoryFilter].join("|");
  const [previousScope, setPreviousScope] = useState(selectionScope);
  if (selectionScope !== previousScope) {
    setPreviousScope(selectionScope);
    setPage(1);
    setCheckedIds(new Set());
  }
  function changeFolder(next: Folder) {
    setFolder(next);
    setSelectedId("");
    setMobileReading(false);
  }
  function startReply() {
    setReplyExpanded(true);
    window.setTimeout(() => replyInput.current?.focus(), 0);
  }
  async function bulkUpdate(override: Partial<MessageState>) {
    if (bulkBusy) return;
    setBulkBusy(true);
    const results = await Promise.allSettled(checkedVisible.flatMap((item) => item.messages).map(async (message) => {
      await persistState(message.id, override);
      if (override.folder) setFolderStates((current) => ({ ...current, [message.id]: override.folder! }));
      if (override.read !== undefined) setReadMessages((current) => {
        const next = new Set(current);
        if (override.read) next.add(message.id); else next.delete(message.id);
        return next;
      });
    }));
    const failures = results.filter((result) => result.status === "rejected");
    setNotice(failures.length ? failures.length + " message updates failed. Please retry." : "Selected conversations updated.");
    if (!failures.length) setCheckedIds(new Set());
    setBulkBusy(false);
  }
  const [composerConversationId, setComposerConversationId] = useState(selectedConversation?.id);
  if (composerConversationId !== selectedConversation?.id) {
    // Also covers selection changes caused by search, folders, filters and sync.
    setComposerConversationId(selectedConversation?.id);
    setReplyExpanded(Boolean(companyScope));
    setDraft("");
    setAiDraft("");
    setAiDraftSource("");
    setAiWriting(false);
    setAiWritingError(null);
    setReplyAttachments([]);
    setAiReplyInvoiceId(null);
    setNotice(null);
  }
  const conversation = useMemo(() => selectedConversation?.messages ?? [], [selectedConversation]);
  const target = replyTarget(conversation);
  const replyRecipient = target?.recipient || selected?.contact || "";
  const loadMessage = useCallback(async (email: EmailWorkspaceItem) => {
    if (!email.uid || !email.uidValidity || !email.mailboxKey || bodyRequests.current.has(email.id)) return;
    bodyRequests.current.add(email.id);
    setLoadingBodies((current) => new Set(current).add(email.id));
    setBodyErrors((current) => { const next = { ...current }; delete next[email.id]; return next; });
    try {
      const params = new URLSearchParams({ uid: String(email.uid), validity: String(email.uidValidity), mailbox: email.mailboxKey });
      const response = await fetch(`/api/email/message?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.email) throw new Error(result.error || "Unable to load this message.");
      setEmails((current) => current.map((message) => message.id === email.id ? { ...message, ...result.email, mailboxKey: email.mailboxKey } : message));
    } catch (error) {
      setBodyErrors((current) => ({ ...current, [email.id]: error instanceof Error ? error.message : "Unable to load this message." }));
    } finally {
      bodyRequests.current.delete(email.id);
      setLoadingBodies((current) => { const next = new Set(current); next.delete(email.id); return next; });
    }
  }, []);
  useEffect(() => {
    if (selected?.bodyLoaded === false && !bodyErrors[selected.id]) void loadMessage(selected);
  }, [selected, loadMessage, bodyErrors]);
  const selectedCategory = [...conversation].reverse().map((email) => categories[email.id]).find(Boolean);
  const selectedFollowUp = [...conversation].reverse().map((email) => followUps[email.id]).find(Boolean);
  const conversationContext = useMemo(() => conversation.slice(-8).map((message) => ({
    direction: message.direction,
    subject: message.subject,
    body: message.body.slice(0, 2_000),
    timestamp: message.timestamp,
  })), [conversation]);

  useEffect(() => {
    if (!translationOn) return;
    const pending = conversation.filter((message) => message.direction === "inbound" && message.bodyLoaded !== false && (message.body.trim() || message.html) && !translations[message.id] && !translationErrors[message.id] && !translating.has(message.id));
    if (!pending.length) return;
    const timer = window.setTimeout(() => {
      setTranslating((current) => new Set([...current, ...pending.map((message) => message.id)]));
      for (const message of pending) {
        void (async () => {
          const plan = prepareEmailTranslation(message.body, message.html);
          if (!plan.segments.length) {
            setTranslations((current) => ({ ...current, [message.id]: { body: message.body, html: message.html } }));
            return;
          }
          if (message.html) {
            const translated = plan.apply(await requestEmailTranslation(plan.segments));
            setTranslations((current) => ({ ...current, [message.id]: translated }));
            return;
          }
          const response = await fetch("/api/email/assist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "translate", text: message.body }),
          });
          const result = await response.json().catch(() => ({ ok: false, error: "The translation service returned an invalid response." }));
          if (!response.ok || typeof result.output !== "string" || !result.output.trim()) {
            throw new Error(result.error || "Unable to translate this email.");
          }
          const translated = plan.apply([result.output]);
          setTranslations((current) => ({ ...current, [message.id]: translated }));
        })().catch((error) => {
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
    const requestId = ++aiRequestId.current;
    const source = draft.trim();
    if (!aiReplyOn || !aiConfigured || source.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setAiWriting(true);
      setAiWritingError(null);
      void fetch("/api/email/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "rewrite",
          language,
          text: source,
          recipient: selected?.contactName || selected?.customerProfile?.contactName || selected?.contact || "Customer",
          assignedManagerName: selected?.ownerId ? selected.ownerName : undefined,
          customerProfile: selected?.customerProfile,
          conversationHistory: conversationContext,
        }),
        signal: controller.signal,
      }).then(async (response) => {
        const result = await response.json().catch(() => ({ ok: false, error: "Unable to write this email." }));
        if (!response.ok || !result.output) throw new Error(result.error || "Unable to write this email.");
        if (aiRequestId.current === requestId) {
          setAiDraft(result.output);
          setAiDraftSource(source);
        }
      }).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (aiRequestId.current === requestId) {
          setAiWritingError(error instanceof Error ? error.message : "Unable to write this email.");
        }
      }).finally(() => {
        if (aiRequestId.current === requestId) setAiWriting(false);
      });
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [language, aiConfigured, aiReplyOn, aiRetryNonce, conversationContext, draft, selectedConversation?.id, selected?.contact, selected?.contactName, selected?.customerProfile, selected?.ownerId, selected?.ownerName]);

  useEffect(() => {
    replySession.current += 1;
    conversationScroll.current?.scrollTo({ top: 0 });
  }, [selectedConversation?.id]);

  const aiPreviewVisible = aiReplyOn && draft.trim().length >= 2 && Boolean(aiWriting || aiDraft || aiWritingError || aiConfigured);
  const aiUpdating = aiReplyOn && aiConfigured && draft.trim().length >= 2
    && (aiWriting || (!aiWritingError && aiDraftSource !== draft.trim()));

  useEffect(() => {
    // Reveal once; refreshing the draft must not move the reader.
    if (!aiPreviewVisible) return;
    conversationScroll.current?.scrollTo({
      top: conversationScroll.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  }, [aiPreviewVisible]);

  const folderCounts = useMemo(() => {
    const counts: Record<Folder, number> = { inbox: 0, unread: 0, followup: 0, all: 0, drafts: 0, scheduled: 0, sent: 0, starred: 0, archive: 0, trash: 0 };
    const folders = Object.keys(counts) as Folder[];
    for (const item of conversations) {
      for (const targetFolder of folders) {
        if (item.messages.some((email) => emailMatchesFolder(email, targetFolder, folderStates, starred, readMessages, categories))) {
          counts[targetFolder] += 1;
        }
      }
    }
    return counts;
  }, [categories, conversations, folderStates, starred, readMessages]);

  async function persistState(id: string, override: Partial<MessageState>) {
    stateRevision.current += 1;
    pendingStateWrites.current += 1;
    const email = emails.find((item) => item.id === id);
    const previousWrite = stateWrites.current.get(id);
    const write = (async () => {
      await previousWrite?.catch(() => undefined);
      const state = { ...(savedStates.current.get(id) ?? (email ? messageState(email) : { category: null, starred: false, read: false, folder: "inbox" as const, followUpAt: null })), ...override };
      const response = await fetch("/api/email/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageKey: id,
          ...state,
          contactEmail: email?.contact.includes("@") ? email.contact : undefined,
          threadId: email?.threadId ?? null,
        }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Unable to save this change." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to save this change.");
      savedStates.current.set(id, state);
    })();
    stateWrites.current.set(id, write);
    try {
      await write;
    } finally {
      if (stateWrites.current.get(id) === write) stateWrites.current.delete(id);
      pendingStateWrites.current -= 1;
      stateRevision.current += 1;
    }
  }

  async function toggleStar(id: string) {
    const nextValue = !starred.has(id);
    try {
      await persistState(id, { starred: nextValue });
      setStarred((current) => {
        const next = new Set(current);
        if (nextValue) next.add(id); else next.delete(id);
        return next;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save star.");
    }
  }

  function clearReplyComposer() {
    aiRequestId.current += 1;
    setReplyExpanded(Boolean(companyScope));
    setDraft("");
    setAiDraft("");
    setAiDraftSource("");
    setAiWriting(false);
    setAiWritingError(null);
    setReplyAttachments([]);
  }

  function updateDraft(value: string) {
    setDraft(value);
    setAiWritingError(null);
    if (value.trim().length >= 2) return;
    aiRequestId.current += 1;
    setAiDraft("");
    setAiDraftSource("");
    setAiWriting(false);
    setAiWritingError(null);
  }

  function toggleAiWriting() {
    if (aiReplyOn) {
      aiRequestId.current += 1;
      setAiDraft("");
      setAiDraftSource("");
      setAiWriting(false);
      setAiWritingError(null);
    }
    setAiReplyOn((value) => !value);
  }

  function openConversation(item: EmailConversation) {
    setMobileReading(true);
    const position = visible.indexOf(item);
    if (position >= 0) setPage(Math.floor(position / pageSize) + 1);
    if (!companyScope && !mobileReading && window.matchMedia("(min-width: 1600px)").matches) setDetailsOpen(true);
    const email = item.latest;
    if (item.id !== selectedConversation?.id) clearReplyComposer();
    setSelectedId(email.id);
    if (!preferences.emailMarkRead) return;
    const unread = item.messages.filter((message) => message.direction === "inbound" && !readMessages.has(message.id));
    setReadMessages((current) => new Set([...current, ...unread.map((message) => message.id)]));
    for (const message of unread) {
      void persistState(message.id, { read: true }).catch((error) => {
        setReadMessages((current) => { const next = new Set(current); next.delete(message.id); return next; });
        setNotice(error.message);
      });
    }
  }

  async function setCategory(category: Category) {
    if (!selected) return;
    try {
      await persistState(selected.id, { category });
      setCategories((current) => ({ ...current, [selected.id]: category }));
      setNotice(`Category changed to ${category}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save category.");
    }
  }

  async function applyAiFollowUp(summary: EmailSummary) {
    if (!selected) return;
    const messageId = selected.id;
    const { followUpAt, followUpReason: reason } = summary;
    setAiFollowUpPlans((current) => ({ ...current, [messageId]: { reason, status: "saving" } }));
    try {
      // Clear reminders on earlier messages so thread-level lookup cannot resurrect them.
      const previousReminders = conversation.filter((message) => message.id !== messageId && followUps[message.id]);
      const category = followUpAt ? "Needs follow-up" : selectedCategory === "Needs follow-up" ? "No action" : undefined;
      await persistState(messageId, { followUpAt, ...(category ? { category } : {}) });
      for (const message of previousReminders) await persistState(message.id, { followUpAt: null });
      setFollowUps((current) => {
        const next = { ...current };
        for (const message of previousReminders) delete next[message.id];
        if (followUpAt) next[messageId] = followUpAt;
        else delete next[messageId];
        return next;
      });
      if (category) setCategories((current) => ({ ...current, [messageId]: category }));
      setAiFollowUpPlans((current) => ({ ...current, [messageId]: { reason, status: "saved" } }));
    } catch (error) {
      setAiFollowUpPlans((current) => ({ ...current, [messageId]: { reason: "Unable to save the AI follow-up. Retry the analysis above.", status: "error" } }));
      throw error;
    }
  }

  async function moveSelected(folderState: "inbox" | "archive" | "trash") {
    if (!selectedConversation) return;
    const results = await Promise.allSettled(selectedConversation.messages.map(async (message) => {
      await persistState(message.id, { folder: folderState });
      setFolderStates((current) => ({ ...current, [message.id]: folderState }));
    }));
    const failure = results.find((result) => result.status === "rejected");
    setNotice(failure?.status === "rejected" ? failure.reason.message : folderState === "inbox" ? "Conversation restored to inbox." : folderState === "archive" ? "Conversation archived." : "Conversation moved to trash.");
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
    const session = replySession.current;
    try {
      setAttachmentBusy(true);
      const existing = target === "reply" ? replyAttachments : composeAttachments;
      if (existing.length + files.length > 10) throw new Error("You can attach up to 10 files to one email.");
      const next = await Promise.all(Array.from(files).map(fileToAttachment));
      if (target === "reply" && session !== replySession.current) return;
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
    setCatalogOpen(true);
  }

  async function attachCatalog(title: string, bytes: Uint8Array) {
    if (attachmentBusy) return;
    const session = replySession.current;
    const currentAttachments = catalogTarget === "reply" ? replyAttachments : composeAttachments;
    if (currentAttachments.length >= 10) {
      throw new Error("You can attach up to 10 files to one email. Remove an attachment first.");
    }
    setAttachmentBusy(true);
    try {
      if (catalogTarget === "reply" && replySession.current !== session) return;
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
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function attachInvoicePdf(invoiceId: string) {
    if (!invoiceContext) throw new Error("Open customer invoices from the email composer first.");
    const target = invoiceContext.target || "reply";
    const session = replySession.current;
    const currentAttachments = target === "reply" ? replyAttachments : composeAttachments;
    setAttachmentBusy(true);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/pdf`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Unable to generate this invoice PDF.");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The invoice PDF could not be generated. Please retry.");
      if (target === "reply" && replySession.current !== session) throw new Error("The conversation changed. Reopen invoices from the intended email.");
      const attachment: ComposerAttachment = {
        id: `invoice-${invoiceId}`,
        filename: response.headers.get("X-Invoice-Filename") || `invoice-${invoiceId}.pdf`,
        content: bytesToBase64(bytes), contentType: "application/pdf", size: bytes.byteLength,
      };
      const next = mergeInvoiceAttachment(currentAttachments, attachment);
      if (target === "reply") setReplyAttachments(next);
      else setComposeAttachments(next);
      setNotice(`${attachment.filename} attached to your email.`);
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function generateAiReply() {
    if (!selected || aiReplyInProgress.current || attachmentBusy || sending || draft.trim()) return;
    const session = replySession.current;
    const isCurrent = () => replySession.current === session;
    aiReplyInProgress.current = true;
    setAiReplyBusy(true);
    setAttachmentBusy(true);
    setAiReplyOn(false);
    setAiDraft("");
    setAiDraftSource("");
    setAiWriting(false);
    setAiWritingError(null);
    startReply();
    setNotice("Reading the conversation and preparing your reply…");
    try {
      // IMAP list rows can contain only a preview. Load original bodies first.
      const history = await Promise.all(conversation.slice(-8).map(async (message) => {
        if (message.bodyLoaded !== false) return message;
        if (!message.uid || !message.uidValidity || !message.mailboxKey) throw new Error("Load the conversation messages before generating a reply.");
        const params = new URLSearchParams({ uid: String(message.uid), validity: String(message.uidValidity), mailbox: message.mailboxKey });
        const response = await fetch(`/api/email/message?${params}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.email) throw new Error(result.error || "Unable to read the conversation.");
        return { ...message, ...result.email } as EmailWorkspaceItem;
      }));
      if (!isCurrent()) return;
      const response = await fetch("/api/email/reply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          recipient: selected.contactName || selected.customerProfile?.contactName || replyRecipient,
          companyName: selected.company,
          assignedManagerName: selected.ownerId ? selected.ownerName : undefined,
          customerProfile: selected.customerProfile,
          conversationHistory: history.map((message) => ({ direction: message.direction, subject: message.subject, body: message.body.slice(0, 4_000), timestamp: message.timestamp })),
          products: products.slice(0, 500).map((product) => ({ sku: product.sku, name: `${product.name} ${product.material} ${product.color} ${product.diameter} ${product.weight}`, variants: product.variants.map(({ id, name }) => ({ id, name })) })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to generate a reply.");
      const plan = emailReplyPlanSchema.parse(result.plan);
      if (!isCurrent()) return;
      if (replyAttachments.length + Number(plan.attachCatalog) + Number(plan.invoiceItems.length > 0) > 10) throw new Error("Remove some attachments before generating this reply. An email supports up to 10 files.");
      const prepared: ComposerAttachment[] = [];
      if (plan.attachCatalog) {
        setNotice("Preparing the catalog PDF…");
        const saved = catalogs.filter((catalog) => catalog.company === selected.company).sort((a, b) => b.version - a.version)[0];
        const catalogProducts = saved ? products.filter((product) => saved.productSkus.includes(product.sku)) : products;
        if (!catalogProducts.length) throw new Error("No catalog products are available. Add products before generating a catalog reply.");
        const bytes = await buildCatalogPdfWithImages(catalogProducts, { title: "Filazoo product catalog", customer: selected.company });
        if (!isCurrent()) return;
        if (bytes.byteLength > 7_500_000) throw new Error("The catalog PDF exceeds 7.5 MB. Attach a smaller catalog manually.");
        prepared.push({ id: `catalog-${crypto.randomUUID()}`, filename: "filazoo-catalog.pdf", content: bytesToBase64(bytes), contentType: "application/pdf", size: bytes.byteLength });
      }
      if (plan.invoiceItems.length) {
        if (!canCreateInvoices) throw new Error("Your role cannot create invoices. Ask an operator to prepare the invoice.");
        setNotice("Creating a draft invoice with current CRM pricing…");
        const pdf = await prepareReplyInvoice({ items: plan.invoiceItems, email: replyRecipient, companyId: selected.companyId, threadId: selectedConversation?.id, sourceMessageId: history.filter((message) => message.direction === "inbound").at(-1)?.id || selected.id, customerName: selected.company, cache: aiReplyInvoices.current, isCurrent });
        if (!isCurrent()) return;
        setAiReplyInvoiceId(pdf.invoiceId);
        prepared.push({ id: pdf.id, filename: pdf.filename, content: bytesToBase64(pdf.bytes), contentType: "application/pdf", size: pdf.bytes.byteLength });
      }
      if (!isCurrent()) return;
      setReplyAttachments((current) => [...current, ...prepared]);
      setDraft(plan.body);
      setNotice("AI reply is ready. Review the message and PDFs before sending.");
    } catch (error) {
      if (isCurrent()) setNotice(error instanceof Error ? error.message : "Unable to prepare this AI reply. Please retry.");
    } finally {
      aiReplyInProgress.current = false;
      setAiReplyBusy(false);
      setAttachmentBusy(false);
    }
  }

  async function saveReply() {
    if (invoiceViewer?.role === "viewer") { setNotice("Viewer access is read-only"); return; }
    if (!selected || !draft.trim() || sending || aiWriting) return;
    const session = replySession.current;
    if (attachmentBusy) return;
    const trimmedDraft = aiReplyOn && aiDraft && aiDraftSource === draft.trim() ? aiDraft.trim() : draft.trim();
    const recipient = replyRecipient;
    const replyParent = target?.parent ?? selected;
    if (replyParent.bodyLoaded === false) {
      void loadMessage(replyParent);
      setNotice("The customer's email is loading. Review it before sending your reply.");
      return;
    }

    if (/\battach(?:ed|ing)?\b[^.!?\n]{0,80}\bcatalog\b|\bcatalog\b[^.!?\n]{0,80}\battach(?:ed|ing)?\b/i.test(trimmedDraft) && !replyAttachments.some((attachment) => attachment.contentType === "application/pdf")) {
      setNotice("This message says a catalog is attached. Add the catalog PDF before sending.");
      return;
    }

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
          text: withEmailSignature(trimmedDraft, preferences.emailSignature),
          html: `<p>${withEmailSignature(trimmedDraft, preferences.emailSignature).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character).replace(/\n/g, "<br />")}</p>`,
          attachments: replyAttachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })),
          threadId: selectedConversation?.id,
          inReplyTo: replyParent.messageId || undefined,
          references: replyReferences(replyParent),
        }),
      });

      const result = await response.json().catch(() => ({ ok: false, error: "Unable to send the email." }));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Unable to send the email.");
      }

      const reply: EmailWorkspaceItem = {
        ...result.email,
        contactName: selected.contactName,
        company: selected.company,
        companyId: selected.companyId,
        ownerId: selected.ownerId,
        ownerName: selected.ownerName,
        ownerInitials: selected.ownerInitials,
        ownerAvatarUrl: selected.ownerAvatarUrl,
        customerProfile: selected.customerProfile,
      };
      stateRevision.current += 1;
      setEmails((current) => [reply, ...current]);
      if (session !== replySession.current) return;
      setDraft("");
      setAiDraft("");
      setAiDraftSource("");
      setReplyAttachments([]);
      setNotice(result.saved ? `Email sent successfully from ${defaultMailboxEmail}.` : "Email sent, but its CRM history could not be saved. Check the recipient's mailbox for the attachment.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The CRM could not send this email.");
    } finally {
      setSending(false);
    }
  }

  function openComposer() {
    if (invoiceViewer?.role === "viewer") { setNotice("Viewer access is read-only"); return; }
    if (companyScope && !composeTo) setComposeTo(companyScope.emails.find((email) => email.trim()) || "");
    setComposeError(null);
    setComposeOpen(true);
  }

  function forwardSelected() {
    if (!selected) return;
    setComposeTo("");
    setComposeThread(null);
    setComposeSubject(`Fwd: ${selected.subject.replace(/^(?:fwd?|re):\s*/i, "")}`);
    setComposeBody(`\n\n---------- Forwarded message ----------\nFrom: ${selected.from || selected.contact}\nDate: ${formatTime(selected.timestamp)}\nSubject: ${selected.subject}\n\n${selected.body}`);
    setComposeAttachments([]);
    openComposer();
  }

  async function sendNewEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invoiceViewer?.role === "viewer") { setComposeError("Viewer access is read-only"); return; }
    if (attachmentBusy || composeSending) return;
    const to = composeTo.trim();
    const subject = composeSubject.trim();
    const text = composeBody.trim();
    if (companyScope && !filterCompanyEmails([{ contact: to }], companyScope).length) {
      setComposeError("Choose one of this company's saved contact email addresses.");
      return;
    }
    if (/\battach(?:ed|ing)?\b[^.!?\n]{0,80}\bcatalog\b|\bcatalog\b[^.!?\n]{0,80}\battach(?:ed|ing)?\b/i.test(text) && !composeAttachments.some((attachment) => attachment.contentType === "application/pdf")) {
      setComposeError("This message says a catalog is attached. Add the catalog PDF before sending.");
      return;
    }
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
        body: JSON.stringify({ to, subject, text: withEmailSignature(text, preferences.emailSignature), ...(composeThread?.to === to ? { threadId: composeThread.threadId, inReplyTo: composeThread.inReplyTo, references: composeThread.references } : {}), attachments: composeAttachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })) }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Unable to send the email." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to send the email.");

      const sentEmail: EmailWorkspaceItem = result.email;
      stateRevision.current += 1;
      setEmails((current) => [sentEmail, ...current]);
      setFolderStates((current) => ({ ...current, [sentEmail.id]: "inbox" }));
      setSelectedId(sentEmail.id);
      setFolder("sent");
      setMobileReading(true);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeThread(null);
      setComposeAttachments([]);
      setComposeOpen(false);
      setNotice(result.saved ? `Email sent successfully from ${defaultMailboxEmail}.` : "Email sent, but its CRM history could not be saved. Check the recipient's mailbox for the attachment.");
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "The CRM could not send this email.");
    } finally {
      setComposeSending(false);
    }
  }

  const folderItems: Array<{ id: Folder; label: string; icon: typeof Inbox }> = [
    { id: "inbox", label: "Inbox", icon: Inbox }, { id: "followup", label: "Needs follow-up", icon: CalendarClock }, { id: "unread", label: "Unread", icon: MailOpen }, { id: "all", label: "All mail", icon: Mail },
    { id: "drafts", label: "Drafts", icon: FileText }, { id: "scheduled", label: "Scheduled", icon: Clock3 },
    { id: "sent", label: "Sent", icon: Send }, { id: "starred", label: "Starred", icon: Star },
    { id: "archive", label: "Archive", icon: Archive }, { id: "trash", label: "Trash", icon: Trash2 },
  ];
  const sourceFilters: Array<{ id: SourceFilter; label: string }> = [
    { id: "all", label: "All messages" },
    { id: "shopify", label: "Shopify leads" },
    { id: "replies", label: "Mailbox email" },
    { id: "unread", label: "Unread" },
  ];

  return (
    <div data-ai-email-id={reading ? selected?.id : undefined} data-ai-company-id={reading ? selected?.companyId || undefined : companyScope?.id} className={`email-workspace flex min-w-0 flex-col overflow-hidden bg-background ${companyScope ? "company-email-workspace h-[clamp(520px,calc(100dvh-14rem),900px)] rounded-xl border" : "h-[calc(100dvh-3rem)]"}`}>
      {companyScope ? <h3 className="sr-only">Customer mailbox</h3> : <h1 className="sr-only">Email</h1>}

      <div className="mail-layout" data-reading={reading} data-details={detailsOpen}>
        {!companyScope ? <ColumnResizeHandle label="Email folders width" variable="--mail-folder-width" container=".mail-layout" panel=".mail-folders" min={160} max={360} className="mail-folder-resize" /> : null}
        <ColumnResizeHandle label="Conversation list width" variable="--mail-list-width" container=".mail-layout" panel=".mail-list" min={220} max={600} storageKey={companyScope ? "company-mail-list" : "mail-list"} className="mail-list-resize" />
        {selected && !companyScope ? <ColumnResizeHandle label="Contact details width" variable="--mail-details-width" container=".mail-layout" panel=".mail-details" min={280} max={560} reverse className="mail-details-resize" /> : null}
        {!companyScope ? <aside className="mail-folders min-h-0 flex-col border-r bg-muted/20" aria-label="Email folders">
          <div className="p-3"><button type="button" onClick={openComposer} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-xs font-semibold text-background hover:bg-foreground/90"><Plus className="size-4" />Compose</button></div>
          <nav className="space-y-1 px-2 py-1">
            {folderItems.map((item) => <button key={item.id} type="button" onClick={() => changeFolder(item.id)} aria-current={folder === item.id ? "page" : undefined} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-xs font-medium ${folder === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon className={`size-4 ${folder === item.id ? "text-primary" : ""}`} /><span className="flex-1 text-left">{item.label}</span><span className="text-xs">{folderCounts[item.id]}</span></button>)}
          </nav>
          <div className="mx-4 my-4 h-px bg-border" />
          <div className="px-5"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Automation</p><div className="mt-3 rounded-lg border bg-background p-3"><p className="flex items-center gap-2 text-xs font-semibold"><Workflow className="size-4 text-violet-600" />Follow-up flow</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">Automatically continue conversations that need attention.</p><Link href="/lead-channel/ai-agent?flow=default" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Open builder →</Link></div></div>
        </aside> : null}

        <section className="mail-list" aria-label="Email list">
{companyScope ? <div className="space-y-3 border-b p-4">
  <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Conversations <span className="ml-1 font-normal text-muted-foreground">{conversations.length}</span></h3><div className="flex items-center gap-1"><button type="button" aria-label="Refresh customer emails" title="Refresh" disabled={syncing || !inboxConfigured} onClick={() => void syncInbox(false)} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} /></button><button type="button" onClick={openComposer} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background"><Plus className="size-3.5" />New email</button></div></div>
  <div className="mail-search" role="search"><Search className="size-4 shrink-0 text-muted-foreground" /><input aria-label="Search customer emails" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X className="size-3.5" /></button> : null}</div>
  <div className="flex gap-1" aria-label="Customer email filter">{([{ id: "all", label: "All" }, { id: "unread", label: "Unread" }] as const).map((item) => <button key={item.id} type="button" aria-pressed={folder === item.id} onClick={() => changeFolder(item.id)} className={"rounded-md px-3 py-1 text-xs font-medium " + (folder === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}>{item.label}</button>)}</div>
</div> : <>
          <div className="border-b p-3"><label className="mail-folder-select mb-3 items-center gap-2 text-xs">Folder<Select value={folder} onValueChange={(value) => { if (value === null) return; return changeFolder(value as Folder); }}><SelectTrigger aria-label="Email folder" className="min-w-0 flex-1 rounded-md border bg-background p-2"><SelectValue /></SelectTrigger><SelectContent>{folderItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.label} ({folderCounts[item.id]})</SelectItem>)}</SelectContent></Select></label>
            <div className="mb-2 flex items-center justify-between px-1"><div><h2 className="text-sm font-semibold">{folderItems.find((item) => item.id === folder)?.label}</h2>{categoryFilter ? <p className="text-xs text-muted-foreground">{categoryFilter}</p> : null}</div><DropdownMenu><DropdownMenuTrigger aria-label="Filter email by category" className={`rounded-md p-2 outline-none hover:bg-muted ${categoryFilter ? "text-primary" : "text-muted-foreground"}`}><Filter className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52"><DropdownMenuGroup><DropdownMenuLabel>Filter by category</DropdownMenuLabel></DropdownMenuGroup><DropdownMenuItem onClick={() => setCategoryFilter(null)}>{!categoryFilter ? <Check /> : <span className="size-4" />}All categories</DropdownMenuItem><DropdownMenuSeparator />{categoryOptions.map((category) => <DropdownMenuItem key={category} onClick={() => setCategoryFilter(category)}>{categoryFilter === category ? <Check /> : <span className="size-4" />}{category}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
            <div className="mail-search" role="search" aria-label="Search mailbox"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Search email" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer mail" />{search ? <button type="button" onClick={() => setSearch("")} aria-label="Clear email search" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button> : null}</div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5" aria-label="Filter inbox by message source">{sourceFilters.map((item) => <button key={item.id} type="button" aria-pressed={sourceFilter === item.id} onClick={() => { setSourceFilter(item.id); setSelectedId(""); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${sourceFilter === item.id ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300" : "bg-background text-muted-foreground hover:bg-muted"}`}>{item.label}</button>)}</div>
          </div>
          <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-3 text-xs">
            <input type="checkbox" aria-label="Select all conversations on this page" checked={allPageChecked} onChange={() => setCheckedIds((current) => { const next = new Set(current); for (const item of pageItems) { if (allPageChecked) next.delete(item.id); else next.add(item.id); } return next; })} />
            {checkedVisible.length ? <><span>{checkedVisible.length} selected</span><button type="button" disabled={bulkBusy} title="Mark selected as read" onClick={() => void bulkUpdate({ read: true })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><MailOpen className="size-4" /></button><button type="button" disabled={bulkBusy} title="Mark selected as unread" onClick={() => void bulkUpdate({ read: false })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Mail className="size-4" /></button><button type="button" disabled={bulkBusy} title={folder === "trash" || folder === "archive" ? "Restore selected to inbox" : "Archive selected"} onClick={() => void bulkUpdate({ folder: folder === "trash" || folder === "archive" ? "inbox" : "archive" })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Archive className="size-4" /></button><button type="button" disabled={bulkBusy} title="Move selected to trash" onClick={() => void bulkUpdate({ folder: "trash" })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Trash2 className="size-4" /></button></> : <><button type="button" title="Refresh inbox" disabled={syncing || !inboxConfigured} onClick={() => void syncInbox(false)} className="rounded p-2 hover:bg-muted disabled:opacity-40"><RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} /></button><span className="text-muted-foreground">{visible.length} conversations</span></>}
          </div>
          <div className="mail-header-compose border-b px-3 py-2"><button type="button" onClick={openComposer} className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background"><Plus className="size-4" />Compose</button></div>

</>}
          {syncError ? <p role="alert" className="border-b px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Inbox sync failed: {syncError}</p> : null}
          {notice ? <p role="status" className="border-b bg-muted/30 px-3 py-2 text-xs">{notice}</p> : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
            <EmailMessageList conversations={pageItems} compact={Boolean(companyScope) || reading} simple={Boolean(companyScope)} activeId={reading ? selectedConversation?.id : undefined} checked={checkedIds} readMessages={readMessages} starred={starred} onCheck={(id) => setCheckedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openConversation} onStar={toggleStar} />
          </div>
          <div className="flex min-h-12 items-center justify-end gap-3 border-t px-3 text-xs text-muted-foreground">
            <span>{visible.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, visible.length)} of {visible.length}</span>
            <button type="button" aria-label="Previous email page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded p-1.5 hover:bg-muted disabled:opacity-30"><ChevronLeft className="size-4" /></button><span>{currentPage} / {pageCount}</span><button type="button" aria-label="Next email page" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded p-1.5 hover:bg-muted disabled:opacity-30"><ChevronRight className="size-4" /></button>
          </div>
        </section>

        <main className="mail-reader" aria-label="Email reader">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
            <button type="button" onClick={() => { setMobileReading(false); setDetailsOpen(false); }} className="mr-auto inline-flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"><ArrowLeft className="size-4" />{companyScope ? "Conversations" : "Mailbox"}</button>
{companyScope ? <button type="button" aria-pressed={translationOn} onClick={() => setTranslationOn((value) => !value)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted"><Languages className="size-3.5" />{translationOn ? "Show original" : "Translate"}</button> : <>
            <button type="button" title="Previous conversation" disabled={!selectedConversation || visible.indexOf(selectedConversation) <= 0} onClick={() => openConversation(visible[visible.indexOf(selectedConversation!) - 1])} className="rounded p-2 hover:bg-muted disabled:opacity-30"><ChevronLeft className="size-4" /></button>
            <button type="button" title="Next conversation" disabled={!selectedConversation || visible.indexOf(selectedConversation) >= visible.length - 1} onClick={() => openConversation(visible[visible.indexOf(selectedConversation!) + 1])} className="rounded p-2 hover:bg-muted disabled:opacity-30"><ChevronRight className="size-4" /></button>
            <button type="button" aria-label="Contact and follow-up details" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((value) => !value)} className={detailsOpen ? "rounded p-2 text-primary hover:bg-muted" : "rounded p-2 text-muted-foreground hover:bg-muted"}><PanelRight className="size-4" /></button>
</>}

          </div>
          {selected ? <>
{companyScope ? <div className="border-b px-6 py-5"><h2 className="text-lg font-semibold leading-7">{selected.subject}</h2><p className="mt-1 text-xs text-muted-foreground">{selectedConversation?.messages.length} {selectedConversation?.messages.length === 1 ? "message" : "messages"} in this conversation</p></div> : <>
            <div className="flex min-h-20 shrink-0 items-center justify-between gap-3 border-b bg-background px-5"><div className="min-w-0"><h2 className="text-base font-semibold">{selected.subject}</h2><p className="mt-1 text-xs text-muted-foreground">{selected.direction === "inbound" ? "From" : "To"} {selected.contact} · {selected.company}</p></div><div className="flex items-center gap-3"><AssignedOwner imageUrl={selected.ownerAvatarUrl} name={selected.ownerName || "Unassigned"} initials={selected.ownerInitials || "—"} assigned={Boolean(selected.ownerId)} compact className="hidden lg:inline-flex" /><div className="flex items-center gap-1"><button type="button" title={starred.has(selected.id) ? "Remove star" : "Star email"} onClick={() => toggleStar(selected.id)} className={`rounded-md p-2 hover:bg-muted ${starred.has(selected.id) ? "text-amber-500" : "text-muted-foreground"}`}><Star className="size-4" fill={starred.has(selected.id) ? "currentColor" : "none"} /></button><button type="button" title="Archive" onClick={() => void moveSelected("archive")} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Archive className="size-4" /></button><DropdownMenu><DropdownMenuTrigger aria-label="More email actions" className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuGroup><DropdownMenuLabel>Email actions</DropdownMenuLabel></DropdownMenuGroup><DropdownMenuItem onClick={startReply}><Reply />Reply</DropdownMenuItem><DropdownMenuItem onClick={forwardSelected}><Forward />Forward</DropdownMenuItem><DropdownMenuSeparator />{conversation.some((message) => folderStates[message.id] && folderStates[message.id] !== "inbox") ? <DropdownMenuItem onClick={() => void moveSelected("inbox")}><Inbox />Move to inbox</DropdownMenuItem> : null}<DropdownMenuItem variant="destructive" onClick={() => void moveSelected("trash")}><Trash2 />Move to trash</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div></div>
            <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-5 py-2 text-xs text-muted-foreground"><Languages className="size-3.5" /><span>Auto-translate to Chinese</span><Toggle checked={translationOn} onChange={() => setTranslationOn((value) => !value)} label="Toggle email translation" /></div>

</>}
            <div ref={conversationScroll} className="mail-conversation min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-5 py-5"><div className="mx-auto max-w-3xl space-y-6">{conversation.map((message) => <article key={message.id} className="border-b pb-6"><div className="min-w-0"><div className="flex flex-wrap items-baseline justify-between gap-2"><div><p className="text-sm font-semibold">{message.direction === "outbound" ? message.from || defaultMailboxEmail || "You" : message.contact}</p><p className="mt-0.5 text-xs text-muted-foreground">{message.direction === "outbound" ? `To ${message.contact}` : message.company}</p></div><time className="text-xs text-muted-foreground">{formatTime(message.timestamp)}</time></div><div className="mt-5 overflow-hidden bg-background"><EmailBody email={translationOn && message.direction === "inbound" && translations[message.id] ? { ...message, ...translations[message.id] } : message} onLoad={() => void loadMessage(message)} loading={loadingBodies.has(message.id)} error={bodyErrors[message.id]} /></div><SentAttachments email={message} />{translationOn && message.direction === "inbound" && message.bodyLoaded !== false && !translations[message.id] ? <div className="mt-2 text-xs text-muted-foreground" role="status">{translationErrors[message.id] ? <div className="flex flex-wrap items-center gap-2"><span>{translationErrors[message.id]}</span><button type="button" onClick={() => setTranslationErrors((current) => { const next = { ...current }; delete next[message.id]; return next; })} className="rounded-md border px-2 py-1 font-semibold hover:bg-muted">Retry translation</button></div> : <span className="inline-flex items-center gap-2"><AiIcon className="size-3.5" state="thinking" />Translating email...</span>}</div> : null}</div></article>)}
              {aiPreviewVisible ? (
                <article className="flex items-start gap-3" aria-label="AI reply draft">
                  <div className="size-10 shrink-0" aria-hidden="true">
                    <AiIcon className="size-10" state={aiUpdating ? "thinking" : aiWritingError ? "error" : "idle"} />
                  </div>
                  <div className="min-w-0 max-w-[88%] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">AI writing</p>
                      <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">Draft only</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{language === "zh-CN" ? "Your professional Chinese reply" : "Your professional English reply"}</p>
                    <div className="mt-4">
                      <div className="flex flex-col gap-1">
                        <EmailAiTypewriter text={aiDraft} updating={aiUpdating} />
                        <div className="mt-5 flex min-h-5 items-center gap-2 text-xs text-violet-700/80 dark:text-violet-300" role="status" aria-live="polite">
                          <AiIcon className="size-3.5" state={aiUpdating ? "thinking" : "idle"} />
                          <span>{aiUpdating ? (aiDraft ? "Refining your latest changes…" : "Crafting your reply…") : aiWritingError ? "Couldn't update this draft" : "Ready to send · Updates as you type"}</span>
                        </div>
                        {aiWritingError ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-700 dark:text-amber-300"><span>{aiWritingError}</span><button type="button" onClick={() => setAiRetryNonce((value) => value + 1)} className="rounded-md border border-amber-300/70 bg-background px-2.5 py-1.5 font-semibold hover:bg-amber-50 dark:hover:bg-amber-500/10">Try again</button></div> : null}
                      </div>
                    </div>
                  </div>
                </article>
              ) : null}
            </div></div>
            <div className="mail-reply-panel shrink-0 border-t bg-background" data-expanded={replyExpanded}>
              <ColumnResizeHandle label="Reply area height" variable="--mail-reply-height" container=".mail-reader" panel=".mail-reply-panel" min={180} max={700} reverse orientation="horizontal" className={replyExpanded ? "mail-reply-resize" : "hidden"} />
              <div className="mail-reply-content min-h-0 flex-1 overflow-y-auto p-3">
              {!replyExpanded ? <div className="flex items-center gap-2"><button type="button" onClick={startReply} className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/20 px-3 text-left text-xs text-muted-foreground"><Reply className="size-4 shrink-0" /><span className="truncate">Quick reply to {replyRecipient}</span></button><button type="button" onClick={() => void generateAiReply()} disabled={aiReplyBusy || attachmentBusy || sending} className="inline-flex h-11 items-center gap-2 rounded-md border px-3 text-xs text-violet-600"><AiIcon className="size-4" />AI reply</button></div> : <>
              <div className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="font-semibold">Reply</span><div className="flex items-center gap-1">
                <Popover><PopoverTrigger aria-label="AI reply options" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-violet-600 hover:bg-muted"><AiIcon className="size-3.5" state={aiReplyBusy || aiUpdating ? "thinking" : "idle"} />AI tools<ChevronRight className="size-3 rotate-90" /></PopoverTrigger>
                  <PopoverContent align="end" side="top" className="mail-ai-tools w-80 max-w-[calc(100vw-2rem)] max-h-[min(28rem,var(--available-height))] overflow-y-auto p-3">
                    <PopoverTitle>AI reply tools</PopoverTitle>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><AiIcon state={aiUpdating ? "thinking" : "idle"} />AI writing<Toggle checked={aiReplyOn} onChange={() => { if (!aiReplyBusy) toggleAiWriting(); }} label="Toggle AI writing" /></div>
                  {!aiConfigured ? <span className="text-xs text-amber-700">AI provider not configured — suggestions remain available</span> : null}
                </div>
                {aiReplyOn ? <div className="mb-2 flex gap-2 overflow-x-auto"><span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600"><AiIcon className="size-3.5" />Suggestions</span>{["Send pricing + MOQ", "Confirm shipping details", "Schedule a follow-up"].map((item) => <button key={item} type="button" onClick={() => setDraft(item === "Send pricing + MOQ" ? `Hi ${(selected.contactName || selected.customerProfile?.contactName || selected.contact).split(" ")[0]},\n\nThanks for your message. I’ll send our current wholesale pricing and minimum order quantities for your review.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : item === "Confirm shipping details" ? `Hi ${(selected.contactName || selected.customerProfile?.contactName || selected.contact).split(" ")[0]},\n\nWe can prepare a shipping quote. Could you confirm the delivery postcode and expected quantity?\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : `Hi ${(selected.contactName || selected.customerProfile?.contactName || selected.contact).split(" ")[0]},\n\nI’ll follow up with you shortly with the latest availability and next steps.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}`)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">{item}</button>)}</div> : null}
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><button type="button" disabled={aiReplyBusy || attachmentBusy || sending || Boolean(draft.trim())} onClick={() => void generateAiReply()} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-violet-600 disabled:opacity-40"><AiIcon className="size-3.5" state={aiReplyBusy ? "thinking" : "idle"} />{aiReplyBusy ? "Preparing reply & PDFs?" : "AI reply"}</button>{aiReplyInvoiceId ? <Link href={`/invoices/${aiReplyInvoiceId}`} target="_blank" className="font-medium text-emerald-700 underline">Review draft invoice</Link> : null}</div>
                  </PopoverContent>
                </Popover>
                <button type="button" aria-label="Collapse reply" onClick={() => setReplyExpanded(false)} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
              </div></div>
              <div className="mail-reply-editor mx-auto max-w-3xl">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"><span>From <span className="font-medium text-foreground">{defaultMailboxEmail || "No mailbox selected"}</span></span><span>To <span className="font-medium text-foreground">{replyRecipient}</span></span></div>
                <div className="mail-reply-input overflow-hidden rounded-xl border bg-background focus-within:border-primary/50">
                  <textarea ref={replyInput} readOnly={aiReplyBusy} aria-busy={aiReplyBusy} aria-label="Reply message" value={draft} onChange={(event) => updateDraft(event.target.value)} placeholder={`Write in Chinese or English to reply to ${replyRecipient}…`} className="min-h-24 w-full resize-none bg-transparent p-3.5 text-sm leading-6 outline-none" />
                  {preferences.emailSignature ? <div className="mb-3 max-h-28 overflow-y-auto rounded-md border bg-muted/20 p-3 text-xs"><p className="mb-1 text-muted-foreground">Your signature will be appended when sending.</p><p data-no-translate className="whitespace-pre-wrap break-words">{preferences.emailSignature}</p></div> : null}
                  <AttachmentChips attachments={replyAttachments} onRemove={(id) => setReplyAttachments((current) => current.filter((item) => item.id !== id))} />
                  <div className="flex items-center justify-between border-t px-2 py-2"><div className="flex gap-1"><input ref={replyFileInput} type="file" multiple accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(event) => { void addFiles(event.target.files, "reply"); event.target.value = ""; }} /><button type="button" disabled={attachmentBusy} title="Attach files" onClick={() => replyFileInput.current?.click()} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><Paperclip className="size-4" /></button><button type="button" title="Attach product catalog" onClick={() => openCatalogPicker("reply")} className="rounded-md p-2 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10"><Library className="size-4" /></button>{canCreateInvoices ? <button type="button" title="Customer invoices" aria-label="Customer invoices" onClick={()=>setInvoiceContext({companyId:selected.companyId,email:replyRecipient,threadId:selectedConversation?.id,customerName:selected.company,target:"reply"})} className="rounded-md p-2 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"><ReceiptText className="size-4" /></button> : null}<button type="button" title="Add emoji" onClick={() => setDraft((value) => `${value}${value ? " " : ""}😊`)} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Smile className="size-4" /></button><button type="button" title={draft.trim() ? "Clear the message to generate a new AI reply" : "Generate reply from conversation with relevant PDFs"} disabled={aiReplyBusy || attachmentBusy || sending || Boolean(draft.trim())} onClick={() => void generateAiReply()} className="rounded-md p-2 text-violet-600 hover:bg-violet-50 disabled:opacity-40"><AiIcon className="size-4" state={aiReplyBusy ? "thinking" : "idle"} /></button><InboxCalculator /></div><button type="button" onClick={saveReply} disabled={!draft.trim() || sending || aiWriting || attachmentBusy} className="inline-flex h-9 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-40"><Send className="size-4" />{sending ? "Sending..." : aiWriting ? "Writing..." : aiDraft && aiDraftSource === draft.trim() ? "Send AI draft" : "Send email"}</button></div>
                </div>
                {notice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{notice}</p> : null}
              </div>
              </>}
              </div>
            </div>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{companyScope ? <div className="max-w-xs px-5 text-center"><Mail className="mx-auto mb-4 size-8 text-muted-foreground/50" /><p className="font-medium text-foreground">Select a conversation</p><p className="mt-2 text-sm leading-6">Read messages and reply to this customer here.</p></div> : "Select an email to read it."}</div>}
        </main>

        {selected && !companyScope ? <aside key={`details-${selectedConversation?.id}`} className="mail-details border-l bg-background" aria-label="Email follow-up details">
          <div className="flex h-16 items-center justify-between border-b px-5"><h2 className="text-sm font-semibold">Contact & follow-up</h2><button type="button" aria-label="Close contact details" onClick={() => setDetailsOpen(false)} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ContactSummary name={selected.contactName || selected.contact} email={selected.contact} company={selected.company} companyId={selected.companyId} ownerName={selected.ownerName} ownerInitials={selected.ownerInitials} ownerAvatarUrl={selected.ownerAvatarUrl} ownerId={selected.ownerId} canCreateInvoices={canCreateInvoices} />
            <EmailAiSummary
              key={JSON.stringify([selected.id, selected.body, conversationContext, selected.customerProfile])}
              configured={aiConfigured}
              ready={reading && selected.bodyLoaded !== false && Boolean(selected.body.trim())}
              currentFollowUpAt={selectedFollowUp || null}
              onAnalyzed={applyAiFollowUp}
              context={JSON.stringify({
                mode: "summary",
                text: selected.body.slice(0, 20_000),
                recipient: selected.contact.slice(0, 200),
                customerProfile: selected.customerProfile || { companyName: selected.company.slice(0, 300), contactName: selected.contactName?.slice(0, 300) },
                conversationHistory: conversationContext,
              })}
            />
            <section className="px-6 pb-6" aria-labelledby="contact-category">
              <h3 id="contact-category" className="text-xs font-medium text-muted-foreground">Category</h3>
              <Select value={selectedCategory || ""} onValueChange={(value) => { if (value === null) return; return void setCategory(value as Category); }}><SelectTrigger aria-labelledby="contact-category" className={`mt-2.5 h-11 w-full rounded-lg border px-3 text-sm font-medium ${selectedCategory ? categoryStyles[selectedCategory] : "bg-background"}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="" disabled>Choose category</SelectItem>{categoryOptions.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select>
            </section>
            <section className="mx-6 rounded-xl border p-4" aria-labelledby="contact-followup">
              <div className="flex items-center justify-between gap-2"><h3 id="contact-followup" className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-primary" />Next follow-up</h3><span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><AiIcon className="size-3" />AI managed</span></div>
              <p className={`mt-3 text-sm ${selectedFollowUp ? "font-medium" : "text-muted-foreground"}`}>{selectedFollowUp ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(selectedFollowUp)) : "No follow-up scheduled"}</p>
              {selectedFollowUp ? <p className="mt-1 text-[11px] text-muted-foreground">Asia/Shanghai</p> : null}
              <p className={`mt-3 text-xs leading-5 ${aiFollowUpPlans[selected.id]?.status === "error" ? "text-destructive" : "text-muted-foreground"}`} role="status">{aiFollowUpPlans[selected.id]?.status === "saving" ? "Saving AI follow-up…" : aiFollowUpPlans[selected.id]?.reason || (aiConfigured ? "AI analyzes the conversation and sets the next follow-up automatically." : "Connect an AI provider to schedule follow-ups automatically.")}</p>
              {aiFollowUpPlans[selected.id]?.status === "saved" ? <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300"><Check className="size-3" />{selectedFollowUp ? "Scheduled by AI" : "AI: no follow-up needed"}</p> : null}
            </section>
            <section className="mx-6 mt-6 border-t py-5" aria-labelledby="contact-automation">
              <div className="flex items-center justify-between gap-3"><div><h3 id="contact-automation" className="flex items-center gap-2 text-sm font-medium"><Workflow className="size-4 text-muted-foreground" />Auto follow-up</h3><p className="mt-1 text-xs text-muted-foreground">{flowEnabled ? "Automation is on" : "Automation is off"}</p></div><Toggle checked={flowEnabled} onChange={() => void toggleAutomation()} label="Toggle follow-up automation" /></div>
              <Link href="/lead-channel/ai-agent?flow=default" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary">View workflow<ChevronRight className="size-3.5" /></Link>
            </section>
            {notice ? <p className="mx-6 mb-6 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground" role="status">{notice}</p> : null}
          </div>
        </aside> : null}
      </div>
      <Dialog open={composeOpen} onOpenChange={(open) => { if (!composeSending) setComposeOpen(open); }}>
        <DialogContent className="w-[min(680px,calc(100%-2rem))] max-w-none gap-0 overflow-hidden p-0">
          <form onSubmit={sendNewEmail}>
            <DialogHeader className="border-b px-5 py-4">
              <DialogTitle>New email</DialogTitle>
              <DialogDescription>Send a new conversation through {defaultMailboxEmail || "your default mailbox"}.</DialogDescription>
            </DialogHeader>
            <div className="space-y-0 px-5 py-2">
              <label className="grid grid-cols-[64px_1fr] items-center border-b py-2 text-sm"><span className="text-muted-foreground">From</span><span className="truncate font-medium">{defaultMailboxEmail || "No mailbox selected"}</span></label>
              <label className="grid grid-cols-[64px_1fr] items-center border-b py-2 text-sm"><span className="text-muted-foreground">To</span>{companyScope ? <select required autoFocus value={composeTo} onChange={(event) => setComposeTo(event.target.value)} className="min-w-0 bg-background py-1 outline-none"><option value="">Choose customer contact</option>{companyScope.emails.filter((email) => email.trim()).map((email) => <option key={email} value={email}>{email}</option>)}</select> : <input type="email" required autoFocus value={composeTo} onChange={(event) => setComposeTo(event.target.value)} placeholder="customer@example.com" className="min-w-0 bg-transparent py-1 outline-none placeholder:text-muted-foreground/60" />}</label>
              <label className="grid grid-cols-[64px_1fr] items-center border-b py-2 text-sm"><span className="text-muted-foreground">Subject</span><input required value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)} placeholder="Email subject" className="min-w-0 bg-transparent py-1 outline-none placeholder:text-muted-foreground/60" /></label>
              <textarea required value={composeBody} onChange={(event) => setComposeBody(event.target.value)} placeholder="Write your message…" className="min-h-64 w-full resize-y bg-transparent py-4 text-sm leading-6 outline-none placeholder:text-muted-foreground/60" />
              {preferences.emailSignature ? <div className="mb-3 max-h-28 overflow-y-auto rounded-md border bg-muted/20 p-3 text-xs"><p className="mb-1 text-muted-foreground">Your signature will be appended when sending.</p><p data-no-translate className="whitespace-pre-wrap break-words">{preferences.emailSignature}</p></div> : null}
              <AttachmentChips attachments={composeAttachments} onRemove={(id) => setComposeAttachments((current) => current.filter((item) => item.id !== id))} />
              <div className="mb-2 flex items-center gap-2 border-t pt-2"><input ref={composeFileInput} type="file" multiple accept=".pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx" className="hidden" onChange={(event) => { void addFiles(event.target.files, "compose"); event.target.value = ""; }} /><button type="button" onClick={() => composeFileInput.current?.click()} disabled={attachmentBusy} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40"><Paperclip className="size-3.5" />Attach file</button><button type="button" onClick={() => openCatalogPicker("compose")} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium text-sky-700 hover:bg-sky-50 dark:text-sky-300"><Library className="size-3.5" />Add catalog PDF</button>{canCreateInvoices ? <button type="button" onClick={()=>{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(composeTo.trim())){setComposeError("Enter one customer email to view or create invoices.");return;}setInvoiceContext({email:composeTo.trim(),target:"compose"});}} className="inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300"><ReceiptText className="size-3.5" />Create invoice</button> : null}</div>
              {composeError ? <p role="alert" className="pb-3 text-xs font-medium text-red-600 dark:text-red-400">{composeError}</p> : null}
            </div>
            <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-3">
              <button type="button" onClick={() => setComposeOpen(false)} disabled={composeSending} className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-4 text-xs font-semibold hover:bg-muted disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={composeSending || attachmentBusy || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-foreground px-4 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-40"><Send className="size-4" />{composeSending ? "Sending…" : "Send email"}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {invoiceContext ? <InvoiceCreateDialog context={invoiceContext} invoiceViewer={invoiceViewer} onClose={()=>setInvoiceContext(null)} onAttach={attachInvoicePdf} /> : null}
      {catalogOpen ? <EmailCatalogDialog products={products} catalogs={catalogs} customer={catalogTarget === "reply" ? (selected?.company && !["Direct email", "Unknown company"].includes(selected.company) ? selected.company : "") : composeTo} busy={attachmentBusy} onClose={() => setCatalogOpen(false)} onAttach={attachCatalog} /> : null}
    </div>
  );
}
