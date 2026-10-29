import { z } from "zod";

export const requestedInformation = ["shipping_address", "shipping_cost", "billing_address", "tax_id", "products", "quantity", "approval", "other"] as const;
const text = (max: number) => z.string().trim().min(1).max(max);
const task = z.object({ title: text(200), notes: text(3000), priority: z.enum(["low", "normal", "high"]).default("normal") }).strict();
const context = { companyId: z.uuid(), invoiceId: z.uuid().optional(), invoiceProposalId: z.uuid().optional(),
  needed: z.array(z.enum(requestedInformation)).min(1).max(8).refine((v) => new Set(v).size === v.length),
  task, expiresInDays: z.number().int().min(1).max(90).default(30),
};
export const replyOperationSchemas = [
  z.object({ op: z.literal("request_customer_information"), ...context, recipient: z.email().optional(), sourceEmailId: text(512).optional(), mailboxId: z.uuid().optional(),
    mode: z.enum(["missing", "confirm"]).default("missing"), subject: text(300).refine((v) => !/[\r\n]/.test(v)), text: text(10000),
  }).strict(),
  z.object({ op: z.literal("wait_for_customer_reply"), ...context, sourceEmailId: text(512), mailboxId: z.uuid().optional() }).strict(),
  z.object({ op: z.literal("cancel_reply_request"), requestId: z.uuid() }).strict(),
] as const;
export const replyOperationSchema = z.discriminatedUnion("op", replyOperationSchemas);
export type ReplyOperation = z.infer<typeof replyOperationSchema>;
export type ReplyRequestInput = Exclude<ReplyOperation, { op: "cancel_reply_request" }>;
const names = new Set(replyOperationSchemas.map((schema) => schema.shape.op.value));
export function isReplyOperation(value: { op: string }): value is ReplyOperation { return names.has(value.op as ReplyOperation["op"]); }

export const replyWorkflowInstruction = `CUSTOMER INFORMATION AND REPLY HANDOFFS:
When asked to add a shipping/billing address, use only a real saved address or explicit customer-provided evidence. A city/country is not a complete delivery address. Do not invent an address or turn an unknown shipping charge into free shipping. Ask for the missing information; offer to search accessible customer emails. When the user asks to check history, use the existing email search with the real companyId, empty query and pagination, honor coverage/unavailable bodies, and propose saving an explicit address with its sourceEmailId. A failed or incomplete search is not proof that no address was supplied.
If the user explicitly asks to email the customer for missing details and create a task when they reply, use request_customer_information. This sends ONE reviewed request and saves a durable wait tied to that outgoing email and recipient. It is not an invoice send and does not enable general automatic replies. Fields: {op,companyId,recipient:optional saved contact email,sourceEmailId:optional saved email,mailboxId:optional UUID,needed:[shipping_address|shipping_cost|billing_address|tax_id|products|quantity|approval|other],subject,text,task:{title,notes,priority:low|normal|high},expiresInDays:1-90,invoiceId:optional actual saved invoice ID,invoiceProposalId:optional owned pending invoice proposal ID,mode:missing|confirm}. Normally mode missing; confirm only when explicitly asked to reconfirm already saved information. Never make up a recipient or invoice/proposal ID. Mention which requested details remain unknown. Write a professional request using the real customer's context. Do not send a separate write_email action for the same request.
task describes the USER'S next work after a human reply: e.g. verify shipping address, confirm shipping cost, recheck prices, prepare the invoice and send it after review. Include agreed products/quantities, current invoice/order reference and any remaining questions in task.notes; these are not permission to auto-issue, record payments or send an invoice. The server preserves an available invoice/proposal snapshot. A reply creates one review task and notification, not proof that all information is complete. Automatic/OOO messages and unrelated senders/threads do not complete the wait. No further customer emails are sent by this waiting workflow. It expires with a follow-up task if no matching reply arrives.
For an already-sent email use wait_for_customer_reply with its real outbound sourceEmailId, companyId, needed, task, optional invoiceId/invoiceProposalId, expiresInDays and mailboxId. It watches only new replies after approval; it does not resend that email. Read reply_requests for your saved waiting statuses and next-task context. cancel_reply_request:{op,requestId} stops your pending wait without deleting mail or completed tasks.
These waits are saved server-side and checked by the connected background mailbox worker even when chat is closed. Only state that a wait or email exists after its execution result confirms it. Missing mailbox/IMAP/SMTP setup or uncertain delivery must be reported honestly; never promise monitoring from a plain create_task or retry an uncertain send. Use the same handoff for billing/VAT details, product quantities, PO documents, artwork approval or other explicitly requested customer replies.`;
