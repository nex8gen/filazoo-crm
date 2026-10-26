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
export type FlowEmailTestResult = {
  cases: Array<{
    subject: string;
    trace: SimulationEntry[];
    replies: Array<{ step: number; subject: string; body: string; attachments: Array<{ filename: string; size: number }> }>;
    error?: string;
  }>;
};
