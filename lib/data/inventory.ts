import "server-only";
import { cache } from "react";
import { requireWorkspaceMember } from "../auth.ts";
import { hasSupabaseConfig } from "../env.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { fetchLingxingInventory, LingxingError } from "../lingxing.ts";
import { configuredErp } from "./erp-settings.ts";
import { applyProductInventory, type StockSnapshot } from "../product-inventory.ts";
import type { Product } from "../types.ts";

export type InventoryStatus = { configured: boolean; configurationError: string | null; warehouseIds: string; lastSyncedAt: string | null; lastError: string | null; running: boolean; stale: boolean };

export const getInventoryState = cache(async () => {
  await requireWorkspaceMember();
  let config;
  let configurationError: string | null = null;
  try { config = await configuredErp(); } catch (error) { configurationError = error instanceof Error ? error.message : "Invalid ERP configuration."; }
  const status: InventoryStatus = { configured: Boolean(config), configurationError, warehouseIds: config?.warehouseIds || "", lastSyncedAt: null, lastError: null, running: false, stale: false };
  if (!hasSupabaseConfig() || !config) return { status, snapshots: [] as StockSnapshot[], skuMap: {} as Record<string, string> };
  const client = createSupabaseAdmin();
  const [{ data: runs, error: runError }, snapshots] = await Promise.all([
    client.from("inventory_sync_runs").select("id,status,started_at,finished_at,error_message").eq("scope", config.scope).order("started_at", { ascending: false }).limit(10),
    (async () => {
      // Read only this account/warehouse scope, preserving complete pagination.
      const rows: StockSnapshot[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from("erp_inventory").select("sku,available,on_hand,locked,warehouse_ids,synced_at").eq("scope", config.scope).order("sku").range(offset, offset + 999);
        if (error) throw new Error("Unable to load ERP stock. Please try again.");
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      return rows;
    })(),
  ]);
  if (runError) throw new Error("Unable to read ERP sync status. Apply the inventory migration first.");
  const latest = runs?.[0];
  status.running = latest?.status === "running" && Date.now() - new Date(latest.started_at).getTime() < 300_000;
  status.lastError = latest?.status === "failed" ? latest.error_message : null;
  status.lastSyncedAt = snapshots[0]?.synced_at ?? runs?.find(run => run.status === "succeeded")?.finished_at ?? null;
  status.stale = Boolean(status.lastSyncedAt && Date.now() - new Date(status.lastSyncedAt).getTime() > 30 * 60_000);
  return { status, snapshots, skuMap: config.skuMap };
});

export async function withErpInventory(products: Product[], state?: Awaited<ReturnType<typeof getInventoryState>>) {
  const { status, snapshots, skuMap } = state ?? await getInventoryState();
  // Existing manually maintained labels continue until the ERP is configured.
  return status.configured ? applyProductInventory(products, snapshots, skuMap) : products;
}

export async function syncErpInventory() {
  const config = await configuredErp();
  if (!config) throw new LingxingError("Add or enable your Lingxing connection in Settings → ERP connection first.");
  const client = createSupabaseAdmin();
  const { data: runId, error: claimError } = await client.rpc("claim_inventory_sync", { p_scope: config.scope });
  if (claimError) throw new Error("Unable to start the stock sync. Check the inventory database migration.");
  if (!runId) return { skipped: true, count: 0 };
  try {
    const entries = await fetchLingxingInventory(config);
    const { error } = await client.rpc("finish_inventory_sync", { p_run_id: runId, p_entries: entries });
    if (error) throw new Error("Unable to save the ERP stock snapshot. Previous stock was kept.");
    return { skipped: false, count: entries.length };
  } catch (error) {
    const message = error instanceof LingxingError ? error.message : "The inventory sync failed. Previous stock was kept.";
    const { error: recordError } = await client.from("inventory_sync_runs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", runId).eq("status", "running");
    if (recordError) console.error("Could not record ERP inventory sync failure.");
    throw new LingxingError(message);
  }
}
