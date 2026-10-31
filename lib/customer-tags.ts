import { normalizeMessageId, normalizeReferences, threadKeyForEmail, groupEmailConversations, type EmailThreadMetadata } from "./email-threading.ts";

/** Shared customer situation vocabulary. Assign from evidence; reminders never imply a stage. */
export const customerTagValues = [
  "Prospect Nurturing", "New Inquiries", "Quotation Follow-up", "Active Negotiations",
  "Payment Follow-up", "Orders in Fulfillment", "Repeat Customers", "Inactive Customers",
  "Long-term Inactive Customers", "Postponed Purchasing",
] as const;

export type CustomerTag = (typeof customerTagValues)[number];

/** The same email can appear as a CRM row, sent copy, or IMAP copy. */
export function emailTagMessageKey(email: { id: string; messageId?: string | null }): string {
  const messageId = normalizeMessageId(email.messageId || (email.id.startsWith("imap-") && email.id.includes("@") ? email.id.slice(5) : null));
  return messageId ? `imap-${messageId}` : email.id;
}

/** A subject's conversation keeps its tag when replies arrive or mailbox copies differ. */
export function conversationTagKeys(messages: readonly (EmailThreadMetadata & { timestamp: string })[]): string[] {
  return [...new Set([...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).flatMap(email => {
    const root = normalizeReferences(email.references)[0] || normalizeMessageId(email.inReplyTo) || normalizeMessageId(email.messageId);
    return [`conversation:${threadKeyForEmail(email)}`, ...(root ? [`conversation:message:${root}`] : [])];
  }))];
}

export function conversationCustomerTag(messages: readonly { id: string; category?: CustomerTag | null }[], categories?: Readonly<Record<string, CustomerTag>>): CustomerTag | null {
  return [...messages].reverse().map(email => categories ? categories[email.id] : email.category).find(isCustomerTag) ?? null;
}

type TaggedMessage = EmailThreadMetadata & { timestamp: string; subject: string; contact: string; direction: "inbound" | "outbound"; category?: CustomerTag | null };
export function applyConversationCustomerTags<T extends TaggedMessage>(emails: T[], states: ReadonlyMap<string, { category: CustomerTag | null }>): T[] {
  const tags = new Map<string, CustomerTag | null>();
  for (const messages of groupEmailConversations(emails).values()) {
    const assignment = conversationTagKeys(messages).map(key => states.get(key)).find(Boolean);
    const category = assignment ? assignment.category : conversationCustomerTag([...messages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)));
    for (const email of messages) tags.set(email.id, category);
  }
  return emails.map(email => ({ ...email, category: tags.get(email.id) ?? null }));
}

export const customerTags = customerTagValues.map((name, index) => ({
  name,
  description: [
    "No qualified purchasing opportunity; outreach is allowed.",
    "An opportunity is in requirements qualification.",
    "A valid quotation has been sent; customer feedback is pending.",
    "Specifications, pricing, samples, or delivery terms are being discussed.",
    "Purchasing terms are confirmed and a documented payment arrangement exists.",
    "At least one active, incomplete order exists.",
    "At least two qualifying purchases exist.",
    "The configured inactivity threshold has been reached.",
    "The longer inactivity threshold has been reached.",
    "The customer explicitly postponed purchasing; record the reason and next contact date.",
  ][index],
  className: [
    "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
    "bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
    "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
    "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
    "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    "bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  ][index],
}));

export function isCustomerTag(value: unknown): value is CustomerTag {
  return typeof value === "string" && customerTagValues.some(tag => tag === value);
}

export function uniqueCustomerTags(values: readonly unknown[]): CustomerTag[] {
  const selected = new Set(values);
  return customerTagValues.filter(tag => selected.has(tag));
}

export function customerTagStyle(tag: CustomerTag): string {
  return customerTags.find(item => item.name === tag)!.className;
}
