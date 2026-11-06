import { z } from "zod";

export const invoiceSendSchema = z.object({
  requestId: z.uuid(),
  revision: z.number().int().positive(),
  mailboxId: z.string().trim().min(1).max(200),
  to: z.email(),
  subject: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(20000),
}).strict();

export type InvoiceSendInput = z.infer<typeof invoiceSendSchema>;
