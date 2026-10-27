import { z } from "zod";
import { flowInputSchema } from "./flows.ts";
import type { SimulationEntry } from "./flow-engine.ts";

export const flowEmailTestSchema = z.object({
  flow: flowInputSchema,
  customerName: z.string().trim().max(200).default("Alex"),
  companyName: z.string().trim().max(300).default("Sample company"),
  firstMessage: z.boolean().default(true),
  emails: z.array(z.object({
    from: z.email().max(300),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(6000),
  })).min(1).max(3),
});

export type FlowEmailTestInput = z.infer<typeof flowEmailTestSchema>;
export const flowEmailDeliveryTestSchema = flowEmailTestSchema.extend({
  requestId: z.uuid(),
  recipient: z.email().max(300).transform((value) => value.toLowerCase()),
  emails: flowEmailTestSchema.shape.emails.max(1, "Use one sample email for a real delivery test."),
});
export type FlowEmailDeliveryTestInput = z.infer<typeof flowEmailDeliveryTestSchema>;
export type FlowEmailDeliveryTestRun = {
  id: string;
  recipient: string;
  status: "waiting" | "completed" | "failed" | "cancelled";
  next_run_at: string | null;
  created_at: string;
  error: string | null;
  result: Array<{ step: number; subject: string; body: string; messageId: string | null; sentAt: string; attachments: Array<{ filename: string; size: number }> }>;
};
export type FlowEmailTestResult = {
  cases: Array<{
    subject: string;
    trace: SimulationEntry[];
    replies: Array<{ step: number; subject: string; body: string; attachments: Array<{ filename: string; size: number }> }>;
    error?: string;
  }>;
};
