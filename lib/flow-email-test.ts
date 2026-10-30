import { z } from "zod";
import { flowInputSchema } from "./flows.ts";
import { flowStepAtPath, simulateFlow, type FlowFacts, type SimulationEntry } from "./flow-engine.ts";

export const flowScenarioSchema = z.object({
  customerReplied: z.boolean().default(false),
  openedEmail: z.boolean().default(false),
  clickedLink: z.boolean().default(false),
  category: z.string().max(120).nullable().default(null),
  segment: z.string().max(120).nullable().default(null),
  country: z.string().max(100).nullable().default(null),
  companyStatus: z.string().max(120).nullable().default(null),
  pipelineStage: z.string().max(120).nullable().default(null),
  fitScore: z.number().int().min(0).max(10).nullable().default(null),
});

export const flowEmailTestSchema = z.object({
  flow: flowInputSchema,
  customerName: z.string().trim().max(200).default("Alex"),
  companyName: z.string().trim().max(300).default("Sample company"),
  firstMessage: z.boolean().default(true),
  facts: flowScenarioSchema.optional(),
  messageStepPath: z.array(z.number().int().min(0).max(499)).min(1).max(11).refine((path) => path.length % 2 === 1, "Choose a valid message action.").optional(),
  emails: z.array(z.object({
    from: z.email().max(300),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(6000),
  })).min(1).max(3),
});

export type FlowEmailTestInput = z.infer<typeof flowEmailTestSchema>;

export function flowEmailTestFacts(input: FlowEmailTestInput): FlowFacts {
  const config = input.flow.triggerConfig;
  return input.facts ?? {
    customerReplied: false, openedEmail: false, clickedLink: false,
    category: typeof config.category === "string" ? config.category : null,
    segment: typeof config.segment === "string" ? config.segment : null,
    country: typeof config.country === "string" ? config.country : null,
    companyStatus: typeof config.companyStatus === "string" ? config.companyStatus : null,
    pipelineStage: typeof config.pipelineStage === "string" ? config.pipelineStage : null,
    fitScore: typeof config.minFitScore === "number" ? config.minFitScore : null,
  };
}

export function flowEmailTestTrace(input: FlowEmailTestInput, now = new Date()): SimulationEntry[] {
  if (!input.messageStepPath) return simulateFlow(input.flow, flowEmailTestFacts(input), now).trace;
  const step = flowStepAtPath(input.flow, input.messageStepPath);
  if (!step || !["send_email", "ai_auto_reply"].includes(step.type)) throw new Error("Choose an email action to preview or test.");
  return [{ step: input.messageStepPath[0] + 1, stepPath: input.messageStepPath, type: step.type, status: "would_run", scheduledAt: now.toISOString(), detail: "Previewing this message independently of journey entry and delays." }];
}
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
