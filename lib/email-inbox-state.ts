import { z } from "zod";

export const emailInboxStateSchema = z.object({
  messageKey: z.string().trim().min(1).max(512),
  category: z.enum(["Needs follow-up", "Waiting on customer", "Interested", "Big order", "No action"]).nullable(),
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
