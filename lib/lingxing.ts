import { createCipheriv, createHash } from "node:crypto";

const origin = "https://openapi.lingxing.com";
const inventoryPath = "/erp/sc/routing/data/local_inventory/inventoryDetails";

export type LingxingConfig = { appId: string; appSecret: string; warehouseIds: string; skuMap: Record<string, string>; scope: string };
export type InventoryEntry = { sku: string; available: number; on_hand: number; locked: number; warehouse_ids: string[] };

export function lingxingConfig(environment: Record<string, string | undefined> = process.env): LingxingConfig | null {
  const appId = environment.LINGXING_APP_ID?.trim();
  const appSecret = environment.LINGXING_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  if (![16, 24, 32].includes(Buffer.byteLength(appId))) throw new Error("Lingxing App ID must be a valid AES key (16, 24, or 32 bytes).");
  const warehouseIds = [...new Set((environment.LINGXING_WAREHOUSE_IDS || "").split(",").map(x => x.trim()).filter(Boolean))].sort().join(",");
  if (warehouseIds && !/^\d+(,\d+)*$/.test(warehouseIds)) throw new Error("Lingxing warehouse IDs must be comma-separated numbers.");
  let skuMap: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(environment.LINGXING_SKU_MAP || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.entries(parsed).some(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim())) throw new Error();
    skuMap = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key.trim(), (value as string).trim()]));
  } catch { throw new Error("LINGXING_SKU_MAP must be a JSON object mapping CRM SKUs to ERP SKUs."); }
  const scope = createHash("sha256").update(JSON.stringify([appId, warehouseIds])).digest("hex");
  return { appId, appSecret, warehouseIds, skuMap, scope };
}

// Current Lingxing guide: ASCII sort → uppercase MD5 → AES ECB / PKCS padding.
// The App ID (not the App Secret) is the AES key. The raw token participates
// in the signature, while transport uses the Authorization header.
export function lingxingSign(params: Record<string, string | number>, appId: string) {
  const text = Object.keys(params).sort().filter(key => params[key] !== "").map(key => `${key}=${params[key]}`).join("&");
  const digest = createHash("md5").update(text).digest("hex").toUpperCase();
  const cipher = createCipheriv(`aes-${Buffer.byteLength(appId) * 8}-ecb`, Buffer.from(appId), null);
  return Buffer.concat([cipher.update(digest, "utf8"), cipher.final()]).toString("base64");
}

export class LingxingError extends Error {}

async function readResponse(response: Response, tokenRequest: boolean) {
  if (!response.ok) throw new LingxingError(`Lingxing returned HTTP ${response.status}. Check API access and the server IP allowlist.`);
  let payload;
  try { payload = await response.json(); } catch { throw new LingxingError("Lingxing returned an invalid response. Previous stock was kept."); }
  if (!payload || Number(payload.code) !== (tokenRequest ? 200 : 0)) {
    // Never surface upstream messages: they may contain credentials/request URLs.
    const code = String(payload?.code ?? "unknown").replace(/[^\w-]/g, "").slice(0,30);
    throw new LingxingError(`Lingxing rejected the request (code ${code}). Check credentials, inventory permission, and the server IP allowlist.`);
  }
  return payload;
}

function quantity(value: unknown) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isSafeInteger(Number(value))) throw new LingxingError("Lingxing returned an invalid stock quantity. Previous stock was kept.");
  return Number(value);
}

async function accessToken(config: LingxingConfig, fetcher: typeof fetch, signal: AbortSignal) {
  const credentials = new FormData();
  credentials.set("appId", config.appId);
  credentials.set("appSecret", config.appSecret);
  const auth = await readResponse(await fetcher(`${origin}/api/auth-server/oauth/access-token`, { method: "POST", body: credentials, cache: "no-store", signal }), true);
  const token = auth.data?.access_token;
  if (typeof token !== "string" || !token) throw new LingxingError("Lingxing did not return an access token.");
  return token;
}

async function signedPost(config: LingxingConfig, token: string, path: string, body: Record<string, string | number>, fetcher: typeof fetch, signal: AbortSignal) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = lingxingSign({ ...body, app_key: config.appId, timestamp, access_token: token }, config.appId);
  const query = new URLSearchParams({ app_key: config.appId, timestamp: String(timestamp), sign });
  return readResponse(await fetcher(`${origin}${path}?${query}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal,
  }), false);
}

export async function testLingxingConnection(config: LingxingConfig, fetcher: typeof fetch = fetch) {
  try {
    const signal = AbortSignal.timeout(30_000);
    const token = await accessToken(config, fetcher, signal);
    const result = await signedPost(config, token, inventoryPath, { offset: 0, length: 1, ...(config.warehouseIds ? { wid: config.warehouseIds } : {}) }, fetcher, signal);
    if (!Array.isArray(result.data) || !Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0) throw new LingxingError("Lingxing returned an invalid inventory response.");
    return Number(result.total);
  } catch (error) {
    if (error instanceof LingxingError) throw error;
    throw new LingxingError("Could not reach Lingxing. Check network access and the server IP allowlist.");
  }
}

export type LingxingWarehouse = { id: string; name: string; type: "local" | "overseas" };
export async function listLingxingWarehouses(config: LingxingConfig, fetcher: typeof fetch = fetch): Promise<LingxingWarehouse[]> {
  try {
    const signal = AbortSignal.timeout(60_000);
    const token = await accessToken(config, fetcher, signal);
    const warehouses: LingxingWarehouse[] = [];
    for (const type of [1, 3]) {
      for (let offset = 0; ; offset += 1000) {
        if (offset >= 20_000) throw new LingxingError("Too many warehouses. Enter the warehouse IDs manually.");
        const result = await signedPost(config, token, "/erp/sc/data/local_inventory/warehouse", { type, is_delete: 0, offset, length: 1000 }, fetcher, signal);
        if (!Array.isArray(result.data)) throw new LingxingError("Lingxing returned an invalid warehouse list.");
        for (const row of result.data) {
          if (!/^\d+$/.test(String(row?.wid)) || typeof row?.name !== "string") throw new LingxingError("Lingxing returned an invalid warehouse.");
          warehouses.push({ id: String(row.wid), name: row.name, type: type === 1 ? "local" : "overseas" });
        }
        if (result.data.length < 1000) break;
      }
    }
    return [...new Map(warehouses.map(item => [item.id, item])).values()];
  } catch (error) {
    if (error instanceof LingxingError) throw error;
    throw new LingxingError("Could not load warehouses. Check warehouse-list API permission, or enter the IDs manually.");
  }
}

export async function fetchLingxingInventory(config: LingxingConfig, fetcher: typeof fetch = fetch, signal: AbortSignal = AbortSignal.timeout(240_000)): Promise<InventoryEntry[]> {
  try {
    const token = await accessToken(config, fetcher, signal);
    const entries = new Map<string, InventoryEntry>();
    const seen = new Set<string>();
    let expectedTotal: number | undefined;
    let offset = 0;
    const length = 800;
    for (let page = 0; page < 500; page++) {
      signal.throwIfAborted();
      const body = { offset, length, ...(config.warehouseIds ? { wid: config.warehouseIds } : {}) };
      const result = await signedPost(config, token, inventoryPath, body, fetcher, signal);
      if (!Array.isArray(result.data) || !Number.isSafeInteger(Number(result.total)) || Number(result.total) < 0) throw new LingxingError("Lingxing returned invalid inventory pagination. Previous stock was kept.");
      const total = Number(result.total);
      if (expectedTotal !== undefined && total !== expectedTotal) throw new LingxingError("ERP inventory changed during pagination. Please sync again; previous stock was kept.");
      expectedTotal = total;
      if (result.data.length > length || (result.data.length === 0 && offset < total)) throw new LingxingError("Lingxing returned an incomplete inventory page. Previous stock was kept.");
      for (const row of result.data) {
        if (!row || typeof row.sku !== "string" || !row.sku.trim() || row.wid == null || row.seller_id == null || row.fnsku == null) throw new LingxingError("Lingxing returned an invalid inventory row. Previous stock was kept.");
        const sku = row.sku.trim();
        const wid = String(row.wid);
        if (config.warehouseIds && !config.warehouseIds.split(",").includes(wid)) throw new LingxingError("Lingxing returned stock outside the selected warehouses.");
        const key = JSON.stringify([sku, wid, String(row.seller_id), String(row.fnsku)]);
        if (seen.has(key)) throw new LingxingError("Lingxing returned duplicate inventory rows. Please sync again; previous stock was kept.");
        seen.add(key);
        const entry: InventoryEntry = entries.get(sku) ?? { sku, available: 0, on_hand: 0, locked: 0, warehouse_ids: [] };
        entry.available += quantity(row.product_valid_num);
        entry.on_hand += quantity(row.product_total);
        entry.locked += quantity(row.product_lock_num);
        if (!entry.warehouse_ids.includes(wid)) entry.warehouse_ids.push(wid);
        if (![entry.available, entry.on_hand, entry.locked].every(Number.isSafeInteger)) throw new LingxingError("Lingxing stock quantities exceed supported limits.");
        entries.set(sku, entry);
      }
      offset += result.data.length;
      if (offset > total) throw new LingxingError("Lingxing inventory total did not match its rows.");
      if (offset === total) return [...entries.values()];
    }
    throw new LingxingError("Lingxing inventory exceeded the sync page limit. Select fewer warehouses.");
  } catch (error) {
    if (error instanceof LingxingError) throw error;
    throw new LingxingError("Could not reach Lingxing or the sync timed out. Check network access; previous stock was kept.");
  }
}
