export const pipelineStageValues = [
  "new",
  "contacted",
  "replied",
  "interested",
  "big_order",
  "won",
  "lost",
] as const;

export type PipelineStageValue = (typeof pipelineStageValues)[number];

export const pipelineStageLabels: Record<PipelineStageValue, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  big_order: "Big order",
  won: "Won",
  lost: "Lost",
};

export const pipelineStages = pipelineStageValues.map((value) => pipelineStageLabels[value]);
export type PipelineStage = (typeof pipelineStageLabels)[PipelineStageValue];

export type DataMode = "demo" | "live";

export type Company = {
  id: string;
  name: string;
  initials: string;
  domain: string;
  country: string;
  segment: string;
  fitScore: number;
  stage: PipelineStage;
  nextAction: string;
  tags: string[];
  contact: string;
  contactRole: string;
  email: string;
  summary: string;
};

export type EmailDraft = {
  id: string;
  company: string;
  contact: string;
  subject: string;
  preview: string;
  step: number;
  scheduledFor: string;
  status: "Needs approval" | "Scheduled" | "Draft";
};

export type Product = {
  sku: string;
  name: string;
  material: string;
  color: string;
  price: string;
  moq: number | null;
  status: string;
  updatedAt: string | null;
};

export type ActivityItem = {
  title: string;
  detail: string;
  time: string;
  tone: string;
};
