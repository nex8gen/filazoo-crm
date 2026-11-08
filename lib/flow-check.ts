import { z } from "zod";
import { flowInputSchema } from "./flows.ts";

export const flowCheckInputSchema = z.object({ flow: flowInputSchema, flowId: z.uuid().nullable().optional() });
export type FlowCheckInput = z.infer<typeof flowCheckInputSchema>;
export type FlowCheck = { id: string; label: string; status: "passed" | "blocked" | "warning" | "unverified"; detail: string; actionPath?: number[]; links?: Array<{ label: string; href: string }> };
export type FlowCheckResult = { status: "ready" | "blocked" | "incomplete"; checkedAt: string; durationMs: number; checks: FlowCheck[]; actionCount: number };
export function flowCheckStatus(checks: FlowCheck[]): FlowCheckResult["status"] {
  return checks.some(check => check.status === "blocked") ? "blocked" : checks.some(check => check.status === "unverified") ? "incomplete" : "ready";
}
