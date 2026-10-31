"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { isIP } from "node:net";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { readErpConnection } from "@/lib/data/erp-settings";
import { erpSettingsSchema, publicCrmOrigin, settingsConfig } from "@/lib/erp-settings";
import { lingxingConfig, LingxingError, listLingxingWarehouses, testLingxingConnection } from "@/lib/lingxing";

async function validatedConnection(input: unknown, testing = false) {
  const parsed = erpSettingsSchema.safeParse(testing && input && typeof input === "object" ? { ...input, syncInterval: 0 } : input);
  if (!parsed.success) throw new LingxingError(parsed.error.issues[0]?.message || "Check the ERP connection fields.");
  const saved = await readErpConnection();
  let previous = saved ? { appId: saved.app_id, appSecret: saved.app_secret } : null;
  if (!saved) {
    try { previous = lingxingConfig(); } catch { /* A new secret replaces invalid legacy config. */ }
  }
  try { return { input: parsed.data, config: settingsConfig(parsed.data, previous) }; }
  catch (error) { throw new LingxingError(error instanceof Error ? error.message : "Enter valid API credentials."); }
}

function errorText(error: unknown) {
  return error instanceof LingxingError ? error.message : "Unable to update the ERP connection. Please refresh Settings and try again.";
}

export async function saveErpConnection(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  try {
    const { input: values, config } = await validatedConnection(input);
    let workerUrl: string | null = null;
    if (values.enabled && values.syncInterval > 0) {
      const requestHeaders = await headers();
      const browserOrigin = publicCrmOrigin(requestHeaders.get("origin") || "");
      const suppliedOrigin = publicCrmOrigin(values.appUrl);
      if (!browserOrigin || browserOrigin !== suppliedOrigin) throw new LingxingError("Save automatic updates from your deployed HTTPS CRM address. Localhost supports manual sync.");
      workerUrl = `${browserOrigin}/api/cron/inventory`;
    }
    const { data, error } = await createSupabaseAdmin().rpc("save_erp_connection", {
      p_name: values.name, p_app_id: config.appId, p_app_secret: config.appSecret,
      p_warehouse_ids: config.warehouseIds ? config.warehouseIds.split(",") : [], p_sku_map: config.skuMap,
      p_enabled: values.enabled, p_sync_interval: values.syncInterval, p_worker_url: workerUrl,
      p_revision: values.revision, p_updated_by: viewer.id,
    });
    if (error) {
      if (error.code === "40001") throw new LingxingError("ERP settings changed in another session. Refresh this page before saving.");
      throw new Error("ERP settings save failed.");
    }
    revalidatePath("/settings/erp"); revalidatePath("/products");
    return { ok: true as const, revision: Number(data) };
  } catch (error) { return { ok: false as const, error: errorText(error) }; }
}

export async function testErpConnection(input: unknown) {
  await requireWorkspaceMember(["admin"]);
  try {
    const { config } = await validatedConnection(input, true);
    const rows = await testLingxingConnection(config);
    return { ok: true as const, rows };
  } catch (error) { return { ok: false as const, error: errorText(error) }; }
}

export async function loadErpWarehouses(input: unknown) {
  await requireWorkspaceMember(["admin"]);
  try {
    const { config } = await validatedConnection(input, true);
    return { ok: true as const, warehouses: await listLingxingWarehouses(config) };
  } catch (error) { return { ok: false as const, error: errorText(error) }; }
}

export async function detectErpServerIp() {
  await requireWorkspaceMember(["admin"]);
  try {
    const response = await fetch("https://toolbox.lingxing.com/api/getIp", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error();
    const text = (await response.text()).slice(0, 2000);
    let ip = text.trim().replace(/^"|"$/g, "");
    if (!isIP(ip)) ip = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0] || "";
    if (!isIP(ip)) throw new Error();
    return { ok: true as const, ip };
  } catch { return { ok: false as const, error: "Could not detect the server IP. Ask your hosting provider for the CRM's outbound IP addresses." }; }
}
