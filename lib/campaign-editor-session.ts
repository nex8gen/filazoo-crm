import { z } from "zod";
import { marketingAssetInputSchema, type MarketingAsset } from "./marketing-assets.ts";
import { emailDesignSchema } from "./email-design.ts";
import { documentMetadataSchema, type LibraryDocument } from "./documents.ts";
import { campaignConfigSchema } from "./email-campaigns.ts";

export const campaignStepSchema = z.enum(["setup", "recipients", "message", "review"]);
export const campaignViewSchema = z.enum(["templates", "edit", "preview"]);
export type CampaignStep = z.infer<typeof campaignStepSchema>;
export type CampaignView = z.infer<typeof campaignViewSchema>;

export function campaignEditorLocation(search: string) {
  const params = new URLSearchParams(search);
  const id = z.uuid().safeParse(params.get("campaign"));
  return {
    campaign: id.success ? id.data : null,
    step: campaignStepSchema.safeParse(params.get("step")).data,
    view: campaignViewSchema.safeParse(params.get("view")).data,
  };
}

/** Preserve unrelated filters and remove all editor state when returning to the list. */
export function campaignEditorSearch(search: string, value: { campaign: string | null; year?: number; step?: CampaignStep; view?: CampaignView }) {
  const params = new URLSearchParams(search);
  if (value.year !== undefined) params.set("year", String(value.year));
  for (const key of ["campaign", "step", "view"] as const) {
    const next = value.campaign ? value[key] : null;
    if (next) params.set(key, next); else params.delete(key);
  }
  return params.toString();
}

export function campaignSessionKey(scope: string, id: string) {
  return `filazoo:campaign-editor:v1:${scope}:${id}`;
}

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const maxAge = 24 * 60 * 60 * 1000;
function storage() { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } }

export function readCampaignSession<T>(key: string, schema: z.ZodType<T>, source: SessionStorage | null = storage()): T | null {
  try {
    const raw = source?.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || typeof value.at !== "number" || Date.now() - value.at > maxAge || value.at > Date.now() + 60_000) return null;
    const parsed = schema.safeParse(value.value);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** A storage failure must never stop editing or saving to the server. */
export function writeCampaignSession(key: string, value: unknown, target: SessionStorage | null = storage()) {
  try { target?.setItem(key, JSON.stringify({ version: 1, at: Date.now(), value })); } catch { /* The browser may disable storage or reach its quota. */ }
}
export function clearCampaignSession(key: string, target: SessionStorage | null = storage()) {
  try { target?.removeItem(key); } catch { /* Storage may be disabled. */ }
}

// Recovery accepts temporarily incomplete fields (e.g. an empty name/date while typing).
// Server saves still use the complete marketingAssetInputSchema and its refinements.
const draftConfigSchema = z.object({ ...campaignConfigSchema.shape, replyTo: z.string().max(320) });
const draftSchema = z.object({ ...marketingAssetInputSchema.shape, title: z.string().max(160), startDate: z.string().max(10), endDate: z.string().max(10), campaignConfig: draftConfigSchema.optional() });
export const campaignRecoverySchema = z.object({
  base: marketingAssetInputSchema,
  draft: draftSchema,
  tagText: z.string().max(2000),
  step: campaignStepSchema,
  view: campaignViewSchema,
  settingsOpen: z.boolean(),
});
export type CampaignRecovery = z.infer<typeof campaignRecoverySchema>;

export function recoverCampaign(value: CampaignRecovery | null, asset: MarketingAsset): CampaignRecovery | null {
  if (!value || asset.dispatch || value.base.id !== asset.id || value.draft.id !== asset.id || value.base.year !== asset.year || value.draft.year !== asset.year || value.base.category !== asset.category || value.draft.category !== asset.category || value.base.updatedAt !== asset.updatedAt) return null;
  return value;
}

const templateSchema = z.custom<LibraryDocument>(value => {
  if (!value || typeof value !== "object") return false;
  const item = value as LibraryDocument;
  return z.uuid().safeParse(item.id).success && documentMetadataSchema.safeParse(item).success && item.kind === "template" && typeof item.subject === "string" && typeof item.body === "string";
});
export const campaignDesignerRecoverySchema = z.object({
  initial: emailDesignSchema,
  design: emailDesignSchema,
  title: z.string().max(200),
  template: templateSchema.nullable(),
});
export type CampaignDesignerRecovery = z.infer<typeof campaignDesignerRecoverySchema>;
