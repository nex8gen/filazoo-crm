import { z } from "zod";
import { customerTagValues } from "./customer-tags.ts";

export const emailInboxStateSchema = z.object({
  messageKey: z.string().trim().min(1).max(512),
  category: z.enum([...customerTagValues, "Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"]).nullable(),
  categoryWrite: z.boolean().default(false),
  tagMessageKey: z.string().trim().min(1).max(512).optional(),
  tagConversationKeys: z.array(z.string().startsWith("conversation:").max(512)).min(1).max(1000).optional(),
  tagMessageKeys: z.array(z.string().trim().min(1).max(512)).max(1000).optional(),
  starred: z.boolean(),
  read: z.boolean(),
  folder: z.enum(["inbox", "archive", "trash"]),
  // AI returns workspace-local offsets; persist a canonical UTC timestamp.
  followUpAt: z.string().datetime({ offset: true }).transform((value) => new Date(value).toISOString()).nullable(),
  contactEmail: z.string().trim().email().optional(),
  threadId: z.string().trim().max(512).nullable().optional(),
  provider: z.object({
    mailboxKey: z.string().regex(/^[a-f0-9]{64}$/), uid: z.number().int().positive(), validity: z.number().int().positive(),
    folder: z.string().min(1).max(512).default("INBOX"),
    read: z.boolean().optional(), starred: z.boolean().optional(), destination: z.enum(["inbox", "archive", "trash"]).optional(),
  }).optional(),
});
