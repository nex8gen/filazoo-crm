import "server-only";
import type { WorkspaceViewer } from "../auth";
import type { EmailInboxBackendData, InboxEmailItem } from "../email-inbox";
import { requireAiData } from "../data/ai-settings";
import { getViewerMailboxes } from "../data/mailboxes";
import { getCompaniesEmailBackendData } from "../data/company-emails";
import { readCompanyMailboxEmail } from "../data/company-email-access";
import { customerConversationRows, type CustomerConversations } from "./customer-conversations.ts";
import type { RecordEvidence } from "./record-presentation";

export type CustomerEmailHistoryContext = {
  companyEmails?: Map<string, Promise<EmailInboxBackendData>>;
  companyEmailBodies?: Map<string, Promise<InboxEmailItem>>;
};

/** Request-local only. Both AI tools use the same source as the company Email tab. */
export async function loadCustomerEmailHistories(viewer: WorkspaceViewer, companyIds: string[], context: CustomerEmailHistoryContext = {}): Promise<Map<string, EmailInboxBackendData | null>> {
  await requireAiData("emails", "customers");
  const cache: NonNullable<CustomerEmailHistoryContext["companyEmails"]> = context.companyEmails ??= new Map<string, Promise<EmailInboxBackendData>>();
  const missing = [...new Set(companyIds)].filter(id => !cache.has(id));
  if (missing.length) {
    const batch = getViewerMailboxes(viewer.id).then(mailboxes => getCompaniesEmailBackendData(missing, { viewer, mailboxes }, { history: true }));
    for (const id of missing) cache.set(id, batch.then(results => {
      const history = results.get(id);
      if (!history) throw new Error("Customer email history unavailable.");
      return history;
    }));
  }
  // Preserve unavailable sources per customer without discarding the rest of a page.
  return new Map(await Promise.all(companyIds.map(async id => [id, await cache.get(id)!.catch(() => null)] as const)));
}

export function isCustomerHistoryMessage(email: InboxEmailItem) {
  return !email.demo && !email.providerRemoved && email.providerKind !== "drafts" && email.status !== "Provider draft"
    && (email.direction === "inbound" || /^sent$/i.test(email.status));
}

/** Reuse the profile's exact company/UID authorization for lazy Inbox AND Sent bodies. */
export async function loadCustomerEmailBody(viewer: WorkspaceViewer, companyId: string, email: InboxEmailItem, context: CustomerEmailHistoryContext = {}) {
  if (email.bodyLoaded !== false) return email;
  await requireAiData("emails", "customers");
  const cache: NonNullable<CustomerEmailHistoryContext["companyEmailBodies"]> = context.companyEmailBodies ??= new Map<string, Promise<InboxEmailItem>>();
  const key = JSON.stringify([companyId, email.mailboxKey, email.uidValidity, email.uid, email.id]);
  if (!cache.has(key)) cache.set(key, (async () => {
    try {
      if (!email.mailboxKey || !email.uid || !email.uidValidity) throw new Error("Message content unavailable.");
      const result = await readCompanyMailboxEmail(viewer, companyId, {
        key: email.mailboxKey, uid: email.uid, validity: email.uidValidity, folder: email.providerFolder ?? "INBOX",
      });
      if (!result || result.email.bodyLoaded === false) throw new Error("Message content unavailable.");
      return { ...email, body: result.email.body, bodyLoaded: true };
    } catch {
      return { ...email, body: "", bodyLoaded: false };
    }
  })());
  return cache.get(key)!;
}

export const customerEmailHref = (companyId: string) => `/companies/${encodeURIComponent(companyId)}?tab=email`;

/** Resolve customers from completed CRM reads, never from generated names or email bodies. */
export async function loadConversationPresentation(viewer: WorkspaceViewer, evidence: readonly RecordEvidence[], context: CustomerEmailHistoryContext, fallbackCompanyId?: string, answer = ""): Promise<CustomerConversations[]> {
  const companies = new Map<string, string>();
  for (const source of evidence) for (const value of source.records) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const id = ["companies", "customer_insights"].includes(source.resource) ? row.id : row.company_id;
    if (typeof id === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) {
      companies.set(id, typeof row.name === "string" && ["companies", "customer_insights"].includes(source.resource) ? row.name : companies.get(id) ?? "");
    }
  }
  if (!companies.size && fallbackCompanyId) companies.set(fallbackCompanyId, "");
  const referenced = [...new Set([...answer.matchAll(/\/companies\/([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})/gi)].map(match => match[1]))].filter(id => companies.has(id));
  const selected = (referenced.length ? referenced.map(id => [id, companies.get(id)!] as const) : [...companies]).slice(0, 10);
  if (!selected.length) return [];
  const histories = await loadCustomerEmailHistories(viewer, selected.map(([id]) => id), context);
  return selected.map(([id, name]) => {
    const history = histories.get(id);
    const companyName = name || history?.emails.find(email => email.company)?.company || "Customer";
    if (!history) return { companyId: id, companyName, state: "unavailable", threads: [], more: false };
    const rows = customerConversationRows(id, companyName, history.emails.filter(isCustomerHistoryMessage));
    const incomplete = Boolean(history.inboxError || history.mailboxReadFailed || history.mailboxSnapshotPartial || history.mailboxHistoryPartial);
    return { ...rows, state: incomplete && !rows.threads.length ? "unavailable" : "ready", more: rows.more || incomplete };
  });
}
