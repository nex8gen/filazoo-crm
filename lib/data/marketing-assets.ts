import "server-only";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { marketingAssetInputSchema, type MarketingAsset } from "../marketing-assets.ts";

export class MarketingAssetError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
type AssetRow = { id: string; category: MarketingAsset["category"]; slot: string; year: number; title: string; start_date: string; end_date: string; product_skus: string[]; audience: string; offer: string; message: string; status: MarketingAsset["status"]; updated_at: string };
const selection = "id,category,slot,year,title,start_date,end_date,product_skus,audience,offer,message,status,updated_at";
function fromRow(row: AssetRow): MarketingAsset {
  return { id: row.id, category: row.category, slot: row.slot, year: row.year, title: row.title, startDate: row.start_date, endDate: row.end_date, productSkus: row.product_skus, audience: row.audience, offer: row.offer, message: row.message, status: row.status, updatedAt: row.updated_at };
}
function databaseError(error: { code?: string }) {
  return new MarketingAssetError(["42P01", "PGRST205"].includes(error.code ?? "") ? "Marketing Assets setup is unavailable. Apply the marketing_assets database migration." : "Marketing assets could not be loaded or saved. Please try again.", 503);
}
function requireWriter(viewer: WorkspaceViewer) {
  if (viewer.role === "viewer") throw new MarketingAssetError("Your role can view marketing assets. Ask a workspace editor to make changes.", 403);
}
export async function listMarketingAssets(viewer: WorkspaceViewer, year: number): Promise<MarketingAsset[]> {
  return withWorkspaceViewer(viewer, async () => {
    const { data, error } = await createSupabaseAdmin().from("marketing_assets").select(selection).eq("year", year).order("start_date").limit(1000);
    if (error) throw databaseError(error);
    return (data as AssetRow[]).map(fromRow);
  });
}
export async function saveMarketingAsset(viewer: WorkspaceViewer, value: unknown): Promise<MarketingAsset> {
  requireWriter(viewer);
  const parsed = marketingAssetInputSchema.safeParse(value);
  if (!parsed.success) throw new MarketingAssetError(parsed.error.issues[0]?.message ?? "Check the promotion fields.");
  return withWorkspaceViewer(viewer, async () => {
    const asset = parsed.data, db = createSupabaseAdmin();
    if (asset.productSkus.length) {
      const products = await db.from("products").select("sku").in("sku", asset.productSkus).eq("active", true);
      if (products.error) throw databaseError(products.error);
      if (products.data.length !== asset.productSkus.length) throw new MarketingAssetError("A selected product is unavailable. Remove it or refresh the catalog.");
    }
    const row = { category: asset.category, slot: asset.slot, year: asset.year, title: asset.title, start_date: asset.startDate, end_date: asset.endDate, product_skus: asset.productSkus, audience: asset.audience, offer: asset.offer, message: asset.message, status: asset.status, updated_at: new Date().toISOString(), updated_by: viewer.id };
    const result = asset.updatedAt
      ? await db.from("marketing_assets").update(row).eq("id", asset.id).eq("updated_at", asset.updatedAt).select(selection).maybeSingle()
      : await db.from("marketing_assets").insert({ ...row, id: asset.id, created_by: viewer.id }).select(selection).single();
    if (result.error?.code === "23505" || (!result.error && !result.data)) throw new MarketingAssetError("This plan changed in another session. Reload the page before saving.", 409);
    if (result.error) throw databaseError(result.error);
    return fromRow(result.data as AssetRow);
  });
}
export async function deleteMarketingAsset(viewer: WorkspaceViewer, id: string, updatedAt: string) {
  requireWriter(viewer);
  return withWorkspaceViewer(viewer, async () => {
    const result = await createSupabaseAdmin().from("marketing_assets").delete().eq("id", id).eq("updated_at", updatedAt).select("id").maybeSingle();
    if (result.error) throw databaseError(result.error);
    if (!result.data) throw new MarketingAssetError("This plan changed in another session. Reload before deleting.", 409);
  });
}
