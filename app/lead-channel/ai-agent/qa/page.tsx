import { FlowBuilder } from "@/components/flow-builder";
import { defaultFlowInput, type AutomationFlow } from "@/lib/flows";

const flow: AutomationFlow = {
  id: "canvas-qa",
  name: defaultFlowInput.name,
  triggerType: defaultFlowInput.triggerType,
  triggerConfig: defaultFlowInput.triggerConfig,
  status: "draft",
  createdBy: "qa",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  activeRuns: 0,
  completedRuns: 0,
  steps: defaultFlowInput.steps.map((step, position) => ({ ...step, id: step.id!, position })),
};

export default function FlowCanvasQaPage() {
  return <FlowBuilder initialFlows={[flow]} initialFlowId={flow.id} canEdit mailboxOptions={[]} memberOptions={[]} filterOptions={{ segments: [], countries: [] }} />;
}
