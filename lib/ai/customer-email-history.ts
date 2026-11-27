import "server-only";
import type { WorkspaceViewer } from "../auth";
import type { EmailInboxBackendData, InboxEmailItem } from "../email-inbox";
import { requireAiData } from "../data/ai-settings";
import { getViewerMailboxes } from "../data/mailboxes";
import { getCompaniesEmailBackendData } from "../data/company-emails";
import { readCompanyMailboxEmail } from "../data/company-email-access";
import { customerConversationRows, type CustomerConversations } from "./customer-conversations.ts";
import type { RecordEvidence } from "./record-presentation";
import { assertAiCustomerAccess, assignedAiCustomerIds } from "./customer-access.ts";

export type CustomerEmailHistoryContext = {
  accessViewer?: string;
  companyEmails?: Map<string, Promise<EmailInboxBackendData>>;
  companyEmailBodies?: Map<string, Promise<InboxEmailItem>>;
};

/** Request-local only. Both AI tools use the same source as the company Email tab. */
export async function loadCustomerEmailHistories(viewer: WorkspaceViewer, companyIds: string[], context: CustomerEmailHistoryContext = {}): Promise<Map<string, EmailInboxBackendData | null>> {
  await requireAiData("emails", "customers");
  const accessViewer = `${viewer.workspaceId}:${viewer.id}:${viewer.role}`;
  if (context.accessViewer !== accessViewer) {
    context.companyEmails = undefined;
    context.companyEmailBodies = undefined;
    context.accessViewer = accessViewer;
  }
  const db = viewer.role === "admin" ? null : (await import("../supabase/admin.ts")).createSupabaseAdmin();
  if (viewer.role !== "admin") {
    const assigned = new Set(await assignedAiCustomerIds(viewer, db!));
    if (companyIds.some(id => !assigned.has(id))) throw new Error("A requested customer is unavailable or is not assigned to you.");
  }
  const cache: NonNullable<CustomerEmailHistoryContext["companyEmails"]> = context.companyEmails ??= new Map<string, Promise<EmailInboxBackendData>>();
  const missing = [...new Set(companyIds)].filter(id => !cache.has(id));
  if (missing.length) {
    const batch = getViewerMailboxes(viewer.id).then(mailboxes => getCompaniesEmailBackendData(missing, { viewer, mailboxes }, { history: true })).then(async results => {
      if (viewer.role === "admin") return results;
      const addresses = [...new Set([...results.values()].flatMap(history => history.emails.map(email => email.contact.trim().toLowerCase())).filter(Boolean))];
      const owners = new Map<string, Set<string>>();
      for (let offset = 0; offset < addresses.length; offset += 100) {
        const batch = addresses.slice(offset, offset + 100);
        for (let start = 0; ; start += 500) {
          const { data, error } = await db!.from("contacts").select("company_id,email")
            .or(batch.map(email => `email.ilike.${JSON.stringify(email.replace(/[\\%_]/g, "\\$&"))}`).join(",")).order("id").range(start, start + 499);
          if (error) throw new Error("Unable to verify conversation customer ownership.");
          for (const contact of data ?? []) {
            const address = contact.email.trim().toLowerCase(), ids = owners.get(address) ?? new Set<string>();
            ids.add(contact.company_id); owners.set(address, ids);
          }
          if ((data?.length ?? 0) < 500) break;
        }
      }
      return new Map([...results].map(([id, history]) => {
        const emails = history.emails.filter(email => {
          const ids = owners.get(email.contact.trim().toLowerCase());
          return ids?.size === 1 && ids.has(id);
        });
        return [id, { ...history, emails, ...(emails.length < history.emails.length ? { inboxError: "Some conversations have ambiguous customer ownership." } : {}) }];
      }));
    });
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
  if (viewer.role !== "admin") await assertAiCustomerAccess(viewer, companyId, (await import("../supabase/admin.ts")).createSupabaseAdmin());
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
