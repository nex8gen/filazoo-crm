import { z } from "zod";
import { emailDesignSchema, emailDesignUrl } from "./email-design.ts";
const campaignAudienceIdSchema = z.union([z.uuid(), z.string().regex(/^business:.+/).max(160), z.string().regex(/^contact:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)]);

export const campaignConfigSchema = z.object({
  type: z.literal("single").default("single"),
  channel: z.literal("email").default("email"),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  includeSegments: z.array(z.union([z.literal("all"), campaignAudienceIdSchema])).max(1000).default([]),
  excludeSegments: z.array(campaignAudienceIdSchema).max(1000).default([]),
  smartSending: z.boolean().default(true),
  utmTracking: z.boolean().default(false),
  subject: z.string().trim().max(300).default(""),
  preheader: z.string().trim().max(300).default(""),
  mailboxId: z.string().max(200).default(""),
  senderName: z.string().trim().max(160).regex(/^[^\r\n]*$/).default("Filazoo"),
  replyTo: z.union([z.literal(""), z.email()]).default(""),
  useSenderReplyTo: z.boolean().default(true),
  templateId: z.uuid().nullable().default(null),
  emailDesign: emailDesignSchema.optional(),
  sendMode: z.enum(["now", "scheduled"]).default("now"),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;
export type CampaignDispatch = { queuedAt: string; scheduledAt: string; recipientCount: number; userId: string };
export type CampaignMailbox = { id: string; email: string; name: string; available: boolean };
export type CampaignAudience = { id: string; name: string; count: number; kind?: "all" | "saved" | "business" };
export type CampaignContactOption = { id: string; name: string; email: string; companyName: string; verificationStatus: string; consentSource?: string; eligible?: boolean };
export type CampaignOptions = { mailboxes: CampaignMailbox[]; audiences: CampaignAudience[]; contacts?: CampaignContactOption[]; sendingEnabled: boolean };
export type CampaignRecipient = { id: string; email: string; name: string; companyName: string };
export type CampaignAudiencePreview = { count: number; excluded: number; recent: number; selected?: number; unverified?: number; unavailable?: number; recipients: CampaignRecipient[] };
export type CampaignDeliverySummary = { total: number; scheduled: number; sent: number; failed: number; skipped: number; pending: number };

export function campaignLocalDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function campaignMessageIssues(config: CampaignConfig, body: string, mailbox?: CampaignMailbox) {
  return [
    !config.subject.trim() ? "Add a subject line." : "",
    !config.senderName.trim() ? "Add a sender name." : "",
    !body.trim() ? "Add an email message or choose a template." : "",
    !mailbox?.available ? "Choose a connected sender account." : "",
    !config.useSenderReplyTo && !config.replyTo ? "Enter a reply-to email address." : "",
    config.emailDesign?.blocks.some(block => ["button", "video"].includes(block.type) && !emailDesignUrl(block.href)) ? "Add a valid link to each button and video block." : "",
    config.emailDesign?.blocks.some(block => ["image", "product"].includes(block.type) && block.src && !emailDesignUrl(block.src, true)) ? "Check the image URLs in your email design." : "",
    /\{\{\s*(?!(?:first_name|name|company|email)\s*\}\})[^}]+\}\}/.test(`${config.subject}\n${config.preheader}\n${body}\n${config.emailDesign ? JSON.stringify(config.emailDesign) : ""}`) ? "Replace unsupported template variables. Use first_name, name, company, or email." : "",
  ].filter(Boolean);
}

export function personalizeCampaign(value: string, recipient: CampaignRecipient) {
  const values: Record<string, string> = { first_name: recipient.name.trim().split(/\s+/)[0] || "there", name: recipient.name || "there", company: recipient.companyName, email: recipient.email };
  return value.replace(/\{\{\s*(first_name|name|company|email)\s*\}\}/g, (_, key: string) => values[key]);
}

/** Deduplicate by address after exclusions; an unsubscribed duplicate blocks the address. */
export function selectCampaignRecipients(contacts: Array<CampaignRecipient & { companyId: string; eligible: boolean; unsubscribed: boolean }>, included: Set<string>, excluded: Set<string>, recent: Set<string>, includedContacts = new Set<string>(), excludedContacts = new Set<string>()) {
  const blocked = new Set(contacts.filter(contact => contact.unsubscribed || excluded.has(contact.companyId) || excludedContacts.has(contact.id)).map(contact => contact.email.trim().toLowerCase()));
  const recipients = new Map<string, CampaignRecipient>();
  let excludedCount = 0, recentCount = 0;
  for (const contact of contacts) {
    const email = contact.email.trim().toLowerCase();
    if ((!included.has(contact.companyId) && !includedContacts.has(contact.id)) || !contact.eligible || !email || recipients.has(email)) continue;
    if (blocked.has(email)) { excludedCount++; continue; }
    if (recent.has(email)) { recentCount++; continue; }
    recipients.set(email, { id: contact.id, email, name: contact.name, companyName: contact.companyName });
  }
  return { recipients: [...recipients.values()], excluded: excludedCount, recent: recentCount };
}
