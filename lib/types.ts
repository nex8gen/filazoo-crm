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
  new: "Profile created",
  contacted: "Catalog sent",
  replied: "Customer replied",
  interested: "Qualified interest",
  big_order: "Quote / bulk order",
  won: "Order confirmed",
  lost: "Closed / not proceeding",
};

export const pipelineStages = pipelineStageValues.map((value) => pipelineStageLabels[value]);
export type PipelineStage = (typeof pipelineStageLabels)[PipelineStageValue];

export type DataMode = "demo" | "live";

export type Company = {
  id: string;
  name: string;
  initials: string;
  ownerId: string | null;
  ownerName: string;
  ownerInitials: string;
  ownerAvatarUrl?: string;
  website: string;
  domain: string;
  country: string;
  city: string;
  segment: string;
  source: string;
  sourceLabel: string;
  fitScore: number;
  stage: PipelineStage;
  outreachStatus: string;
  estimatedOrderQuantity: number | null;
  estimatedOrderLabel?: string | null;
  estimatedValue: number | null;
  currency: string;
  nextFollowupAt: string | null;
  nextAction: string;
  tags: string[];
  contact: string;
  contactRole: string;
  email: string;
  summary: string;
};

export type CompanyContact = {
  id: string;
  name: string;
  role: string;
  email: string;
  verificationStatus: string;
};

export type CompanyActivity = {
  id: string;
  type: "event" | "email" | "catalog" | "invoice" | "payment";
  title: string;
  detail: string;
  body?: string;
  direction?: "received" | "sent";
  actor: string;
  actorId?: string | null;
  actorAvatarUrl?: string;
  createdAt: string;
  metadata?: { label: string; value: string }[];
  href?: string;
  messageId?: string | null;
};

export type CompanyDetails = {
  commerce?: import("./company-commerce").CompanyCommerce;
  company: Company;
  contacts: CompanyContact[];
  activity: CompanyActivity[];
};

export type EmailDraft = {
  id: string;
  company: string;
  contact: string;
  subject: string;
  preview: string;
  step: number;
  scheduledFor: string;
  status: "Draft" | "Needs approval" | "Scheduled" | "Sent" | "Failed";
};

export type ContactOption = {
  id: string;
  companyId: string;
  company: string;
  name: string;
  email: string;
  verificationStatus: string;
};

export type Catalog = {
  id: string;
  company: string;
  productSkus: string[];
  currency: string;
  priceDate: string;
  version: number;
  pdfUrl: string | null;
  createdAt: string;
};

export type Reply = {
  id: string;
  messageId?: string | null;
  threadId?: string | null;
  company: string;
  contact: string;
  subject: string;
  body: string;
  receivedAt: string;
};

export type ProductStock = { available: number; onHand: number; locked: number; warehouseIds: string[]; syncedAt: string };

export type Product = {
  currency?: string;
  overrideVersion?: string | null;
  sku: string;
  name: string;
  imageUrl: string | null;
  material: string;
  color: string;
  colors: string[];
  diameter: string;
  weight: string;
  price: string;
  moq: number | null;
  priceTiers: { minimumQuantity: number; price: string }[];
  stockStatus: string;
  stock?: ProductStock | null;
  leadTime: string;
  status: string;
  updatedAt: string | null;
  variants: ProductVariant[];
};

export type ProductVariant = {
  id: string;
  name: string;
  sku: string;
  price: string;
  stockStatus: string;
  stock?: ProductStock | null;
  imageUrl: string | null;
};

export type ActivityItem = {
  title: string;
  detail: string;
  time: string;
  tone: string;
};
