"use client";
import { CustomerTagSelect } from "@/components/customer-tag-select";
import { customerTagValues, emailTagMessageKey, conversationTagKeys, conversationCustomerTag, type CustomerTag } from "@/lib/customer-tags";
import { CustomerTagBadge } from "@/components/customer-tag-badges";
import { useRouter } from "next/navigation";
import { attachmentMimeType } from "@/lib/email-files";
import { DatePicker } from "@/components/ui/date-picker";
import { EmailSyncStatus } from "@/components/email-sync-status";
import type { MailSyncHealth } from "@/lib/mail-sync-jobs";
import { usePreferences } from "@/components/preferences-provider";
import { useBackgroundRefresh } from "@/components/use-background-refresh";
import { prepareComposerMessage } from "@/lib/email-composer";
import { EmailBodyEditor, useEmailEditorValue, type EmailBodyEditorHandle } from "@/components/email-body-editor";
import { useEmailFooter } from "@/components/use-email-footer";
import { useMailDrafts } from "@/components/use-mail-drafts";
import { EmailRecipientFields } from "@/components/email-recipient-fields";
import { EmailReaderMessage } from "@/components/email-reader-message";
import { EmailFormatToolbar } from "@/components/email-format-toolbar";
import { EmailDraftStatus } from "@/components/email-draft-status";
import { emailAddresses, emailSubject, replyRecipients } from "@/lib/email-addresses";
import { hasEmailDraft, type EmailDraft as SavedEmailDraft, type ProviderDraft, type EmailSendInput } from "@/lib/email-workbench";
import { preparePastedEmailHtml } from "@/lib/email-paste";
import { sanitizeComposerHtml } from "@/lib/email-composer";
import { emailTextHtml } from "@/lib/email-markup";
import { isInlineEmailAttachment } from "@/lib/email-content";
import type { ProviderFolder } from "@/lib/email-provider";

import { useLanguage } from "@/components/language-provider";

import { AiIcon } from "@/components/ai-icon";
import { ColumnResizeHandle } from "@/components/column-resize-handle";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";

import Link from "next/link";
import dynamic from "next/dynamic";
import type { InvoiceEmailContext } from "@/components/invoice-create-dialog";
import { mergeInvoiceAttachment } from "@/lib/invoice-pdf-meta";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive, ArrowLeft, ChevronLeft, ChevronRight, PanelRight, MailOpen, CalendarClock, Check,
  Clock3, FileText, Filter, Forward, Inbox, Languages, Mail, MoreHorizontal,
  LoaderCircle, Library, Paperclip, Plus, RefreshCw, Reply, ReplyAll, Search, Send,
  Smile, Star, Trash2, Workflow, X, ReceiptText, Settings2, UserRound, UsersRound,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { InboxCalculator } from "@/components/inbox-calculator";
import { EmailCatalogDialog } from "@/components/email-catalog-dialog";
import { EmailMessageList } from "@/components/email-message-list";
import { EmailAiSummary } from "@/components/email-ai-summary";
import { EmailAutoReplyControl } from "@/components/email-auto-reply-control";
import { EmailAiTypewriter } from "@/components/email-ai-typewriter";
import "./email-workspace.css";
import "./email-ai-writing.css";
import { AssignedOwner } from "@/components/assigned-owner";
import { ContactSummary } from "@/components/contact-summary";
import { groupEmailConversations, replyReferences, replyTarget, threadKeyForEmail } from "@/lib/email-threading";
import { buildCatalogPdfWithImages } from "@/lib/catalog-pdf";
import { prepareEmailTranslation } from "@/lib/email-translation-document";
import { requestEmailTranslation } from "@/lib/email-translation-client";
import type { Catalog, Product } from "@/lib/types";
import type { CustomerProfileContext } from "@/lib/ai/email-rewrite";
import type { EmailSummary } from "@/lib/ai/email-summary";
import { emailReplyPlanSchema } from "@/lib/ai/email-reply";
import { prepareReplyInvoice } from "@/lib/email-reply-client";
import { filterCompanyEmails, type CompanyEmailScope } from "@/lib/company-email";
import type { MailboxOption } from "@/lib/mailbox-utils";

const InvoiceCreateDialog = dynamic(()=>import("@/components/invoice-create-dialog").then(module=>module.InvoiceCreateDialog));

export type EmailWorkspaceItem = {
  id: string;
  crmEmailId?: string;
  from?: string;
  to?: import("@/lib/email-addresses").EmailAddress[];
  cc?: import("@/lib/email-addresses").EmailAddress[];
  bcc?: import("@/lib/email-addresses").EmailAddress[];
  providerFolder?: string;
  providerKind?: string;
  providerLocations?: Array<{ folder: string; kind: string; mailboxKey: string; uid: number; validity: number }>;
  replyTo?: string | null;
  uid?: number;
  uidValidity?: number;
  mailboxKey?: string;
  mailboxId?: string | null;
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
  attachments?: Array<{ filename: string; contentType: string; size: number; url?: string; cid?: string; contentLocation?: string; partId?: string; inline?: boolean }>;
  timestamp: string;
  step?: string;
  demo?: boolean;
  category?: Category | null;
  starred?: boolean;
  read?: boolean;
  folder?: "inbox" | "archive" | "trash";
  followUpAt?: string | null;
};

type Folder = "inbox" | "unread" | "followup" | "all" | "drafts" | "scheduled" | "sent" | "starred" | "archive" | "trash" | "spam" | `provider:${string}`;
type SourceFilter = "all" | "shopify" | "replies" | "unread";
type Category = CustomerTag;
type Automation = { enabled: boolean; queueCount: number; steps: Array<{ id: string; title: string; delay: string; action: string; enabled: boolean }> };
type ComposerAttachment = { id: string; filename: string; content: string; contentType: string; size: number };
type MessageState = { category: Category | null; starred: boolean; read: boolean; folder: "inbox" | "archive" | "trash"; followUpAt: string | null };

function messageState(email: EmailWorkspaceItem): MessageState {
  return { category: email.category ?? null, starred: Boolean(email.starred), read: Boolean(email.read || email.direction === "outbound"), folder: email.folder ?? "inbox", followUpAt: email.followUpAt ?? null };
}

const categoryOptions = customerTagValues;

type EmailConversation = { id: string; messages: EmailWorkspaceItem[]; latest: EmailWorkspaceItem };

function buildConversations(emails: EmailWorkspaceItem[]): EmailConversation[] {
  return [...groupEmailConversations(emails).entries()].map(([id, messages]) => {
    const ordered = messages.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    return { id, messages: ordered, latest: ordered[ordered.length - 1]! };
  });
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onChange} className={`relative h-5 w-9 rounded-full ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform ${checked ? "translate-x-4" : ""}`} /></button>;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  }
  return btoa(binary);
}

async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  if (file.size > 7_500_000) throw new Error(`${file.name} is larger than the 7.5 MB attachment limit.`);
  return {
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    filename: file.name,
    content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    contentType: attachmentMimeType(file.name, file.type),
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
  followUps: Record<string, string>,
) {
  const state = folderStates[email.id] ?? "inbox";
  if (folder.startsWith("provider:")) return email.providerFolder === folder.slice(9) || Boolean(email.providerLocations?.some((item) => item.folder === folder.slice(9)));
  if (folder === "spam") return email.providerKind === "spam" && state !== "trash";
  if (email.providerKind === "spam" && folder !== "trash") return false;
  if (folder === "unread") return state === "inbox" && email.direction === "inbound" && !readMessages.has(email.id);
  if (folder === "followup") return state !== "trash" && Boolean(followUps[email.id]);
  if (folder === "all") return state !== "trash";
  if (folder === "inbox") return state === "inbox" && email.direction === "inbound" && (!email.providerKind || email.providerKind === "inbox");
  if (folder === "drafts") return state !== "trash" && email.status.toLowerCase().includes("draft");
  if (folder === "scheduled") return state !== "trash" && email.status.toLowerCase().includes("scheduled");
  if (folder === "sent") return state !== "trash" && email.direction === "outbound";
  if (folder === "starred") return state !== "trash" && starred.has(email.id);
  return folder === state;
}

function SenderSelect({ mailboxes, value, onChange, disabled, label }: { mailboxes: MailboxOption[]; value: string; onChange: (id: string) => void; disabled: boolean; label: string }) {
  return <Select value={value} onValueChange={(selectedValue) => { if (selectedValue === null) return; onChange(selectedValue); }} disabled={disabled || !mailboxes.length}><SelectTrigger aria-label={label} size="sm" className="min-w-0 max-w-full"><SelectValue /></SelectTrigger><SelectContent>
    {!value ? <SelectItem value="">No mailbox selected</SelectItem> : null}
    {(["personal", "workspace"] as const).map(type => mailboxes.some(mailbox => mailbox.type === type) ? <SelectGroup key={type}><SelectLabel>{type === "personal" ? "My email" : "Team email"}</SelectLabel>{mailboxes.filter(mailbox => mailbox.type === type).map(mailbox => <SelectItem key={mailbox.id} value={mailbox.id} disabled={!mailbox.sendConfigured}>{mailbox.email}{!mailbox.sendConfigured ? " (sending unavailable)" : ""}</SelectItem>)}</SelectGroup> : null)}
  </SelectContent></Select>;
}

export function EmailInboxWorkspace({
  initialEmails,
  initialThreadId,
  initialComposeTo,
  inboxConfigured,
  inboxError,
  lastMailboxSync,
  syncHealth: initialSyncHealth = {},
  aiConfigured,
  defaultMailboxEmail,
  mailboxes,
  selectedMailboxId,
  defaultSenderId,
  products,
  catalogs,
  canCreateInvoices = false,
  invoiceViewer,
  companyScope,
  initialAgentDraft,
  assignedCustomersOnly = false,
  onMailboxChange,
  onMailboxSnapshot,
  switchingMailboxId,
  mailboxSwitchError,
  providerFolders: initialProviderFolders = [],
}: {
  initialEmails: EmailWorkspaceItem[];
  initialThreadId?: string;
  initialComposeTo?: string;
  initialAgentDraft?: string;
  mailboxConfigured: boolean;
  sendConfigured: boolean;
  inboxConfigured: boolean;
  inboxError: string | null;
  lastMailboxSync?: string | null;
  syncHealth?: Record<string, MailSyncHealth>;
  aiConfigured: boolean;
  defaultMailboxEmail: string | null;
  mailboxes: MailboxOption[];
  selectedMailboxId: string | null;
  defaultSenderId: string | null;
  dataMode: "demo" | "live";
  initialAutomation: Automation;
  products: Product[];
  catalogs: Catalog[];
  canCreateInvoices?: boolean;
  invoiceViewer?: { id: string; role: string };
  companyScope?: CompanyEmailScope;
  assignedCustomersOnly?: boolean;
  onMailboxChange?: (mailboxId: string) => void;
  onMailboxSnapshot?: (mailboxId: string | null, emails: EmailWorkspaceItem[]) => void;
  switchingMailboxId?: string | null;
  mailboxSwitchError?: string | null;
  providerFolders?: ProviderFolder[];
}) {
  const sourceEmails = companyScope ? filterCompanyEmails(initialEmails, companyScope) : initialEmails;
  const router = useRouter();
  const { preferences } = usePreferences();
  const { footer: personalFooter, loading: footerLoading, error: footerError } = useEmailFooter();
  const { language } = useLanguage();
  const draftMailboxId = selectedMailboxId || defaultSenderId || "";
  const savedDrafts = useMailDrafts(invoiceViewer?.id || "", draftMailboxId);
  const { ready: draftsReady, put: saveDraft } = savedDrafts;
  const [providerFolders, setProviderFolders] = useState(initialProviderFolders);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [replyParentId, setReplyParentId] = useState<string | null>(null);
  const [replyAll, setReplyAll] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyCc, setReplyCc] = useState<string | null>(null);
  const [replyBcc, setReplyBcc] = useState("");
  const [replyDraftId, setReplyDraftId] = useState("");
  const [replyRequestId, setReplyRequestId] = useState("");
  const [composeDraftId, setComposeDraftId] = useState("");
  const [composeRequestId, setComposeRequestId] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeProviderDraft, setComposeProviderDraft] = useState<ProviderDraft | undefined>();
  const [scheduleAt, setScheduleAt] = useState("");
  const [replyScheduleOpen, setReplyScheduleOpen] = useState(false);
  const [composeScheduleAt, setComposeScheduleAt] = useState("");
  const [composeScheduleOpen, setComposeScheduleOpen] = useState(false);
  const [scheduledEmails, setScheduledEmails] = useState<Array<{ id: string; status: string; scheduled_at: string; payload: EmailSendInput; error?: string }>>([]);
  const [scheduledError, setScheduledError] = useState("");
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
  const [searchResults, setSearchResults] = useState<EmailWorkspaceItem[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const { text: draft, html: draftHtml, bodyText: replyBodyText, hasImages: replyHasImages, setText: setDraft, onChange: editReply } = useEmailEditorValue();
  const [replyMediaBusy, setReplyMediaBusy] = useState(false);
  const [composeMediaBusy, setComposeMediaBusy] = useState(false);
  const [replySenderId, setReplySenderId] = useState(defaultSenderId ?? "");
  const [composeSenderId, setComposeSenderId] = useState(defaultSenderId ?? "");
  const replySender = mailboxes.find((mailbox) => mailbox.id === replySenderId);
  const composeSender = mailboxes.find((mailbox) => mailbox.id === composeSenderId);
  const [composeOpen, setComposeOpen] = useState(Boolean(initialComposeTo));
  const [composeTo, setComposeTo] = useState(initialComposeTo || "");
  const [composeSubject, setComposeSubject] = useState("");
  const { text: composeBody, html: composeHtml, bodyText: composeBodyText, hasImages: composeHasImages, setText: setComposeBody, onChange: editCompose } = useEmailEditorValue();
  const [composeThread, setComposeThread] = useState<{ to: string; threadId?: string; inReplyTo?: string; references?: string[] } | null>(null);
  useEffect(() => {
    if (composeOpen && savedDrafts.ready && !composeDraftId) { setComposeDraftId(crypto.randomUUID()); setComposeRequestId(crypto.randomUUID()); }
  }, [composeOpen, savedDrafts.ready, composeDraftId]);
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
  const [folderStates, setFolderStates] = useState<Record<string, "inbox" | "archive" | "trash">>(() => Object.fromEntries(sourceEmails.map((email) => [email.id, email.folder ?? "inbox"])));
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(inboxError);
  const [syncHealth, setSyncHealth] = useState<Record<string, MailSyncHealth>>(initialSyncHealth);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState(lastMailboxSync);
  const [syncing, setSyncing] = useState(false);
  const syncInProgress = useRef(false);
  const bodyRequests = useRef(new Set<string>());
  const [loadingBodies, setLoadingBodies] = useState<Set<string>>(new Set());
  const [bodyErrors, setBodyErrors] = useState<Record<string, string>>({});
  const aiRequestId = useRef(0);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const replyFileInput = useRef<HTMLInputElement>(null);
  const composeFileInput = useRef<HTMLInputElement>(null);
  const replyInput = useRef<EmailBodyEditorHandle>(null);
  const composeInput = useRef<EmailBodyEditorHandle>(null);
  const replyPayload = useRef<{ fingerprint: string; id: string } | null>(null);
  const composePayload = useRef<{ fingerprint: string; id: string } | null>(null);
  const replySession = useRef(0);
  const stateRevision = useRef(0);
  const pendingStateWrites = useRef(0);
  const savedStates = useRef(new Map(sourceEmails.map((email) => [email.id, messageState(email)])));
  const stateWrites = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    onMailboxSnapshot?.(selectedMailboxId, emails.map((email) => ({
      ...email,
      starred: starred.has(email.id), read: readMessages.has(email.id),
      category: categories[email.id] ?? null, folder: folderStates[email.id] ?? "inbox", followUpAt: followUps[email.id] ?? null,
    })));
  }, [onMailboxSnapshot, selectedMailboxId, emails, starred, readMessages, categories, folderStates, followUps]);

  useEffect(() => { unsentDraft.current = Boolean(composeTo.trim() || composeSubject.trim() || composeBody.trim() || draft.trim() || replyHasImages || composeHasImages || composeAttachments.length || replyAttachments.length); }, [composeTo, composeSubject, composeBody, draft, replyHasImages, composeHasImages, composeAttachments.length, replyAttachments.length]);
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
        for (const [index, attachment] of (prepared.attachments ?? []).entries()) {
          attachments.push({ ...attachment, id: `agent-${id}-${index}` });
        }
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
        if (prepared.mailboxId) setComposeSenderId(prepared.mailboxId);
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
  }, [initialAgentDraft, setComposeBody]);

  const applyMailboxSnapshot = useCallback((nextEmails: EmailWorkspaceItem[]) => {
    if (companyScope) nextEmails = filterCompanyEmails(nextEmails, companyScope);
    savedStates.current = new Map([...savedStates.current, ...nextEmails.map((email): [string, MessageState] => [email.id, messageState(email)])]);
    setEmails((current) => {
      const loaded = new Map(current.filter((email) => email.bodyLoaded).map((email) => [email.id, email]));
      return nextEmails.map((email) => {
        const previous = loaded.get(email.id);
        const sameLocation = previous && email.uid === previous.uid && email.uidValidity === previous.uidValidity && email.mailboxKey === previous.mailboxKey && email.providerFolder === previous.providerFolder;
        return email.bodyLoaded === false && previous && sameLocation ? { ...email, body: previous.body, html: previous.html, preview: previous.preview, attachments: previous.attachments,
          from: previous.from, to: previous.to, cc: previous.cc, bcc: previous.bcc, replyTo: previous.replyTo, bodyLoaded: true } : email;
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

  const syncInbox = useCallback(async (manual = false, refreshRequested = false) => {
    if (!inboxConfigured || syncInProgress.current) return;
    syncInProgress.current = true;
    setSyncing(true);
    const revision = stateRevision.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const params = new URLSearchParams();
      if (!manual && !refreshRequested) params.set("refresh", "false");
      if (selectedMailboxId && !companyScope) params.set("mailboxId", selectedMailboxId);
      if (manual) params.set("scope", "history");
      const providerFolder = folder.startsWith("provider:") ? folder.slice(9) : providerFolders.find((item) => item.kind === folder)?.path;
      if (providerFolder && providerFolder !== "INBOX") params.set("providerFolder", providerFolder);
      if (companyScope) params.set("companyId", companyScope.id);
      const response = await fetch(`/api/email/inbox?${params}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json().catch(() => ({ error: "The inbox returned an invalid response." }));
      if (!response.ok || !Array.isArray(result.emails)) {
        throw new Error(result.error || "Unable to sync the mailbox inbox.");
      }
      if (Array.isArray(result.providerFolders)) setProviderFolders(result.providerFolders);
      if (result.syncHealth) setSyncHealth(result.syncHealth);
      setLastSuccessfulSync(result.lastMailboxSync || null);
      // A poll started before a user action must not undo that action.
      if (revision !== stateRevision.current || pendingStateWrites.current) return;
      applyMailboxSnapshot(result.emails as EmailWorkspaceItem[]);
      setSyncError(result.syncQueueError || null);
      if (manual) setNotice("Loading the next batch of older emails. They will appear automatically as they are imported.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync the mailbox inbox.";
      setSyncError(message);
      if (manual) setNotice(message);
    } finally {
      clearTimeout(timeout);
      syncInProgress.current = false;
      setSyncing(false);
    }
  }, [applyMailboxSnapshot, companyScope, inboxConfigured, selectedMailboxId, folder, providerFolders]);

  useBackgroundRefresh(syncInbox, inboxConfigured, preferences.emailSyncSeconds);

  useEffect(() => {
    const query = search.trim();
    setSearchResults([]); setSearchStatus("");
    if (query.length < 2 || !selectedMailboxId || companyScope) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchStatus("Searching provider…");
      const params = new URLSearchParams({ q: query, mailboxId: selectedMailboxId, folder: folder.startsWith("provider:") ? folder.slice(9) : ["inbox", "sent", "archive", "trash", "spam"].includes(folder) ? folder : "all" });
      void fetch(`/api/email/search?${params}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!controller.signal.aborted) { setSearchResults(result.emails || []); setSearchStatus(result.error || (result.limited ? "Showing up to 50 matches per folder. Refine your search for more." : "Provider search complete")); } }).catch((reason) => { if (!controller.signal.aborted) setSearchStatus(reason instanceof Error ? reason.message : "Provider search failed."); });
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, selectedMailboxId, companyScope, folder]);
  const conversations = useMemo(() => buildConversations([...new Map([...searchResults, ...emails].map((email) => [email.id, email])).values()]), [emails, searchResults]);
  const visibleCategories = useMemo(() => {
    const next = { ...categories };
    for (const email of searchResults) {
      if (Object.hasOwn(next, email.id)) continue;
      const saved = savedStates.current.get(email.id);
      const category = saved ? saved.category : email.category;
      if (category) next[email.id] = category;
    }
    return next;
  }, [categories, searchResults]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesFolder = conversation.messages.some((email) => emailMatchesFolder(email, folder, folderStates, starred, readMessages, followUps))
        || (folder === "unread" && mobileReading && conversation.messages.some((email) => email.id === selectedId && emailMatchesFolder(email, "inbox", folderStates, starred, readMessages, followUps)));
      const matchesCategory = !categoryFilter || conversationCustomerTag(conversation.messages, visibleCategories) === categoryFilter;
      const matchesSource = sourceFilter === "all"
        || (sourceFilter === "shopify" && conversation.messages.some((email) => email.source === "shopify"))
        || (sourceFilter === "replies" && conversation.messages.some((email) => email.direction === "inbound" && email.source !== "shopify"))
        || (sourceFilter === "unread" && conversation.messages.some((email) => email.id === selectedId || (email.direction === "inbound" && !readMessages.has(email.id))));
      const searchable = conversation.messages.map((email) => `${email.subject} ${email.contactName || ""} ${email.contact} ${email.company} ${email.preview} ${email.body} ${(email.to || []).map((item) => item.address).join(" ")} ${(email.attachments || []).map((item) => item.filename).join(" ")}`).join(" ").toLowerCase();
      return matchesFolder && matchesCategory && matchesSource && (!query || searchable.includes(query) || searchResults.some((message) => conversation.messages.some((item) => item.id === message.id)));
    }).sort((a, b) => new Date(b.latest.timestamp).getTime() - new Date(a.latest.timestamp).getTime());
  }, [visibleCategories, categoryFilter, conversations, folder, folderStates, mobileReading, readMessages, search, selectedId, sourceFilter, starred, searchResults, followUps]);
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
  const [composerConversationId, setComposerConversationId] = useState<string | undefined>();
  const draftConversationKey = selectedConversation?.messages[0] ? threadKeyForEmail(selectedConversation.messages[0]) : undefined;
  if (savedDrafts.ready && composerConversationId !== draftConversationKey) {
    // Also covers selection changes caused by search, folders, filters and sync.
    setComposerConversationId(draftConversationKey);
    const retained = Object.values(savedDrafts.drafts).find((item) => item.kind === "reply" && item.threadId === draftConversationKey);
    setReplyExpanded(Boolean(companyScope) || Boolean(retained));
    editReply(retained?.text || "", retained?.html || "", retained?.bodyText || "");
    setReplyDraftId(retained?.id || crypto.randomUUID());
    setReplyRequestId(retained?.requestId || crypto.randomUUID());
    setReplyParentId(retained?.parentId || null);
    setReplyAll(retained?.replyAll || false);
    setReplyTo(retained?.to ?? null); setReplyCc(retained?.cc ?? null); setReplyBcc(retained?.bcc || "");
    setScheduleAt(""); setReplyScheduleOpen(false);
    if (retained?.senderId) setReplySenderId(retained.senderId);
    setAiDraft("");
    setAiDraftSource("");
    setAiWriting(false);
    setAiWritingError(null);
    setReplyAttachments(retained?.attachments.map((item) => ({ ...item, contentType: item.contentType || "application/octet-stream" })) || []);
    setAiReplyInvoiceId(null);
    setNotice(null);
  }
  const conversation = useMemo(() => selectedConversation?.messages ?? [], [selectedConversation]);
  const target = replyTarget(conversation);
  const explicitParent = conversation.find((message) => message.id === replyParentId);
  const replyParent = explicitParent || target?.parent;
  const automaticRecipients = replyParent ? replyRecipients(replyParent, mailboxes.map((mailbox) => mailbox.email || ""), replyAll) : { to: [], cc: [] };
  const replyRecipient = replyTo ?? (automaticRecipients.to.join(", ") || target?.recipient || selected?.contact || "");
  const effectiveReplyCc = replyCc ?? automaticRecipients.cc.join(", ");
  useEffect(() => {
    if (!draftsReady || !composerConversationId || !replyDraftId || !draftMailboxId || invoiceViewer?.role === "viewer") return;
    const value: SavedEmailDraft = { id: replyDraftId, mailboxId: draftMailboxId, senderId: replySenderId, kind: "reply", threadId: composerConversationId, to: replyRecipient, cc: effectiveReplyCc, bcc: replyBcc, subject: selected?.subject || "", text: draft, html: draftHtml, bodyText: replyBodyText, parentId: replyParent?.id, replyAll, attachments: replyAttachments, requestId: replyRequestId, revision: 0 };
    if (hasEmailDraft(value)) saveDraft(value);
  }, [draftsReady, saveDraft, composerConversationId, replyDraftId, draftMailboxId, replySenderId, replyRecipient, effectiveReplyCc, replyBcc, selected?.subject, draft, draftHtml, replyBodyText, replyParent?.id, replyAll, replyAttachments, replyRequestId, invoiceViewer?.role]);
  useEffect(() => {
    if (!draftsReady || !composeDraftId || !draftMailboxId || invoiceViewer?.role === "viewer") return;
    const value: SavedEmailDraft = { id: composeDraftId, mailboxId: draftMailboxId, senderId: composeSenderId, kind: "compose", to: composeTo, cc: composeCc, bcc: composeBcc, subject: composeSubject, text: composeBody, html: composeHtml, bodyText: composeBodyText, attachments: composeAttachments, requestId: composeRequestId, revision: 0, threadId: composeThread?.threadId, inReplyTo: composeThread?.inReplyTo, references: composeThread?.references, replyAll: false, providerDraft: composeProviderDraft };
    if (hasEmailDraft(value)) saveDraft(value);
  }, [draftsReady, saveDraft, composeDraftId, draftMailboxId, composeSenderId, composeTo, composeCc, composeBcc, composeSubject, composeBody, composeHtml, composeBodyText, composeAttachments, composeRequestId, composeThread, composeProviderDraft, invoiceViewer?.role]);

  useEffect(() => {
    if (folder !== "scheduled") return;
    let cancelled = false;
    const refresh = async () => {
      try { const response = await fetch("/api/email/scheduled", { cache: "no-store" }); const result = await response.json(); if (!response.ok) throw new Error(result.error); if (!cancelled) { setScheduledEmails(result.emails); setScheduledError(""); } }
      catch (reason) { if (!cancelled) setScheduledError(reason instanceof Error ? reason.message : "Unable to load scheduled emails."); }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [folder]);
  const loadMessage = useCallback(async (email: EmailWorkspaceItem) => {
    if ((!email.crmEmailId && (!email.uid || !email.uidValidity || !email.mailboxKey)) || bodyRequests.current.has(email.id)) return;
    bodyRequests.current.add(email.id);
    setLoadingBodies((current) => new Set(current).add(email.id));
    setBodyErrors((current) => { const next = { ...current }; delete next[email.id]; return next; });
    try {
      const params = new URLSearchParams({ uid: String(email.uid), validity: String(email.uidValidity), mailbox: email.mailboxKey || "", folder: email.providerFolder || "INBOX" });
      const response = await fetch(email.crmEmailId ? `/api/email/crm-message?id=${encodeURIComponent(email.crmEmailId)}` : `/api/email/message?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.email) throw new Error(result.error || "Unable to load this message.");
      setEmails((current) => current.map((message) => message.id === email.id ? { ...message, ...result.email, mailboxKey: email.mailboxKey } : message));
      setSearchResults((current) => current.map((message) => message.id === email.id ? { ...message, ...result.email, mailboxKey: email.mailboxKey } : message));
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
  const selectedCategory = conversationCustomerTag(conversation, visibleCategories);
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
    const source = replyBodyText.trim();
    if (!aiReplyOn || replyHasImages || !aiConfigured || source.length < 2) {
      setAiWriting(false);
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
  }, [language, aiConfigured, aiReplyOn, replyHasImages, aiRetryNonce, conversationContext, replyBodyText, selectedConversation?.id, selected?.contact, selected?.contactName, selected?.customerProfile, selected?.ownerId, selected?.ownerName]);

  useEffect(() => {
    replySession.current += 1;
    conversationScroll.current?.scrollTo({ top: 0 });
  }, [selectedConversation?.id]);

  const aiPreviewVisible = aiReplyOn && !replyHasImages && draft.trim().length >= 2 && Boolean(aiWriting || aiDraft || aiWritingError || aiConfigured);
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
    const counts: Record<Folder, number> = { inbox: 0, unread: 0, followup: 0, all: 0, drafts: 0, scheduled: scheduledEmails.length, sent: 0, starred: 0, archive: 0, trash: 0, spam: 0 };
    for (const item of providerFolders.filter((item) => item.kind === "custom")) counts[`provider:${item.path}`] = 0;
    const folders = Object.keys(counts) as Folder[];
    for (const item of conversations) {
      for (const targetFolder of folders) {
        if (item.messages.some((email) => emailMatchesFolder(email, targetFolder, folderStates, starred, readMessages, followUps))) {
          counts[targetFolder] += 1;
        }
      }
    }
    counts.drafts += Object.values(savedDrafts.drafts).length;
    return counts;
  }, [followUps, conversations, folderStates, starred, readMessages, savedDrafts.drafts, providerFolders, scheduledEmails.length]);

  async function persistState(id: string, override: Partial<MessageState>) {
    stateRevision.current += 1;
    pendingStateWrites.current += 1;
    const email = emails.find((item) => item.id === id) || searchResults.find((item) => item.id === id);
    const previousWrite = stateWrites.current.get(id);
    const write = (async () => {
      await previousWrite?.catch(() => undefined);
      const state = { ...(savedStates.current.get(id) ?? (email ? messageState(email) : { category: null, starred: false, read: false, folder: "inbox" as const, followUpAt: null })), ...override };
      const tagConversation = Object.hasOwn(override, "category") ? conversations.find(item => item.messages.some(message => message.id === id)) : undefined;
      const tagKeys = tagConversation ? conversationTagKeys(tagConversation.messages) : [];
      const response = await fetch("/api/email/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageKey: id,
          ...state,
          categoryWrite: Object.hasOwn(override, "category"),
          tagMessageKey: tagKeys[0] ?? (email ? emailTagMessageKey(email) : id),
          ...(tagKeys.length ? { tagConversationKeys: tagKeys, tagMessageKeys: tagConversation!.messages.map(emailTagMessageKey) } : {}),
          contactEmail: email?.contact.includes("@") ? email.contact : undefined,
          threadId: tagConversation?.id ?? email?.threadId ?? null,
          ...(email?.uid && email.uidValidity && email.mailboxKey ? { provider: { mailboxKey: email.mailboxKey, uid: email.uid, validity: email.uidValidity, folder: email.providerFolder || "INBOX", read: override.read, starred: override.starred, destination: override.folder } } : {}),
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
    setScheduleAt(""); setReplyScheduleOpen(false);
  }

  function updateDraft(value: string, html: string, bodyText = value) {
    if (!replyParentId && replyParent) setReplyParentId(replyParent.id);
    editReply(value, html, bodyText);
    setAiWritingError(null);
    if (bodyText.trim().length >= 2) return;
    aiRequestId.current += 1;
    setAiDraft("");
    setAiDraftSource("");
    setAiWriting(false);
    setAiWritingError(null);
  }

  function replyToMessage(message: EmailWorkspaceItem, all = false) {
    const recipients = replyRecipients(message, mailboxes.map((mailbox) => mailbox.email || ""), all);
    setReplyParentId(message.id); setReplyAll(all);
    setReplyTo(recipients.to.join(", ")); setReplyCc(recipients.cc.join(", ")); setReplyBcc("");
    const sender = mailboxes.find((mailbox) => mailbox.id === message.mailboxId && mailbox.sendConfigured)
      || mailboxes.find((mailbox) => message.to?.some((item) => item.address.toLowerCase() === mailbox.email?.toLowerCase()) && mailbox.sendConfigured);
    if (sender) setReplySenderId(sender.id);
    startReply();
  }

  function resumeDraft(value: SavedEmailDraft) {
    if (value.kind === "reply") {
      const thread = conversations.find((item) => item.messages.some((message) => threadKeyForEmail(message) === value.threadId || message.id === value.parentId));
      if (thread) { setFolder("all"); setSelectedId(thread.latest.id); setMobileReading(true); return; }
    }
    setComposeDraftId(value.id); setComposeRequestId(value.requestId); setComposeTo(value.to); setComposeCc(value.cc); setComposeBcc(value.bcc);
    setComposeSubject(value.subject); editCompose(value.text, value.html, value.bodyText);
    setComposeThread(value.inReplyTo || value.threadId ? { to: value.to, threadId: value.threadId, inReplyTo: value.inReplyTo, references: value.references } : null);
    setComposeProviderDraft(value.providerDraft);
    setComposeAttachments(value.attachments.map((item) => ({ ...item, contentType: item.contentType || "application/octet-stream" })));
    if (value.senderId) setComposeSenderId(value.senderId);
    if (value.id !== composeDraftId) { setComposeScheduleAt(""); setComposeScheduleOpen(false); }
    setComposeOpen(true);
  }

  async function editScheduledEmail(value: { id: string; payload: EmailSendInput }) {
    try {
      const response = await fetch("/api/email/scheduled", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: value.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setScheduledEmails((current) => current.filter((item) => item.id !== value.id));
      const message = value.payload;
      const html = (message.html || "").replace(/cid:([^\s"'<>]+)/g, (original, cid) => {
        const image = message.attachments.find((attachment) => attachment.cid === cid);
        return image ? `data:${image.contentType};base64,${image.content}` : original;
      });
      resumeDraft({ id: crypto.randomUUID(), mailboxId: draftMailboxId, senderId: message.mailboxId, kind: "compose", to: message.to.join(", "), cc: message.cc.join(", "), bcc: message.bcc.join(", "), subject: message.subject, text: message.text, bodyText: message.text, html, replyAll: false, threadId: message.threadId, inReplyTo: message.inReplyTo, references: message.references, providerDraft: message.providerDraft, requestId: crypto.randomUUID(), revision: 0, attachments: message.attachments.filter((attachment) => !attachment.cid).map((attachment) => ({ ...attachment, id: crypto.randomUUID(), size: Math.floor(attachment.content.length * 3 / 4) })) });
      setComposeScheduleAt(""); setComposeScheduleOpen(false);
    } catch (reason) { setScheduledError(reason instanceof Error ? reason.message : "Unable to edit this scheduled email."); }
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

  async function setCategory(category: Category | null) {
    if (!selected || !selectedConversation) return;
    const messages = selectedConversation.messages;
    try {
      await persistState(selected.id, { category });
      for (const message of messages) savedStates.current.set(message.id, { ...(savedStates.current.get(message.id) ?? messageState(message)), category });
      setCategories((current) => { const next = { ...current }; for (const message of messages) { if (category) next[message.id] = category; else delete next[message.id]; } return next; });
      setNotice(category ? `Tag changed to ${category}.` : "Tag removed.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save tag.");
    }
  }

  async function applyAiFollowUp(summary: EmailSummary) {
    if (!selected) return;
    const messageId = selected.id;
    const { followUpAt } = summary;
    // Clear reminders on earlier messages so thread-level lookup cannot resurrect them.
    const previousReminders = conversation.filter((message) => message.id !== messageId && followUps[message.id]);
    await persistState(messageId, { followUpAt });
    for (const message of previousReminders) await persistState(message.id, { followUpAt: null });
    setFollowUps((current) => {
      const next = { ...current };
      for (const message of previousReminders) delete next[message.id];
      if (followUpAt) next[messageId] = followUpAt;
      else delete next[messageId];
      return next;
    });
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
    if (!selected || aiReplyInProgress.current || attachmentBusy || sending || draft.trim() || replyHasImages || replyMediaBusy) return;
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
        if (!message.crmEmailId && (!message.uid || !message.uidValidity || !message.mailboxKey)) throw new Error("Load the conversation messages before generating a reply.");
        const params = new URLSearchParams({ uid: String(message.uid), validity: String(message.uidValidity), mailbox: message.mailboxKey || "", folder: message.providerFolder || "INBOX" });
        const response = await fetch(message.crmEmailId ? `/api/email/crm-message?id=${encodeURIComponent(message.crmEmailId)}` : `/api/email/message?${params}`, { cache: "no-store" });
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
    if (replyScheduleOpen && (!scheduleAt || !Number.isFinite(Date.parse(scheduleAt)) || Date.parse(scheduleAt) <= Date.now())) {
      setNotice("Choose a future date and time to schedule this email.");
      return;
    }
    if (footerError || footerLoading) { setNotice(footerError || "Your email footer is loading. Please try again."); return; }
    if (invoiceViewer?.role === "viewer") { setNotice("Viewer access is read-only"); return; }
    if (!selected || (!replyBodyText.trim() && !replyHasImages) || sending || (aiWriting && !replyHasImages) || replyMediaBusy) return;
    const session = replySession.current;
    if (attachmentBusy) return;
    const useAiDraft = aiReplyOn && !replyHasImages && aiDraft && aiDraftSource === draft.trim();
    const trimmedDraft = useAiDraft ? aiDraft.trim() : draft.trim();
    const recipient = replyRecipient;
    const parent = replyParent ?? selected;
    if (parent.bodyLoaded === false) {
      void loadMessage(parent);
      setNotice("The customer's email is loading. Review it before sending your reply.");
      return;
    }

    if (/\battach(?:ed|ing)?\b[^.!?\n]{0,80}\bcatalog\b|\bcatalog\b[^.!?\n]{0,80}\battach(?:ed|ing)?\b/i.test(trimmedDraft) && !replyAttachments.some((attachment) => attachment.contentType === "application/pdf")) {
      setNotice("This message says a catalog is attached. Add the catalog PDF before sending.");
      return;
    }

    if (!replySender?.sendConfigured) {
      setNotice("Choose an active sender with SMTP configured, or update your mailbox in Settings.");
      return;
    }

    if (!recipient.includes("@")) {
      setNotice("This contact does not have a valid email address yet, so the CRM cannot send a live email.");
      return;
    }

    try {
      const fingerprint = JSON.stringify([replySenderId, recipient, effectiveReplyCc, replyBcc, trimmedDraft, draftHtml, replyAttachments, parent.messageId]);
      const requestId = replyPayload.current?.fingerprint === fingerprint ? replyPayload.current.id : replyPayload.current ? crypto.randomUUID() : replyRequestId || crypto.randomUUID();
      replyPayload.current = { fingerprint, id: requestId }; setReplyRequestId(requestId);
      const message = prepareComposerMessage(trimmedDraft, useAiDraft ? "" : draftHtml, preferences.emailSignature, replyInput.current?.currentFooter() || personalFooter, requestId);
      if (message.attachments.length + replyAttachments.length > 10) throw new Error("An email supports up to 10 images and attachments combined.");
      setSending(true);
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxId: replySenderId,
          to: recipient,
          cc: effectiveReplyCc, bcc: replyBcc,
          requestId, draftId: replyDraftId,
          ...(scheduleAt ? { scheduleAt: new Date(scheduleAt).toISOString() } : {}),
          subject: emailSubject(parent.subject, "reply"),
          text: message.text,
          html: message.html,
          footerIncluded: true,
          attachments: [...replyAttachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })), ...message.attachments],
          threadId: selectedConversation?.id,
          inReplyTo: parent.messageId || undefined,
          references: replyReferences(parent),
        }),
      });

      const result = await response.json().catch(() => ({ ok: false, error: "Unable to send the email." }));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Unable to send the email.");
      }
      window.dispatchEvent(new Event("email-auto-reply-updated"));
      const saved = savedDrafts.get(replyDraftId); if (saved) savedDrafts.remove(saved);
      setReplyDraftId(crypto.randomUUID()); setReplyRequestId(crypto.randomUUID()); replyPayload.current = null;
      if (result.scheduled) { setDraft(""); setReplyAttachments([]); setScheduleAt(""); setReplyScheduleOpen(false); setNotice(`Email scheduled for ${new Date(result.scheduleAt).toLocaleString()}.`); return; }

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
      if (companyScope || reply.mailboxId === selectedMailboxId) setEmails((current) => [reply, ...current]);
      if (session !== replySession.current) return;
      setDraft("");
      setAiDraft("");
      setAiDraftSource("");
      setReplyAttachments([]);
      setNotice(result.providerWarning || (result.saved ? `Email sent successfully from ${result.sentVia}.` : "Email sent, but its CRM history could not be saved. Check the recipient's mailbox for the attachment."));
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
    if (!composeDraftId) { setComposeDraftId(crypto.randomUUID()); setComposeRequestId(crypto.randomUUID()); setComposeProviderDraft(undefined); }
    setComposeOpen(true);
  }

  async function forwardSelected(message = selected, editingDraft = false) {
    if (!message || attachmentBusy) return;
    const session = replySession.current;
    setAttachmentBusy(true);
    try {
      let original = message;
      if (original.bodyLoaded === false && (original.crmEmailId || original.uid && original.uidValidity && original.mailboxKey)) {
        const params = new URLSearchParams({ mailbox: original.mailboxKey || "", uid: String(original.uid), validity: String(original.uidValidity), folder: original.providerFolder || "INBOX" });
        const response = await fetch(original.crmEmailId ? `/api/email/crm-message?id=${encodeURIComponent(original.crmEmailId)}` : `/api/email/message?${params}`); const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load the forwarded message.");
        original = { ...original, ...result.email };
      }
      const header = `---------- Forwarded message ----------\nFrom: ${original.from || original.contact}\nDate: ${new Date(original.timestamp).toLocaleString()}\nSubject: ${original.subject}\nTo: ${(original.to || []).map((item) => item.address).join(", ")}\n${original.cc?.length ? `Cc: ${original.cc.map((item) => item.address).join(", ")}\n` : ""}`;
      const prepared = await preparePastedEmailHtml(sanitizeComposerHtml(original.html || `<div>${emailTextHtml(original.body)}</div>`, document, true), document, [], fetch, { importRemoteImages: false });
      if (prepared.missing) throw new Error("Some forwarded images could not be copied. Retry after loading the original message.");
      const files: ComposerAttachment[] = [];
      for (const attachment of original.attachments?.filter((item) => !isInlineEmailAttachment(item, original.html)) || []) {
        if (!attachment.url) throw new Error(`${attachment.filename} is unavailable.`);
        const response = await fetch(attachment.url);
        if (!response.ok) throw new Error(`Unable to copy ${attachment.filename}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length > 7_500_000) throw new Error(`${attachment.filename} exceeds the 7.5 MB attachment limit.`);
        files.push({ id: crypto.randomUUID(), filename: attachment.filename, contentType: attachment.contentType, size: bytes.length, content: bytesToBase64(bytes) });
      }
      if (files.length > 10) throw new Error("This forwarded email has more than 10 attachments. Forward it from your provider's app.");
      if (session !== replySession.current) return;
      setComposeDraftId(crypto.randomUUID()); setComposeRequestId(crypto.randomUUID()); composePayload.current = null;
      const to = editingDraft ? (original.to || []).map((item) => item.address).join(", ") : "";
      setComposeTo(to); setComposeCc(editingDraft ? (original.cc || []).map((item) => item.address).join(", ") : ""); setComposeBcc(editingDraft ? (original.bcc || []).map((item) => item.address).join(", ") : "");
      setComposeThread(editingDraft && original.inReplyTo ? { to, threadId: original.threadId || undefined, inReplyTo: original.inReplyTo, references: original.references } : null);
      setComposeSubject(editingDraft ? original.subject : emailSubject(original.subject, "forward"));
      setComposeProviderDraft(editingDraft && original.uid && original.uidValidity && original.mailboxKey ? { mailboxKey: original.mailboxKey, uid: original.uid, validity: original.uidValidity, folder: original.providerFolder || "INBOX" } : undefined);
      setComposeScheduleAt(""); setComposeScheduleOpen(false);
      editCompose(editingDraft ? original.body : `\n\n${header}\n${original.body}`, editingDraft ? prepared.html : `<div><br><br>${emailTextHtml(header)}</div>${prepared.html}`);
      setComposeAttachments(files); setComposeError(null); setComposeOpen(true);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "Unable to prepare this forward."); }
    finally { setAttachmentBusy(false); }
  }

  async function sendNewEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composeScheduleOpen && (!composeScheduleAt || !Number.isFinite(Date.parse(composeScheduleAt)) || Date.parse(composeScheduleAt) <= Date.now())) {
      setComposeError("Choose a future date and time to schedule this email.");
      return;
    }
    if (footerError || footerLoading) { setComposeError(footerError || "Your email footer is loading. Please try again."); return; }
    if (invoiceViewer?.role === "viewer") { setComposeError("Viewer access is read-only"); return; }
    if (attachmentBusy || composeSending || composeMediaBusy) return;
    const to = composeTo.trim();
    const subject = composeSubject.trim();
    const text = composeBody.trim();
    if (companyScope && [...emailAddresses(to), ...emailAddresses(composeCc), ...emailAddresses(composeBcc)].some((contact) => !filterCompanyEmails([{ contact }], companyScope).length)) {
      setComposeError("Choose one of this company's saved contact email addresses.");
      return;
    }
    if (/\battach(?:ed|ing)?\b[^.!?\n]{0,80}\bcatalog\b|\bcatalog\b[^.!?\n]{0,80}\battach(?:ed|ing)?\b/i.test(text) && !composeAttachments.some((attachment) => attachment.contentType === "application/pdf")) {
      setComposeError("This message says a catalog is attached. Add the catalog PDF before sending.");
      return;
    }
    if (!composeSender?.sendConfigured) {
      setComposeError("Choose an active sender with SMTP configured, or update your mailbox in Settings.");
      return;
    }
    if (!to || (!composeBodyText.trim() && !composeHasImages)) {
      setComposeError("Enter a recipient, subject, and message.");
      return;
    }

    try {
      const fingerprint = JSON.stringify([composeSenderId, to, composeCc, composeBcc, subject, text, composeHtml, composeAttachments]);
      const requestId = composePayload.current?.fingerprint === fingerprint ? composePayload.current.id : composePayload.current ? crypto.randomUUID() : composeRequestId || crypto.randomUUID();
      composePayload.current = { fingerprint, id: requestId }; setComposeRequestId(requestId);
      const message = prepareComposerMessage(text, composeHtml, preferences.emailSignature, personalFooter, requestId);
      if (message.attachments.length + composeAttachments.length > 10) throw new Error("An email supports up to 10 images and attachments combined.");
      setComposeSending(true);
      setComposeError(null);
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: composeSenderId, to, cc: composeCc, bcc: composeBcc, subject, text: message.text, html: message.html, footerIncluded: true, requestId, draftId: composeDraftId, providerDraft: composeProviderDraft, ...(composeScheduleOpen && composeScheduleAt ? { scheduleAt: new Date(composeScheduleAt).toISOString() } : {}), ...(composeThread?.to === to ? { threadId: composeThread.threadId, inReplyTo: composeThread.inReplyTo, references: composeThread.references } : {}), attachments: [...composeAttachments.map(({ filename, content, contentType }) => ({ filename, content, contentType })), ...message.attachments] }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Unable to send the email." }));
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to send the email.");
      const saved = savedDrafts.get(composeDraftId); if (saved) savedDrafts.remove(saved);
      if (result.scheduled) { setComposeOpen(false); setComposeDraftId(""); setComposeTo(""); setComposeCc(""); setComposeBcc(""); setComposeSubject(""); setComposeBody(""); setComposeAttachments([]); setComposeScheduleAt(""); setComposeScheduleOpen(false); setNotice(`Email scheduled for ${new Date(result.scheduleAt).toLocaleString()}.`); return; }

      const sentEmail: EmailWorkspaceItem = result.email;
      stateRevision.current += 1;
      if (companyScope || sentEmail.mailboxId === selectedMailboxId) {
        setEmails((current) => [sentEmail, ...current]);
        setFolderStates((current) => ({ ...current, [sentEmail.id]: "inbox" }));
        setSelectedId(sentEmail.id);
        setFolder("sent");
        setMobileReading(true);
      }
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeThread(null);
      setComposeAttachments([]);
      setComposeOpen(false);
      setComposeScheduleAt(""); setComposeScheduleOpen(false);
      setComposeCc(""); setComposeBcc(""); setComposeDraftId(""); setComposeRequestId(""); composePayload.current = null;
      setNotice(result.providerWarning || (result.saved ? `Email sent successfully from ${result.sentVia}.` : "Email sent, but its CRM history could not be saved. Check the recipient's mailbox for the attachment."));
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "The CRM could not send this email.");
    } finally {
      setComposeSending(false);
    }
  }

  const replyEditorDisabled = aiReplyBusy || sending || footerLoading || !savedDrafts.ready;
  const replyDraftNeedsRetry = savedDrafts.status !== "Draft saved" && !/^(Saving|Loading) drafts?/.test(savedDrafts.status);
  const replySendHint = !savedDrafts.ready ? "Loading your draft…" : footerLoading ? "Loading your email footer…" : aiReplyBusy ? "Preparing your reply…" : attachmentBusy || replyMediaBusy ? "Preparing attachments…" : !replySender?.sendConfigured ? "Choose a configured sender." : !replyRecipient.trim() ? "Add a recipient to send." : !replyBodyText.trim() && !replyHasImages ? "Write a message to send." : replyScheduleOpen && !scheduleAt ? "Choose a send date and time." : "";
  const folderItems: Array<{ id: Folder; label: string; icon: typeof Inbox }> = [
    { id: "inbox", label: "Inbox", icon: Inbox }, { id: "followup", label: "Needs follow-up", icon: CalendarClock }, { id: "unread", label: "Unread", icon: MailOpen }, { id: "all", label: "All mail", icon: Mail },
    { id: "drafts", label: "Drafts", icon: FileText }, { id: "scheduled", label: "Scheduled", icon: Clock3 },
    { id: "sent", label: "Sent", icon: Send }, { id: "starred", label: "Starred", icon: Star },
    { id: "archive", label: "Archive", icon: Archive }, { id: "spam", label: "Spam", icon: Inbox }, { id: "trash", label: "Trash", icon: Trash2 },
  ];
  const sourceFilters: Array<{ id: SourceFilter; label: string }> = [
    { id: "all", label: "All messages" },
    { id: "shopify", label: "Shopify leads" },
    { id: "replies", label: "Mailbox email" },
    { id: "unread", label: "Unread" },
  ];

  for (const item of providerFolders.filter((item) => item.kind === "custom")) folderItems.push({ id: `provider:${item.path}`, label: item.name, icon: Inbox });
  return (
    <div data-ai-mailbox-id={selectedMailboxId || undefined} data-ai-email-id={reading ? selected?.id : undefined} data-ai-company-id={reading ? selected?.companyId || undefined : companyScope?.id} className={`email-workspace flex min-w-0 flex-col overflow-hidden bg-background ${companyScope ? "company-email-workspace h-[clamp(520px,calc(100dvh-14rem),900px)] rounded-xl border" : "h-[calc(100dvh-3rem)]"}`}>
      {companyScope ? <h3 className="sr-only">Customer mailbox</h3> : <h1 className="sr-only">Email</h1>}
      {!companyScope ? <nav aria-label="Email accounts" className="flex shrink-0 flex-wrap items-center gap-3 border-b p-3 sm:flex-nowrap">
        <div className="flex min-w-0 flex-1 gap-5 overflow-x-auto">
        {(["personal", "workspace"] as const).map(type => mailboxes.some(mailbox => mailbox.type === type) ? <div key={type} className="flex shrink-0 items-center gap-2.5"><span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">{type === "personal" ? <UserRound className="size-3.5" /> : <UsersRound className="size-3.5" />}{type === "personal" ? "My email" : "Team email"}</span><div className="flex gap-1">
        {mailboxes.filter(mailbox => mailbox.type === type).map((mailbox) => <Link key={mailbox.id} href={`/email?mailbox=${encodeURIComponent(mailbox.id)}`} prefetch={false} aria-label={`${type === "personal" ? "My email" : "Team email"}: ${mailbox.email}`} aria-current={selectedMailboxId === mailbox.id ? "page" : undefined} aria-busy={switchingMailboxId === mailbox.id} onNavigate={(event) => {
          if (sending || composeSending || attachmentBusy || aiReplyBusy || pendingStateWrites.current || savedDrafts.status === "Saving draft…") { event.preventDefault(); setNotice("Wait for the current operation or draft save before switching mailboxes."); return; }
          if (onMailboxChange) { event.preventDefault(); onMailboxChange(mailbox.id); return; }
          if (mailbox.id === selectedMailboxId) event.preventDefault();
        }} className={`flex max-w-72 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${selectedMailboxId === mailbox.id ? "border-primary/30 bg-primary/5 font-medium text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
          {switchingMailboxId === mailbox.id ? <LoaderCircle className="size-3 shrink-0 animate-spin" /> : <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${mailbox.inboxConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />}<span className="truncate">{mailbox.email}{!mailbox.inboxConfigured ? " · Sync unavailable" : ""}</span>
        </Link>)}
        </div></div> : null)}
        {!mailboxes.length ? <span className="text-sm text-muted-foreground">Connect an email account to get started.</span> : null}
        </div>
        <Link href={`/settings/apps?view=${mailboxes.find(mailbox => mailbox.id === selectedMailboxId)?.type === "workspace" ? "team" : "personal"}`} onNavigate={event => { if (sending || composeSending || attachmentBusy || aiReplyBusy || pendingStateWrites.current || savedDrafts.status === "Saving draft…") { event.preventDefault(); setNotice("Wait for the current operation or draft save before managing connections."); } }} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted"><Settings2 className="size-3.5" />{mailboxes.length ? "Manage connections" : "Connect email"}</Link>
      </nav> : null}
      {switchingMailboxId ? <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">Switching mailbox…</p> : null}
      {mailboxSwitchError ? <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">{mailboxSwitchError}</p> : null}
      {assignedCustomersOnly && !companyScope ? <p className="border-b px-4 py-2 text-xs text-muted-foreground">Your team inbox shows emails from customers assigned to you. My email shows all senders in your personal accounts.</p> : null}

      <div className="mail-layout" data-reading={reading} data-details={detailsOpen} inert={Boolean(switchingMailboxId)} aria-busy={Boolean(switchingMailboxId)}>
        {!companyScope ? <ColumnResizeHandle label="Email folders width" variable="--mail-folder-width" container=".mail-layout" panel=".mail-folders" min={160} max={360} className="mail-folder-resize" /> : null}
        <ColumnResizeHandle label="Conversation list width" variable="--mail-list-width" container=".mail-layout" panel=".mail-list" min={220} max={600} storageKey={companyScope ? "company-mail-list" : "mail-list"} className="mail-list-resize" />
        {selected && !companyScope ? <ColumnResizeHandle label="Contact details width" variable="--mail-details-width" container=".mail-layout" panel=".mail-details" min={280} max={560} reverse className="mail-details-resize" /> : null}
        {!companyScope ? <aside className="mail-folders min-h-0 flex-col border-r bg-muted/20" aria-label="Email folders">
          <div className="p-3"><button type="button" onClick={openComposer} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground text-xs font-semibold text-background hover:bg-foreground/90"><Plus className="size-4" />New email</button></div>
          <nav className="space-y-1 px-2 py-1">
            {folderItems.map((item) => <button key={item.id} type="button" onClick={() => changeFolder(item.id)} aria-current={folder === item.id ? "page" : undefined} className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-xs font-medium ${folder === item.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><item.icon className={`size-4 ${folder === item.id ? "text-primary" : ""}`} /><span className="flex-1 text-left">{item.label}</span><span className="text-xs">{folderCounts[item.id]}</span></button>)}
          </nav>
          <div className="mx-4 my-4 h-px bg-border" />
          <div className="px-5"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Workflow</p><div className="mt-3 rounded-lg border bg-background p-3"><p className="flex items-center gap-2 text-xs font-semibold"><Workflow className="size-4 text-violet-600" />Follow-up workflow</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">Automatically continue conversations that need attention.</p><Link href="/workflow?flow=default" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Open builder →</Link></div></div>
        </aside> : null}

        <section className="mail-list" aria-label="Email list">
{companyScope ? <div className="space-y-3 border-b p-4">
  <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Conversations <span className="ml-1 font-normal text-muted-foreground">{conversations.length}</span></h3><div className="flex items-center gap-1"><button type="button" aria-label="Refresh customer emails" title="Refresh" disabled={syncing || !inboxConfigured} onClick={() => void syncInbox(false, true)} className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} /></button><button type="button" onClick={openComposer} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-medium text-background"><Plus className="size-3.5" />New email</button></div></div>
  <div className="mail-search" role="search"><Search className="size-4 shrink-0 text-muted-foreground" /><input aria-label="Search customer emails" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X className="size-3.5" /></button> : null}</div>
  <div className="flex gap-1" aria-label="Customer email filter">{([{ id: "all", label: "All" }, { id: "unread", label: "Unread" }] as const).map((item) => <button key={item.id} type="button" aria-pressed={folder === item.id} onClick={() => changeFolder(item.id)} className={"rounded-md px-3 py-1 text-xs font-medium " + (folder === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}>{item.label}</button>)}</div>
</div> : <>
          <div className="border-b p-3"><label className="mail-folder-select mb-3 items-center gap-2 text-xs">Folder<Select value={folder} onValueChange={(value) => { if (value === null) return; return changeFolder(value as Folder); }}><SelectTrigger aria-label="Email folder" size="sm" className="min-w-0 flex-1"><SelectValue /></SelectTrigger><SelectContent>{folderItems.map((item) => <SelectItem key={item.id} value={item.id}>{item.label} ({folderCounts[item.id]})</SelectItem>)}</SelectContent></Select></label>
            <div className="mb-2 flex items-center justify-between px-1"><div><h2 className="text-sm font-semibold">{folderItems.find((item) => item.id === folder)?.label}</h2>{categoryFilter ? <p className="text-xs text-muted-foreground">{categoryFilter}</p> : null}</div><DropdownMenu><DropdownMenuTrigger aria-label="Filter email by tag" className={`rounded-md p-2 outline-none hover:bg-muted ${categoryFilter ? "text-primary" : "text-muted-foreground"}`}><Filter className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-72"><DropdownMenuGroup><DropdownMenuLabel>Filter by tag</DropdownMenuLabel></DropdownMenuGroup><DropdownMenuItem onClick={() => setCategoryFilter(null)}>{!categoryFilter ? <Check /> : <span className="size-4" />}All tags</DropdownMenuItem><DropdownMenuSeparator />{categoryOptions.map((category) => <DropdownMenuItem key={category} onClick={() => setCategoryFilter(category)}>{categoryFilter === category ? <Check /> : <span className="size-4" />}<CustomerTagBadge tag={category} /></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>
            <div className="mail-search" role="search" aria-label="Search mailbox"><Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><input aria-label="Search email" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer mail" />{search ? <button type="button" onClick={() => setSearch("")} aria-label="Clear email search" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button> : null}</div>
            <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5" aria-label="Filter inbox by message source">{sourceFilters.map((item) => <button key={item.id} type="button" aria-pressed={sourceFilter === item.id} onClick={() => { setSourceFilter(item.id); setSelectedId(""); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${sourceFilter === item.id ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300" : "bg-background text-muted-foreground hover:bg-muted"}`}>{item.label}</button>)}</div>
          </div>
          <div className="flex min-h-11 flex-wrap items-center gap-2 border-b px-3 text-xs">
            <input type="checkbox" aria-label="Select all conversations on this page" checked={allPageChecked} onChange={() => setCheckedIds((current) => { const next = new Set(current); for (const item of pageItems) { if (allPageChecked) next.delete(item.id); else next.add(item.id); } return next; })} />
            {checkedVisible.length ? <><span>{checkedVisible.length} selected</span><button type="button" disabled={bulkBusy} title="Mark selected as read" onClick={() => void bulkUpdate({ read: true })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><MailOpen className="size-4" /></button><button type="button" disabled={bulkBusy} title="Mark selected as unread" onClick={() => void bulkUpdate({ read: false })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Mail className="size-4" /></button><button type="button" disabled={bulkBusy} title={folder === "trash" || folder === "archive" ? "Restore selected to inbox" : "Archive selected"} onClick={() => void bulkUpdate({ folder: folder === "trash" || folder === "archive" ? "inbox" : "archive" })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Archive className="size-4" /></button><button type="button" disabled={bulkBusy} title="Move selected to trash" onClick={() => void bulkUpdate({ folder: "trash" })} className="rounded p-2 hover:bg-muted disabled:opacity-40"><Trash2 className="size-4" /></button></> : <><button type="button" title="Refresh inbox" disabled={syncing || !inboxConfigured} onClick={() => void syncInbox(false, true)} className="rounded p-2 hover:bg-muted disabled:opacity-40"><RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} /></button><span className="text-muted-foreground">{visible.length} conversations</span></>}
          </div>
          <div className="mail-header-compose border-b px-3 py-2"><button type="button" onClick={openComposer} className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-xs font-semibold text-background"><Plus className="size-4" />New email</button></div>

</>}
          {inboxConfigured ? <EmailSyncStatus health={Object.values(syncHealth)} lastSuccessAt={lastSuccessfulSync} error={syncError} /> : null}
          {searchStatus ? <p role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">{searchStatus}</p> : null}
          {!companyScope && !["drafts", "scheduled"].includes(folder) && !Object.values(syncHealth).some((item) => item.history !== "idle" || item.historyComplete) ? <button type="button" disabled={syncing || !inboxConfigured} onClick={() => void syncInbox(true)} className="border-b px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted disabled:opacity-40">Load older emails</button> : null}
          {notice ? <p role="status" className="border-b bg-muted/30 px-3 py-2 text-xs">{notice}</p> : null}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
{folder === "drafts" ? <div className="divide-y">{Object.values(savedDrafts.drafts).length ? Object.values(savedDrafts.drafts).map((value) => <div key={value.id} className="flex items-center gap-3 px-4 py-4"><button type="button" onClick={() => resumeDraft(value)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-medium">{value.subject || "(No subject)"}</span><span className="block truncate text-xs text-muted-foreground">{value.to || "No recipient"} · {value.bodyText.slice(0, 100)}</span></button><button type="button" onClick={() => { savedDrafts.remove(value); if (value.id === composeDraftId) { setComposeDraftId(""); setComposeTo(""); setComposeCc(""); setComposeBcc(""); setComposeBody(""); setComposeSubject(""); setComposeAttachments([]); setComposeProviderDraft(undefined); } }} aria-label={"Discard draft " + value.subject} className="rounded p-2 text-muted-foreground"><Trash2 className="size-4" /></button></div>) : <p className="p-5 text-sm text-muted-foreground">No saved drafts.</p>}<EmailMessageList emptyIcon={FileText} conversations={pageItems} categories={visibleCategories} compact={reading} activeId={selectedConversation?.id} checked={checkedIds} readMessages={readMessages} starred={starred} onCheck={() => undefined} onOpen={openConversation} onStar={toggleStar} /></div> : folder === "scheduled" ? <div className="divide-y">{scheduledError ? <p role="alert" className="p-4 text-xs text-red-600">{scheduledError}</p> : null}{scheduledEmails.map((value) => <div key={value.id} className="p-4"><p className="font-medium">{value.payload.subject || "(No subject)"}</p><p className="mt-1 text-xs text-muted-foreground">{value.payload.to?.join(", ")} · {new Date(value.scheduled_at).toLocaleString()} · {value.status}</p>{value.error ? <p className="mt-2 text-xs text-red-600">{value.error}</p> : null}{value.status === "scheduled" ? <button type="button" className="mt-2 text-xs underline" onClick={async () => { const response = await fetch("/api/email/scheduled", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: value.id }) }); const result = await response.json(); if (response.ok) setScheduledEmails((current) => current.filter((item) => item.id !== value.id)); else setScheduledError(result.error); }}>Cancel scheduled send</button> : null}{["scheduled", "failed"].includes(value.status) ? <button type="button" className="ml-4 mt-2 text-xs underline" onClick={() => void editScheduledEmail(value)}>Edit scheduled email</button> : null}</div>)}{!scheduledEmails.length && !scheduledError ? <p className="p-5 text-sm text-muted-foreground">No scheduled emails.</p> : null}</div> : <>
            <EmailMessageList emptyIcon={folderItems.find((item) => item.id === folder)?.icon} conversations={pageItems} categories={visibleCategories} compact={Boolean(companyScope) || reading} simple={Boolean(companyScope)} activeId={reading ? selectedConversation?.id : undefined} checked={checkedIds} readMessages={readMessages} starred={starred} onCheck={(id) => setCheckedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openConversation} onStar={toggleStar} /></>}

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
{companyScope ? <div className="border-b px-6 py-5"><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h2 className="min-w-0 text-lg font-semibold leading-7">{selected.subject}</h2><CustomerTagSelect value={selectedCategory} disabled={invoiceViewer?.role === "viewer"} onChange={setCategory} /></div><p className="mt-1 text-xs text-muted-foreground">{selectedConversation?.messages.length} {selectedConversation?.messages.length === 1 ? "message" : "messages"} in this conversation</p></div> : <>
            <div className="flex min-h-20 shrink-0 items-center justify-between gap-3 border-b bg-background px-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-2"><h2 className="min-w-0 text-base font-semibold">{selected.subject}</h2><CustomerTagSelect value={selectedCategory} disabled={invoiceViewer?.role === "viewer"} onChange={setCategory} /></div><p className="mt-1 text-xs text-muted-foreground">{selected.direction === "inbound" ? "From" : "To"} {selected.contact} · {selected.company}</p></div><div className="flex items-center gap-3"><AssignedOwner imageUrl={selected.ownerAvatarUrl} name={selected.ownerName || "Unassigned"} initials={selected.ownerInitials || "—"} assigned={Boolean(selected.ownerId)} compact className="hidden lg:inline-flex" /><div className="flex items-center gap-1"><button type="button" title={starred.has(selected.id) ? "Remove star" : "Star email"} onClick={() => toggleStar(selected.id)} className={`rounded-md p-2 hover:bg-muted ${starred.has(selected.id) ? "text-amber-500" : "text-muted-foreground"}`}><Star className="size-4" fill={starred.has(selected.id) ? "currentColor" : "none"} /></button><button type="button" title="Archive" onClick={() => void moveSelected("archive")} className="rounded-md p-2 text-muted-foreground hover:bg-muted"><Archive className="size-4" /></button><DropdownMenu><DropdownMenuTrigger aria-label="More email actions" className="rounded-md p-2 text-muted-foreground outline-none hover:bg-muted"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuGroup><DropdownMenuLabel>Email actions</DropdownMenuLabel></DropdownMenuGroup><DropdownMenuItem onClick={() => replyParent && replyToMessage(replyParent)}><Reply />Reply</DropdownMenuItem><DropdownMenuItem onClick={() => replyParent && replyToMessage(replyParent, true)}><ReplyAll />Reply all</DropdownMenuItem><DropdownMenuItem onClick={() => void forwardSelected()}><Forward />Forward</DropdownMenuItem><DropdownMenuSeparator />{conversation.some((message) => folderStates[message.id] && folderStates[message.id] !== "inbox") ? <DropdownMenuItem onClick={() => void moveSelected("inbox")}><Inbox />Move to inbox</DropdownMenuItem> : null}<DropdownMenuItem variant="destructive" onClick={() => void moveSelected("trash")}><Trash2 />Move to trash</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div></div>
            <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-5 py-2 text-xs text-muted-foreground"><Languages className="size-3.5" /><span>Auto-translate to Chinese</span><Toggle checked={translationOn} onChange={() => setTranslationOn((value) => !value)} label="Toggle email translation" /></div>

</>}
            <div ref={conversationScroll} className="mail-conversation min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth px-5 py-5"><div className="mx-auto max-w-3xl space-y-6">{conversation.map((message, index) => <EmailReaderMessage key={message.id}
  email={translationOn && message.direction === "inbound" && translations[message.id] ? { ...message, ...translations[message.id] } : message}
  expanded={expandedMessages.has(message.id) || (index === conversation.length - 1 && !expandedMessages.has("closed:" + message.id))}
  starred={starred.has(message.id)} loading={loadingBodies.has(message.id)} error={bodyErrors[message.id]}
  onToggle={() => { const expanding = !expandedMessages.has(message.id) && (index !== conversation.length - 1 || expandedMessages.has("closed:" + message.id)); setExpandedMessages((current) => { const next = new Set(current); if (expanding) { next.add(message.id); next.delete("closed:" + message.id); } else { next.delete(message.id); next.add("closed:" + message.id); } return next; }); if (expanding && message.bodyLoaded === false) void loadMessage(message); }}
  onLoad={() => void loadMessage(message)} onReply={(all) => replyToMessage(message, all)} onForward={() => void forwardSelected(message)} onEditDraft={() => void forwardSelected(message, true)} onStar={() => void toggleStar(message.id)} />)}
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
            <div className="mail-reply-panel shrink-0 border-t bg-background" data-expanded={replyExpanded} role="region" aria-label="Reply composer">
              <ColumnResizeHandle label="Reply area height" variable="--mail-reply-height" container=".mail-reader" panel=".mail-reply-panel" min={360} max={700} reverse orientation="horizontal" className={replyExpanded ? "mail-reply-resize" : "hidden"} />
              <div className="mail-reply-content min-h-0 flex-1 overflow-y-auto p-3">
              {!replyExpanded ? <div className="flex items-center gap-2"><button type="button" onClick={startReply} className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/20 px-3 text-left text-xs text-muted-foreground"><Reply className="size-4 shrink-0" /><span className="truncate">Quick reply to {replyRecipient}</span></button><button type="button" onClick={() => void generateAiReply()} disabled={aiReplyBusy || attachmentBusy || sending} className="inline-flex h-11 items-center gap-2 rounded-md border px-3 text-xs text-violet-600"><AiIcon className="size-4" />AI reply</button></div> : <>
              <div className="mb-2 flex shrink-0 items-center justify-between gap-2 text-xs"><span className="font-semibold">{replyAll ? "Reply all" : "Reply"}</span><div className="flex items-center gap-1">
                <Popover><PopoverTrigger aria-label="AI reply options" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-violet-600 hover:bg-muted"><AiIcon className="size-3.5" state={aiReplyBusy || aiUpdating ? "thinking" : "idle"} />AI tools<ChevronRight className="size-3 rotate-90" /></PopoverTrigger>
                  <PopoverContent align="end" side="top" className="mail-ai-tools w-80 max-w-[calc(100vw-2rem)] max-h-[min(28rem,var(--available-height))] overflow-y-auto p-3">
                    <PopoverTitle>AI reply tools</PopoverTitle>
                    {invoiceViewer?.role !== "viewer" ? <EmailAutoReplyControl key={`${target?.parent.mailboxId ?? selectedMailboxId}:${target?.parent.messageId}`} mailboxId={target?.parent.mailboxId ?? selectedMailboxId} senderId={target?.parent.mailboxId ?? selectedMailboxId ?? undefined} messageId={target?.parent.messageId} references={[...new Set(conversation.flatMap(replyReferences))].slice(0, 100)} onManualReply={startReply} /> : null}
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-md border bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><AiIcon state={aiUpdating ? "thinking" : "idle"} />AI writing<Toggle checked={aiReplyOn} onChange={() => { if (!aiReplyBusy) toggleAiWriting(); }} label="Toggle AI writing" /></div>
                  {!aiConfigured ? <span className="text-xs text-amber-700">AI provider not configured — suggestions remain available</span> : null}
                </div>
                {aiReplyOn ? <div className="mb-2 flex gap-2 overflow-x-auto"><span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-600"><AiIcon className="size-3.5" />Suggestions</span>{["Send pricing + MOQ", "Confirm shipping details", "Schedule a follow-up"].map((item) => <button key={item} type="button" onClick={() => setDraft(item === "Send pricing + MOQ" ? `Hi ${(selected.contactName || selected.customerProfile?.contactName || selected.contact).split(" ")[0]},\n\nThanks for your message. I’ll send our current wholesale pricing and minimum order quantities for your review.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : item === "Confirm shipping details" ? `Hi ${(selected.contactName || selected.customerProfile?.contactName || selected.contact).split(" ")[0]},\n\nWe can prepare a shipping quote. Could you confirm the delivery postcode and expected quantity?\n\nBest,\n${defaultMailboxEmail || "Filazoo"}` : `Hi ${(selected.contactName || selected.customerProfile?.contactName || selected.contact).split(" ")[0]},\n\nI’ll follow up with you shortly with the latest availability and next steps.\n\nBest,\n${defaultMailboxEmail || "Filazoo"}`)} className="shrink-0 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground">{item}</button>)}</div> : null}
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><button type="button" disabled={aiReplyBusy || attachmentBusy || sending || Boolean(draft.trim() || replyHasImages)} onClick={() => void generateAiReply()} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-violet-600 disabled:opacity-40"><AiIcon className="size-3.5" state={aiReplyBusy ? "thinking" : "idle"} />{aiReplyBusy ? "Preparing reply & PDFs?" : "AI reply"}</button>{aiReplyInvoiceId ? <Link href={`/invoices/${aiReplyInvoiceId}`} target="_blank" className="font-medium text-emerald-700 underline">Review draft invoice</Link> : null}</div>
                  </PopoverContent>
                </Popover>
                <button type="button" aria-label="Collapse reply" title="Collapse reply" disabled={sending} onClick={() => setReplyExpanded(false)} className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"><X className="size-4" /></button>
              </div></div>
              <div className="mail-reply-editor overflow-hidden rounded-lg border bg-background">
                <div className="mail-reply-scroll px-3 sm:px-4">
                  <div className="mail-reply-recipient-header">
                    <EmailRecipientFields key={`recipients:${replyDraftId}`} to={replyRecipient} cc={effectiveReplyCc} bcc={replyBcc} onTo={setReplyTo} onCc={setReplyCc} onBcc={setReplyBcc} disabled={sending} prefix="Reply " sender={<div className="mail-reply-sender flex min-w-0 items-center gap-2 py-1.5"><span className="shrink-0 text-xs text-muted-foreground">From</span><div className="min-w-0"><SenderSelect mailboxes={mailboxes} value={replySenderId} onChange={setReplySenderId} disabled={sending} label="Reply sender email" /></div></div>} />
                  </div>
                  <EmailBodyEditor key={replyDraftId} ref={replyInput} value={draft} html={draftHtml} signature={preferences.emailSignature} footer={personalFooter} onChange={updateDraft} onError={setNotice} onBusyChange={setReplyMediaBusy} attachmentCount={replyAttachments.length} disabled={replyEditorDisabled} bodyEmpty={personalFooter?.html ? !replyBodyText.trim() && !replyHasImages : undefined} compactSignature label="Reply message" placeholder="Write your reply…" className="min-h-40 py-3 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />
                  <AttachmentChips attachments={replyAttachments} onRemove={(id) => setReplyAttachments((current) => current.filter((item) => item.id !== id))} />
                </div>
                <div className="mail-reply-footer shrink-0 border-t bg-muted/20 px-3 py-2">
                  {replyDraftNeedsRetry ? <div className="mb-2"><EmailDraftStatus status={savedDrafts.status} onRetry={() => void savedDrafts.retry()} disabled={sending} /></div> : null}
                  {footerError ? <p role="alert" className="mb-2 rounded-md bg-destructive/10 px-2.5 py-2 text-xs text-destructive">{footerError}</p> : null}
                  {notice ? <div role="status" className="mb-2 flex items-start gap-2 rounded-md bg-muted px-2.5 py-2 text-xs leading-5"><span className="min-w-0 flex-1 break-words">{/Unable to load saved mailbox:|column .* does not exist/i.test(notice) ? "Mailbox sync is temporarily unavailable. Your reply is still open." : notice}</span><button type="button" aria-label="Dismiss reply notice" title="Dismiss notice" onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 hover:bg-background"><X className="size-3.5" /></button></div> : null}
                  <div className="mail-reply-actions flex items-center gap-1.5">
                    <input ref={replyFileInput} type="file" multiple disabled={sending || attachmentBusy} className="hidden" onChange={(event) => { void addFiles(event.target.files, "reply"); event.target.value = ""; }} />
                    <button type="button" disabled={attachmentBusy || sending} title="Attach files" aria-label="Attach files" onClick={() => replyFileInput.current?.click()} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"><Paperclip className="size-4" /></button>
                    <Popover>
                      <PopoverTrigger aria-label="More reply options" title="Formatting and more options" disabled={sending} onMouseDown={(event) => event.preventDefault()} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"><MoreHorizontal className="size-4" /></PopoverTrigger>
                      <PopoverContent align="start" side="top" className="w-64 max-w-[calc(100vw-2rem)] max-h-[min(28rem,var(--available-height))] overflow-y-auto p-3">
                        <PopoverTitle>Reply options</PopoverTitle>
                        <p className="text-xs text-muted-foreground">Text formatting</p>
                        <EmailFormatToolbar editor={replyInput} disabled={replyEditorDisabled} />
                        <div className="grid gap-1 border-t pt-2">
                          <button type="button" disabled={attachmentBusy || sending} onClick={() => openCatalogPicker("reply")} className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted disabled:opacity-40"><Library className="size-4" />Add catalog PDF</button>
                          {canCreateInvoices ? <button type="button" disabled={attachmentBusy || sending} onClick={() => setInvoiceContext({companyId:selected.companyId,email:replyRecipient,threadId:selectedConversation?.id,customerName:selected.company,target:"reply"})} className="flex h-9 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted disabled:opacity-40"><ReceiptText className="size-4" />Customer invoices</button> : null}
                          <div className="flex items-center gap-2"><button type="button" disabled={replyEditorDisabled} onMouseDown={(event) => event.preventDefault()} onClick={() => replyInput.current?.insertText(String.fromCodePoint(0x1f60a))} className="flex h-9 flex-1 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted disabled:opacity-40"><Smile className="size-4" />Add emoji</button><InboxCalculator /></div>
                        </div>
                        <button type="button" disabled={sending || aiReplyBusy} onClick={() => { const saved = savedDrafts.get(replyDraftId); if (saved) savedDrafts.remove(saved); clearReplyComposer(); setReplyDraftId(crypto.randomUUID()); setReplyRequestId(crypto.randomUUID()); replyPayload.current = null; }} className="flex h-9 items-center gap-2 rounded-md border-t px-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"><Trash2 className="size-4" />Discard draft</button>
                      </PopoverContent>
                    </Popover>
                    {!replyDraftNeedsRetry ? <div className="mail-reply-save-status min-w-0 flex-1"><EmailDraftStatus status={savedDrafts.status} onRetry={() => void savedDrafts.retry()} disabled={sending} /></div> : <span className="flex-1" />}
                    {replySendHint ? <span id="reply-send-help" className="sr-only">{replySendHint}</span> : null}
                    <div className="ml-auto inline-flex shrink-0 items-stretch">
                      <button type="button" onClick={saveReply} title={replySendHint || (replyScheduleOpen ? "Schedule send" : "Send email")} aria-describedby={replySendHint ? "reply-send-help" : undefined} disabled={(!replyBodyText.trim() && !replyHasImages) || !replyRecipient.trim() || sending || (aiWriting && !replyHasImages) || attachmentBusy || replyMediaBusy || replyEditorDisabled || Boolean(footerError) || !replySender?.sendConfigured || (replyScheduleOpen && !scheduleAt)} className="inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-l-md bg-foreground px-3 text-xs font-semibold text-background hover:bg-foreground/90 disabled:opacity-40">{sending ? <LoaderCircle className="size-4 animate-spin" /> : replyScheduleOpen ? <CalendarClock className="size-4" /> : <Send className="size-4" />}{sending ? "Sending…" : aiWriting ? "Writing…" : replyScheduleOpen ? "Schedule send" : !replyHasImages && aiDraft && aiDraftSource === draft.trim() ? "Send AI draft" : "Send email"}</button>
                      <Popover>
                        <PopoverTrigger aria-label="Send options" title="Send later" disabled={sending} className="flex w-8 items-center justify-center rounded-r-md border-l border-background/25 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"><ChevronRight className="size-3.5 rotate-90" /></PopoverTrigger>
                        <PopoverContent align="end" side="top" className="w-72 max-w-[calc(100vw-2rem)] p-3">
                          <PopoverTitle>Send options</PopoverTitle>
                          <label className="inline-flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={replyScheduleOpen} disabled={sending} onChange={(event) => { setReplyScheduleOpen(event.target.checked); if (!event.target.checked) setScheduleAt(""); }} className="size-4 accent-primary" /><CalendarClock className="size-4" />Send later</label>
                          {replyScheduleOpen ? <><DatePicker includeTime aria-label="Reply scheduled send time" aria-describedby="reply-schedule-help" value={scheduleAt} disabled={sending} onValueChange={value => setScheduleAt(value)} className="min-w-0 max-w-full rounded-md border bg-background px-2.5 py-2 text-sm" /><span id="reply-schedule-help" className="text-xs text-muted-foreground">Your local time</span></> : null}
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
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
            <section className="mx-6 mb-6 rounded-xl border p-4" aria-labelledby="contact-flow">
              <h3 id="contact-flow" className="flex items-center gap-2 text-sm font-semibold"><Workflow className="size-4 text-primary" />Automation workflow</h3>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Customize follow-ups and actions for this email address or its company. Manage these workflows here from Email.</p>
              <Link href={`/email/workflows?${new URLSearchParams({ recipient: selected.contact, ...(selected.companyId ? { companyId: selected.companyId } : {}), ...(selectedConversation?.id ? { thread: selectedConversation.id } : {}), ...(selectedMailboxId ? { mailbox: selectedMailboxId } : {}) })}`} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">Open workflow builder<ChevronRight className="size-3.5" /></Link>
            </section>
            {notice ? <p className="mx-6 mb-6 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground" role="status">{notice}</p> : null}
          </div>
        </aside> : null}
      </div>
      <Dialog open={composeOpen} onOpenChange={(open) => { if (!composeSending) setComposeOpen(open); }}>
        <DialogContent className="mail-compose-dialog gap-0 overflow-hidden p-0">
          <form onSubmit={sendNewEmail} className="mail-compose-form">
            <DialogHeader className="shrink-0 border-b px-5 py-4 sm:px-6">
              <DialogTitle>New email</DialogTitle>
              <DialogDescription className="sr-only">Compose an email, add attachments, and send now or schedule for later.</DialogDescription>
            </DialogHeader>
            <div className="mail-compose-content px-5 sm:px-6">
              <div className="grid min-h-12 grid-cols-[64px_minmax(0,1fr)] items-center border-b py-2 text-sm"><span className="text-muted-foreground">From</span><div className="min-w-0"><SenderSelect mailboxes={mailboxes} value={composeSenderId} onChange={setComposeSenderId} disabled={composeSending} label="New email sender" /></div></div>
<EmailRecipientFields to={composeTo} cc={composeCc} bcc={composeBcc} onTo={setComposeTo} onCc={setComposeCc} onBcc={setComposeBcc} disabled={composeSending} prefix="New email " />
              <label className="grid min-h-12 grid-cols-[64px_minmax(0,1fr)] items-center border-b py-2 text-sm"><span className="text-muted-foreground">Subject</span><input value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)} disabled={composeSending} placeholder="Add a subject" className="min-w-0 rounded-sm bg-transparent py-1 outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring" /></label>
              <div className="sticky top-0 z-10 -mx-1 border-b bg-popover py-2"><EmailFormatToolbar editor={composeInput} disabled={composeSending || footerLoading || !savedDrafts.ready} /></div>
              <EmailBodyEditor key={composeDraftId} ref={composeInput} value={composeBody} html={composeHtml} signature={preferences.emailSignature} footer={personalFooter} onChange={editCompose} onError={setComposeError} onBusyChange={setComposeMediaBusy} attachmentCount={composeAttachments.length} disabled={composeSending || footerLoading || !savedDrafts.ready} bodyEmpty={personalFooter?.html ? !composeBodyText.trim() && !composeHasImages : undefined} compactSignature label="New email message" placeholder="Write your message…" className="min-h-56 py-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" />
              <AttachmentChips attachments={composeAttachments} onRemove={(id) => setComposeAttachments((current) => current.filter((item) => item.id !== id))} />
              <div className="mail-compose-tools flex flex-wrap items-center gap-2 border-t py-3">
                <input ref={composeFileInput} type="file" multiple className="hidden" disabled={composeSending || attachmentBusy} onChange={(event) => { void addFiles(event.target.files, "compose"); event.target.value = ""; }} />
                <button type="button" onClick={() => composeFileInput.current?.click()} disabled={attachmentBusy || composeSending} className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"><Paperclip className="size-4 shrink-0" />Attach files</button>
                <button type="button" onClick={() => openCatalogPicker("compose")} disabled={attachmentBusy || composeSending} className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"><Library className="size-4 shrink-0" />Add catalog PDF</button>
                {canCreateInvoices ? <button type="button" disabled={attachmentBusy || composeSending} onClick={()=>{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(composeTo.trim())){setComposeError("Enter one customer email to view or create invoices.");return;}setInvoiceContext({email:composeTo.trim(),target:"compose"});}} className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"><ReceiptText className="size-4 shrink-0" />Create invoice</button> : null}
              </div>
              <div className="border-t py-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={composeScheduleOpen} disabled={composeSending} onChange={(event) => { setComposeScheduleOpen(event.target.checked); if (!event.target.checked) setComposeScheduleAt(""); }} className="size-4 accent-primary" /><CalendarClock className="size-4" />Send later</label>
                {composeScheduleOpen ? <div className="mt-3 flex flex-wrap items-center gap-2"><DatePicker includeTime required aria-label="New email scheduled send time" aria-describedby="compose-schedule-help" value={composeScheduleAt} disabled={composeSending} onValueChange={value => setComposeScheduleAt(value)} className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring" /><span id="compose-schedule-help" className="text-xs text-muted-foreground">Your local time</span></div> : null}
              </div>
            </div>
            <div className="shrink-0 border-t bg-muted/30 px-5 py-3 sm:px-6">
              <div className="mb-3"><EmailDraftStatus status={savedDrafts.status} onRetry={() => void savedDrafts.retry()} disabled={composeSending} /></div>
              {composeError || footerError ? <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">{composeError || footerError}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span id="compose-send-help" className="text-xs text-muted-foreground">{!savedDrafts.ready ? "Loading your draft…" : footerLoading ? "Loading your email footer…" : attachmentBusy || composeMediaBusy ? "Preparing attachments…" : !composeSender?.sendConfigured ? "Choose a configured sender." : !composeTo.trim() ? "Add a recipient to send." : !composeBodyText.trim() && !composeHasImages ? "Write a message to send." : composeScheduleOpen && !composeScheduleAt ? "Choose a send date and time." : ""}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={() => setComposeOpen(false)} disabled={composeSending} className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-md border bg-background px-4 text-xs font-semibold hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">Close draft</button>
                  <button type="submit" aria-describedby="compose-send-help" disabled={composeSending || attachmentBusy || !composeTo.trim() || (!composeBodyText.trim() && !composeHasImages) || composeMediaBusy || footerLoading || Boolean(footerError) || !savedDrafts.ready || !composeSender?.sendConfigured || (composeScheduleOpen && !composeScheduleAt)} className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-foreground px-4 text-xs font-semibold text-background hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40">{composeSending ? <LoaderCircle className="size-4 animate-spin" /> : composeScheduleOpen ? <CalendarClock className="size-4" /> : <Send className="size-4" />}{composeSending ? "Sending…" : composeScheduleOpen ? "Schedule send" : "Send email"}</button>
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {invoiceContext ? <InvoiceCreateDialog context={invoiceContext} invoiceViewer={invoiceViewer} onClose={()=>setInvoiceContext(null)} onAttach={attachInvoicePdf} /> : null}
      {catalogOpen ? <EmailCatalogDialog products={products} catalogs={catalogs} customer={catalogTarget === "reply" ? (selected?.company && !["Direct email", "Unknown company"].includes(selected.company) ? selected.company : "") : composeTo} busy={attachmentBusy} onClose={() => setCatalogOpen(false)} onAttach={attachCatalog} /> : null}
    </div>
  );
}
