import { z } from "zod";
import type { InboxEmailItem } from "./email-inbox.ts";
import type { FollowupFilter } from "./email-followup-filters.ts";

export const emailPageRequestSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  folder: z.string().min(1).max(600).catch("inbox"),
  query: z.string().max(300).catch(""),
  source: z.enum(["all", "shopify", "replies", "unread"]).catch("all"),
  tag: z.string().max(100).catch(""),
  followup: z.enum(["all", "ai", "manual", "completed", "nurture"]).catch("all"),
});
export type EmailPageRequest = z.infer<typeof emailPageRequestSchema>;
export type EmailPageInfo = { request: EmailPageRequest; total: number; pageSize: number; revision: string;
  folderCounts: Record<string, number>; followupCounts: Record<FollowupFilter, number> };
export type EmailPageSnapshot = { emails: InboxEmailItem[]; pagination: EmailPageInfo };

/** Ignore lazily loaded bodies and refresh timestamps when comparing list rows. */
export function sameEmailPage(left: EmailPageSnapshot, right: EmailPageSnapshot) {
  const signature = (page: EmailPageSnapshot) => JSON.stringify({
    total: page.pagination.total, request: page.pagination.request,
    folders: Object.entries(page.pagination.folderCounts).sort(), followups: Object.entries(page.pagination.followupCounts).sort(),
    emails: page.emails.map(email => [email.id, email.listConversationKey, email.timestamp, email.subject, email.contact, email.company,
      email.companyId, email.ownerId, email.ownerName, email.direction, email.status, email.source, email.contactName, email.preview, email.category ?? null, email.folder ?? "inbox", Boolean(email.read),
      Boolean(email.starred), email.followUpAt ?? null, email.mailboxKey, email.providerFolder, email.providerKind, email.uid, email.uidValidity,
      email.providerLocations, email.customerProfile,
      email.attachments?.map(file => [file.filename, file.contentType, file.size, file.partId])]),
  });
  return signature(left) === signature(right);
}
export function emailPageKey(mailboxId: string | null, request: EmailPageRequest) {
  return new URLSearchParams({ mailboxId: mailboxId ?? "", page: String(request.page), folder: request.folder,
    q: request.query, source: request.source, tag: request.tag, followup: request.followup }).toString();
}
export async function readEmailPage(key: string, signal: AbortSignal): Promise<EmailPageSnapshot> {
  const response = await fetch(`/api/email/page?${key}`, { signal, cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(result?.emails) || !result?.pagination) throw new Error(result?.error || "Unable to load emails. Please retry.");
  return result;
}
