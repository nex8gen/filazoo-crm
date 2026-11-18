import "server-only";
import { requireAiData } from "../data/ai-settings";
import { getFlowAnalytics } from "../data/flow-analytics";
import { agentFlowAnalyticsReport, flowAnalyticsContextSchema } from "./flow-analytics-context.ts";

export async function loadAgentWorkflowAnalytics(input: unknown) {
  await requireAiData("flows", "emails", "team");
  const scope = flowAnalyticsContextSchema.parse(input ?? { range: "30" });
  const { report } = await getFlowAnalytics(scope.range);
  return agentFlowAnalyticsReport(report, scope);
}
