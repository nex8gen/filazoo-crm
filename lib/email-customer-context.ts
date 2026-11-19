import type { InboxEmailItem } from "./email-inbox.ts";
import type { listInboxCompanies } from "./data/inbox-companies.ts";

type InboxCompany = Awaited<ReturnType<typeof listInboxCompanies>>["companies"][number];
export type EmailCustomerContext = Partial<Pick<InboxEmailItem, "company" | "companyId" | "ownerId" | "ownerName" | "ownerInitials" | "ownerAvatarUrl" | "customerProfile">>;
export type EmailCustomerEntry = { status: "pending" | "ready" | "error"; context?: EmailCustomerContext; updatedAt: number };

export function emailCustomerContext(company?: InboxCompany | null): EmailCustomerContext {
  if (!company) return { companyId: null, ownerId: null, ownerName: "Unassigned", ownerInitials: "—", ownerAvatarUrl: undefined, customerProfile: undefined };
  return {
    company: company.name, companyId: company.id, ownerId: company.ownerId,
    ownerName: company.ownerName, ownerInitials: company.ownerInitials, ownerAvatarUrl: company.ownerAvatarUrl,
    customerProfile: { companyName: company.name, contactName: company.contact, contactRole: company.contactRole, website: company.website, country: company.country, city: company.city, segment: company.segment, summary: company.summary, interests: company.tags, fitScore: company.fitScore, currency: company.currency },
  };
}

export function applyEmailCustomerContext<T extends InboxEmailItem>(message: T, entry?: EmailCustomerEntry): T {
  if (!entry) return message;
  return { ...message, ...entry.context, customerContextStatus: entry.status,
    ...(!entry.context && !message.ownerId && entry.status !== "ready" ? { ownerName: entry.status === "pending" ? "Loading customer details…" : "Customer details unavailable" } : {}) };
}
