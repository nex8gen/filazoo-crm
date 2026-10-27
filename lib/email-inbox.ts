import type { DataMode, EmailDraft, Reply } from "./types.ts";
import { getEffectiveMailbox, mailboxHasImap, mailboxHasSmtp } from "./data/mailboxes.ts";
import { getEmailAutomationSettings, listEmailInboxStates, listSentMailboxMessages, type EmailCategory, type EmailFolderState } from "./data/email-state.ts";
import { requireWorkspaceMember } from "./auth.ts";
import { canViewEmail } from "./email-access.ts";
import { getAssignedEmailContacts } from "./data/email-access.ts";
import { normalizeMessageId, normalizeReferences, threadKeyForEmail } from "./email-threading.ts";
import type { CustomerProfileContext } from "./ai/email-rewrite.ts";

export type InboxEmailItem = {
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
  attachments?: Array<{ filename: string; contentType: string; size: number; url?: string; partId?: string; cid?: string }>;
  timestamp: string;
  step?: string;
  demo?: boolean;
  category?: EmailCategory | null;
  starred?: boolean;
  read?: boolean;
  folder?: EmailFolderState;
  followUpAt?: string | null;
};

export type AutomationFlowStep = {
  id: string;
  title: string;
  delay: string;
  action: string;
  enabled: boolean;
};

export type EmailInboxBackendData = {
  mode: DataMode;
  mailboxConfigured: boolean;
  sendConfigured: boolean;
  inboxConfigured: boolean;
  inboxError: string | null;
  lastMailboxSync?: string | null;
  aiConfigured: boolean;
  defaultMailboxEmail: string | null;
  emails: InboxEmailItem[];
  automation: {
    enabled: boolean;
    steps: AutomationFlowStep[];
    queueCount: number;
  };
};

function toPreview(text: string | null | undefined) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean || "No message preview available.";
}

type MailboxInboxSource = {
  demo?: boolean;
  id?: string;
  direction?: "inbound" | "outbound";
  status?: string;
  subject?: string;
  contact?: string;
  replyTo?: string | null;
  uid?: number;
  uidValidity?: number;
  mailboxKey?: string;
  bodyLoaded?: boolean;
  contactName?: string;
  source?: "mailbox" | "shopify" | "crm";
  company?: string;
  preview?: string;
  body?: string;
  html?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  timestamp?: string;
  attachments?: InboxEmailItem["attachments"];
};

export async function fetchMailboxInboxMessages(mailbox: import("./mailbox-imap.ts").ImapMailbox | null | undefined, options: import("./mailbox-imap.ts").ReceiveOptions = {}): Promise<InboxEmailItem[]> {
  if (!mailbox?.imapHost || !mailbox.imapUsername || !mailbox.imapPassword) return [];
  const { receiveMailboxMessages } = await import("./mailbox-imap.ts");
  return receiveMailboxMessages(mailbox, options);
}

type ShopifyInboxRow = {
  webhook_id: string;
  customer_id: string;
  email: string;
  full_name: string | null;
  company_name: string;
  phone: string | null;
  tags: string[] | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
};

function textField(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildShopifyFormInboxItems(rows: ShopifyInboxRow[]): InboxEmailItem[] {
  return rows.map((row) => {
    const isFormLead = row.customer_id.startsWith("form:");
    const message = textField(row.raw_payload, "contact[body]");
    const details = [
      textField(row.raw_payload, "contact[Business type]") && `Business type: ${textField(row.raw_payload, "contact[Business type]")}`,
      textField(row.raw_payload, "contact[Estimated monthly volume]") && `Estimated monthly volume: ${textField(row.raw_payload, "contact[Estimated monthly volume]")}`,
      (textField(row.raw_payload, "contact[Phone]") || row.phone) && `Phone: ${textField(row.raw_payload, "contact[Phone]") || row.phone}`,
      textField(row.raw_payload, "contact[Website]") && `Website: ${textField(row.raw_payload, "contact[Website]")}`,
      row.tags?.length ? `Shopify tags: ${row.tags.join(", ")}` : null,
    ].filter((value): value is string => Boolean(value));
    const body = [message || (isFormLead
      ? "A customer submitted the Shopify B2B enquiry form."
      : "A new Shopify B2B lead was added."), details.length ? details.join("\n") : null]
      .filter(Boolean)
      .join("\n\n");
    return {
      id: `shopify-${row.webhook_id}`,
      direction: "inbound" as const,
      status: isFormLead ? "Shopify enquiry" : "Shopify lead",
      subject: `${isFormLead ? "Shopify enquiry" : "Shopify lead"} from ${row.company_name}`,
      contact: row.email,
      contactName: row.full_name || undefined,
      company: row.company_name,
      preview: toPreview(body),
      body,
      threadId: `shopify:${row.webhook_id}`,
      timestamp: row.created_at,
      source: "shopify" as const,
    };
  });
}

async function listShopifyFormInboxMessages() {
  const { createSupabaseAdmin } = await import("./supabase/admin.ts");
  const admin = createSupabaseAdmin();
  const pageSize = 500;
  const rows: ShopifyInboxRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("shopify_leads")
      .select("webhook_id,customer_id,email,full_name,company_name,phone,tags,raw_payload,created_at")
      .eq("status", "processed")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Unable to load Shopify enquiries: ${error.message}`);
    const page = (data ?? []) as ShopifyInboxRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return buildShopifyFormInboxItems(rows);
}

function normalizedEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

/** Keep only team-mailbox messages that are actionable CRM customer replies. */
export function filterCustomerReplyMessages(
  messages: InboxEmailItem[],
  contactEmails: Iterable<string>,
  sentMessages: InboxEmailItem[],
) {
  const knownContacts = new Set([
    ...Array.from(contactEmails, normalizedEmail),
    ...sentMessages.map((message) => normalizedEmail(message.contact)),
  ].filter(Boolean));
  const sentMessageIds = new Set(sentMessages.flatMap((message) => {
    const id = normalizeMessageId(message.messageId);
    return id ? [id] : [];
  }));

  return messages.filter((message) => {
    if (knownContacts.has(normalizedEmail(message.contact))) return true;
    const replyIds = [normalizeMessageId(message.inReplyTo), ...normalizeReferences(message.references)];
    return replyIds.some((id) => id && sentMessageIds.has(id));
  });
}

export function buildInboxEmailItems({
  drafts = [],
  replies = [],
  inbound = [],
}: {
  drafts?: EmailDraft[];
  replies?: Reply[];
  inbound?: InboxEmailItem[] | MailboxInboxSource[];
} = {}): InboxEmailItem[] {
  const seen = new Set<string>();
  const seenMessageIds = new Set<string>();

  const inboundItems = inbound.map((message, index) => {
    const item: InboxEmailItem = {
      id: message.id || `imap-${index}`,
      direction: "inbound",
      status: message.status || "Received",
      subject: message.subject || "New inbound email",
      contact: message.contact || "Unknown contact",
      replyTo: message.replyTo,
      uid: message.uid,
      uidValidity: message.uidValidity,
      mailboxKey: message.mailboxKey,
      bodyLoaded: message.bodyLoaded,
      attachments: message.attachments,
      contactName: message.contactName,
      company: message.company || "Unknown company",
      preview: toPreview(message.preview || message.body),
      body: message.bodyLoaded === false ? "" : message.body || "No email body available.",
      html: message.html ?? null,
      threadId: message.threadId ?? null,
      messageId: message.messageId ?? null,
      inReplyTo: message.inReplyTo ?? null,
      references: message.references ?? [],
      timestamp: message.timestamp || new Date().toISOString(),
      source: message.source || "crm",
      demo: message.demo === true,
    };
    item.threadId = threadKeyForEmail(item);
    seen.add(item.id);
    const messageId = normalizeMessageId(item.messageId);
    if (messageId) seenMessageIds.add(messageId);
    return item;
  });

  const replyItems = replies.map((reply, index) => {
    const id = reply.id || `reply-${index}`;
    const messageId = normalizeMessageId(reply.messageId);
    if (seen.has(id) || (messageId && seenMessageIds.has(messageId))) return null;
    if (messageId) seenMessageIds.add(messageId);
    const item: InboxEmailItem = {
      id,
      direction: "inbound",
      messageId: reply.messageId,
      threadId: reply.threadId,
      status: "Received",
      subject: reply.subject || "New inbound email",
      contact: reply.contact || "Unknown contact",
      company: reply.company || "Unknown company",
      preview: toPreview(reply.body),
      body: reply.body || "No email body available.",
      timestamp: reply.receivedAt || new Date().toISOString(),
      source: "crm",
      demo: false,
    };
    item.threadId = threadKeyForEmail(item);
    seen.add(id);
    return item;
  }).filter((item): item is InboxEmailItem => item !== null);

  const outboundItems = drafts.map((draft, index) => {
    const id = draft.id || `draft-${index}`;
    if (seen.has(id)) return null;
    const item: InboxEmailItem = {
      id,
      direction: "outbound",
      status: draft.status,
      subject: draft.subject || "Untitled draft",
      contact: draft.contact || "Unknown contact",
      company: draft.company || "Unknown company",
      preview: toPreview(draft.preview),
      body: draft.preview || "No email body available.",
      timestamp: new Date().toISOString(),
      step: `Step ${draft.step} of 3`,
      demo: false,
    };
    item.threadId = threadKeyForEmail(item);
    seen.add(id);
    return item;
  }).filter((item): item is InboxEmailItem => item !== null);

  return [...inboundItems, ...replyItems, ...outboundItems].sort((left, right) => {
    const directionOrder = { inbound: 0, outbound: 1 };
    const directionDelta = directionOrder[left.direction] - directionOrder[right.direction];
    if (directionDelta !== 0) return directionDelta;
    return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
  });
}

export async function getEmailInboxBackendData({ syncMailbox = true, history = false }: { syncMailbox?: boolean; history?: boolean } = {}): Promise<EmailInboxBackendData> {
  const { listCompanies, listEmailDrafts, listReplies } = await import("./data/crm.ts");
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [{ emails, mode }, { replies }, companyResult, defaultMailbox, sentMessages, states, shopifyMessages, assignedContacts] = await Promise.all([
    listEmailDrafts(),
    listReplies(),
    listCompanies(),
    getEffectiveMailbox(viewer.id).catch(() => null),
    listSentMailboxMessages(viewer.id).catch(() => []),
    listEmailInboxStates(viewer.id).catch(() => new Map()),
    listShopifyFormInboxMessages().catch(() => []),
    getAssignedEmailContacts(viewer),
  ]);

  let liveInbound: InboxEmailItem[] = [];
  let inboxError: string | null = null;
  let lastMailboxSync: string | null = null;
  if (mailboxHasImap(defaultMailbox) && defaultMailbox) {
    try {
      const { loadSyncedMailbox } = await import("./data/mailbox-sync.ts");
      const result = await loadSyncedMailbox(defaultMailbox, { sync: syncMailbox, history });
      liveInbound = result.messages;
      inboxError = result.error;
      lastMailboxSync = result.syncedAt;
    } catch (error) {
      inboxError = error instanceof Error ? error.message : "Unable to connect to the mailbox inbox.";
      console.warn("Unable to sync mailbox inbox:", inboxError);
    }
  }

  const companiesByEmail = new Map(companyResult.companies.filter((company) => company.email).map((company) => [company.email.toLowerCase(), company]));
  const companiesByName = new Map(companyResult.companies.map((company) => [company.name.toLowerCase(), company]));
  const companiesById = new Map(companyResult.companies.map((company) => [company.id, company]));
  const inbox = [...buildInboxEmailItems({ drafts: emails, replies, inbound: [...shopifyMessages, ...liveInbound] }), ...sentMessages]
    .filter((item) => canViewEmail(viewer, item.contact, assignedContacts))
    .map((item) => {
      const assignedCompanyId = assignedContacts?.get(item.contact.trim().toLowerCase());
      const company = assignedCompanyId ? companiesById.get(assignedCompanyId)
        : companiesByEmail.get(item.contact.toLowerCase()) ?? companiesByName.get(item.company.toLowerCase());
      return {
        ...item,
        ...(states.get(item.id) ?? {}),
        companyId: assignedCompanyId ?? company?.id ?? null,
        ownerId: assignedCompanyId ? viewer.id : company?.ownerId ?? null,
        ownerAvatarUrl: company?.ownerAvatarUrl,
        ownerName: company?.ownerName ?? (assignedCompanyId ? viewer.displayName || "BD Sales Manager" : "Unassigned"),
        customerProfile: company ? {
          companyName: company.name,
          contactName: item.contactName || company.contact,
          contactRole: company.contactRole,
          website: company.website,
          country: company.country,
          city: company.city,
          segment: company.segment,
          summary: company.summary,
          interests: company.tags,
          fitScore: company.fitScore,
          pipelineStage: company.stage,
          estimatedOrderQuantity: company.estimatedOrderQuantity ?? undefined,
          estimatedValue: company.estimatedValue ?? undefined,
          currency: company.currency,
        } : undefined,
        ownerInitials: company?.ownerInitials ?? "—",
      };
    });
  const defaultMailboxEmail = defaultMailbox?.email || null;
  const sendConfigured = mailboxHasSmtp(defaultMailbox);
  const inboxConfigured = mailboxHasImap(defaultMailbox);
  const mailboxConfigured = sendConfigured && inboxConfigured;

  const aiConfigured = Boolean(
    process.env.GEMINI_API_KEY?.trim()
    || process.env.AI_GATEWAY_API_KEY?.trim()
    || process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
  const automation = await getEmailAutomationSettings(
    viewer.id,
    inbox.filter((item) => item.direction === "inbound").length,
  ).catch(() => ({ enabled: false, queueCount: 0, steps: [] }));

  return {
    mode,
    mailboxConfigured,
    sendConfigured,
    inboxConfigured,
    inboxError,
    lastMailboxSync,
    aiConfigured,
    defaultMailboxEmail,
    emails: inbox,
    automation,
  };
}
