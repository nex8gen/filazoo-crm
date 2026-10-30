import { z } from "zod";
import { flowInputSchema } from "./flows.ts";
import { flowScenarioSchema } from "./flow-email-test.ts";
import { matchesProfileFilters, simulateFlow, type FlowFacts, type SimulationEntry } from "./flow-engine.ts";

export const flowPreviewSchema = z.object({
  flow: flowInputSchema,
  flowId: z.uuid().optional(),
  contactId: z.uuid().optional(),
  scenario: flowScenarioSchema.optional(),
});
export type FlowPreviewInput = z.infer<typeof flowPreviewSchema>;
export type FlowPreviewCheck = { label: string; passed: boolean | null; detail: string };
export type FlowPreviewResult = {
  ok: true;
  enters: boolean;
  checks: FlowPreviewCheck[];
  facts: FlowFacts;
  trace: SimulationEntry[];
  customer: { id: string; name: string | null; email: string; companyId: string | null } | null;
  warnings: string[];
};

export function previewFlowScenario(flow: z.infer<typeof flowInputSchema>, scenario: FlowFacts): FlowPreviewResult {
  const parsed = flowInputSchema.parse(flow);
  const facts = flowScenarioSchema.parse(scenario);
  const enters = matchesProfileFilters(parsed.triggerConfig, facts);
  return { ok: true, enters, facts, customer: null, trace: enters ? simulateFlow(parsed, facts).trace : [], checks: [
    { label: "Trigger event", passed: null, detail: "Assumes the selected trigger event occurs now." },
    { label: "Company filters", passed: enters, detail: "Checks the scenario against all configured company filters." },
    { label: "Customer selection", passed: null, detail: "Choose a saved customer to check recipient restrictions." },
    { label: "Re-entry criteria", passed: null, detail: "Save the flow and choose a customer to check previous entries." },
  ], warnings: ["Scenario facts are supplied by you. Future replies, opens and profile changes can change the actual journey."] };
}
