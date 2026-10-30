import { FlowBuilder } from "@/components/flow-builder";
import { blankStep, defaultFlowInput, type AutomationFlow } from "@/lib/flows";

const split = blankStep("split");
split.config.name = "B2B customer path";
split.config.paths = [
  { id: "qualified", name: "High-fit buyers", condition: { match: "all", rules: [{ field: "fit_score_at_least", fitScore: 7 }, { field: "country_is", value: "US" }] }, steps: [{ ...blankStep("create_task"), id: "call-buyer", config: { ...blankStep("create_task").config, title: "Call qualified buyer" } }] },
  { id: "otherwise", name: "Everyone else", condition: null, steps: [{ ...blankStep("wait"), id: "wait-otherwise" }, { ...blankStep("send_email"), id: "welcome-otherwise", config: { ...blankStep("send_email").config, mailboxId: "default", templateId: "welcome_intro" } }] },
];

const flow: AutomationFlow = {
  id: "canvas-qa",
  name: "B2B flow canvas verification",
  triggerType: defaultFlowInput.triggerType,
  triggerConfig: defaultFlowInput.triggerConfig,
  status: "draft",
  createdBy: "qa",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  activeRuns: 0,
  completedRuns: 0,
  steps: [{ ...split, id: "qa-split" }, ...defaultFlowInput.steps].map((step, position) => ({ ...step, id: step.id!, position })),
};

export default function FlowCanvasQaPage() {
  return <FlowBuilder initialFlows={[flow]} viewerId={flow.createdBy} initialFlowId={flow.id} canEdit mailboxOptions={[]} memberOptions={[]} filterOptions={{ segments: [], countries: [] }} />;
}
