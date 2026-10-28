import "server-only";
import { cache } from "react";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { requireWorkspaceMember } from "../auth.ts";
import { hasSupabaseConfig } from "../env.ts";
import { lingxingConfig, type LingxingConfig } from "../lingxing.ts";
import type { ErpSettingsView } from "../erp-settings.ts";

type SavedConnection = {
  name: string; app_id: string; app_secret: string; warehouse_ids: string[]; sku_map: Record<string, string>;
  enabled: boolean; sync_interval: 0 | 5 | 15 | 60 | 1440; revision: number; last_dispatch_error: string | null;
};

export const readErpConnection = cache(async (): Promise<SavedConnection | null> => {
  if (!hasSupabaseConfig()) return null;
  const { data, error } = await createSupabaseAdmin().rpc("read_erp_connection");
  if (error) throw new Error("Unable to load ERP connection settings. Check the connection settings migration.");
  return data as SavedConnection | null;
});

export async function configuredErp(): Promise<LingxingConfig | null> {
  const saved = await readErpConnection();
  if (!saved) return lingxingConfig();
  if (!saved.enabled) return null; // A paused saved connection overrides legacy env credentials.
  return lingxingConfig({ LINGXING_APP_ID: saved.app_id, LINGXING_APP_SECRET: saved.app_secret, LINGXING_WAREHOUSE_IDS: saved.warehouse_ids.join(","), LINGXING_SKU_MAP: JSON.stringify(saved.sku_map) });
}

export async function getErpSettingsView(): Promise<ErpSettingsView> {
  await requireWorkspaceMember(["admin"]);
  const saved = await readErpConnection();
  if (saved) return {
    name: saved.name, appId: saved.app_id, hasSecret: Boolean(saved.app_secret), warehouseIds: saved.warehouse_ids.join(","),
    mappings: Object.entries(saved.sku_map).map(([crmSku, erpSku]) => ({ crmSku, erpSku })), enabled: saved.enabled,
    syncInterval: saved.sync_interval, revision: saved.revision, source: "settings", schedulerError: saved.last_dispatch_error,
  };
  let legacy: LingxingConfig | null = null;
  try { legacy = lingxingConfig(); } catch { /* Invalid legacy values can be replaced in Settings. */ }
  return { name: "Lingxing ERP", appId: legacy?.appId ?? "", hasSecret: Boolean(legacy?.appSecret), warehouseIds: legacy?.warehouseIds ?? "",
    mappings: Object.entries(legacy?.skuMap ?? {}).map(([crmSku, erpSku]) => ({ crmSku, erpSku })), enabled: true, syncInterval: 0,
    revision: 0, source: legacy ? "environment" : "none", schedulerError: null };
}

export async function erpWorkerAuthorized(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return false;
  const secret = authorization.slice(7);
  if (!/^[a-f0-9]{64}$/.test(secret) || !hasSupabaseConfig()) return false;
  const { data, error } = await createSupabaseAdmin().rpc("erp_worker_authorized", { p_secret: secret });
  return !error && data === true;
}
