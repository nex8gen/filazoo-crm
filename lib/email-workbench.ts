import { z } from "zod";
import { recipientListSchema } from "./email-addresses.ts";
export const providerDraftSchema = z.object({ mailboxKey: z.string().regex(/^[a-f0-9]{64}$/), uid: z.number().int().positive(), validity: z.number().int().positive(), folder: z.string().min(1).max(512) });
export type ProviderDraft = z.infer<typeof providerDraftSchema>;

export const emailFileSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  content: z.string().max(10_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  contentType: z.string().trim().max(120).optional(),
  cid: z.string().trim().max(255).optional(),
});

export const emailSendSchema = z.object({
  mailboxId: z.string().trim().min(1).max(200).optional(),
  to: recipientListSchema.refine((value) => value.length > 0, "Enter at least one recipient."),
  cc: recipientListSchema.default([]), bcc: recipientListSchema.default([]),
  subject: z.string().trim().max(300).default(""),
  text: z.string().max(1_000_000).default(""), html: z.string().max(1_500_000).optional(),
  footerIncluded: z.boolean().default(false),
  threadId: z.string().trim().min(1).max(1_100).optional(),
  inReplyTo: z.string().trim().max(1_000).regex(/^<[^<>\s]+>$/).optional(),
  references: z.array(z.string().trim().max(1_000).regex(/^<[^<>\s]+>$/)).max(100).default([]),
  attachments: z.array(emailFileSchema).max(10).default([]),
  requestId: z.uuid().optional(),
  scheduleAt: z.iso.datetime({ offset: true }).optional(),
  draftId: z.string().min(1).max(512).optional(),
  providerDraft: providerDraftSchema.optional(),
}).superRefine((value, context) => {
  if (new Set([...value.to, ...value.cc, ...value.bcc]).size > 50) context.addIssue({ code: "custom", message: "An email supports up to 50 recipients." });
  if (!value.text.trim() && !value.html?.trim()) context.addIssue({ code: "custom", message: "Enter a message before sending." });
});
export type EmailSendInput = z.infer<typeof emailSendSchema>;

export const emailDraftSchema = z.object({
  id: z.string().min(1).max(512), mailboxId: z.string().min(1).max(200),
  senderId: z.string().optional(),
  providerDraft: providerDraftSchema.optional(),
  kind: z.enum(["reply", "compose"]), threadId: z.string().max(1_100).optional(),
  to: z.string().max(4000), cc: z.string().max(4000).default(""), bcc: z.string().max(4000).default(""),
  subject: z.string().max(300), text: z.string().max(1_000_000), html: z.string().max(1_500_000),
  bodyText: z.string().max(1_000_000).default(""),
  parentId: z.string().max(1100).optional(), replyAll: z.boolean().default(false),
  inReplyTo: z.string().max(1000).optional(), references: z.array(z.string().max(1000)).max(100).optional(),
  attachments: z.array(emailFileSchema.extend({ id: z.string(), size: z.number().nonnegative() })).max(10),
  requestId: z.uuid(), revision: z.number().int().nonnegative(),
});
export type EmailDraft = z.infer<typeof emailDraftSchema>;

export function hasEmailDraft(draft: Pick<EmailDraft, "text" | "bodyText" | "html" | "attachments" | "kind" | "to" | "cc" | "bcc" | "subject">) {
  return Boolean(draft.bodyText.trim() || draft.attachments.length || /<img\b/i.test(draft.html.replace(/<section\b[^>]*data-email-footer[^>]*>[\s\S]*?<\/section>/gi, ""))
    || (draft.kind === "compose" && (draft.to || draft.cc || draft.bcc || draft.subject)));
}
