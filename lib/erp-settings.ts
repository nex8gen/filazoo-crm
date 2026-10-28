import { z } from "zod";
import { lingxingConfig } from "./lingxing.ts";

export const erpSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  appId: z.string().trim().refine(value => [16, 24, 32].includes(new TextEncoder().encode(value).length), "Enter a valid Lingxing App ID."),
  appSecret: z.string().trim().max(512).default(""),
  warehouseIds: z.string().trim().max(5000).regex(/^(?:\d+(?:\s*,\s*\d+)*)?$/, "Use comma-separated warehouse IDs."),
  mappings: z.array(z.object({ crmSku: z.string().trim().min(1).max(200), erpSku: z.string().trim().min(1).max(200) })).max(2000),
  enabled: z.boolean(),
  syncInterval: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(60), z.literal(1440)]),
  revision: z.number().int().min(0),
  appUrl: z.string().max(500).default(""),
}).superRefine((value, ctx) => {
  const keys = value.mappings.map(item => item.crmSku);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["mappings"], message: "Each CRM SKU can only have one ERP mapping." });
  if (value.enabled && value.syncInterval > 0 && !publicCrmOrigin(value.appUrl)) ctx.addIssue({ code: "custom", path: ["syncInterval"], message: "Automatic updates require a deployed HTTPS CRM. Use manual sync on localhost." });
});

export type ErpSettingsInput = z.infer<typeof erpSettingsSchema>;
export type ErpSettingsView = Omit<ErpSettingsInput, "appSecret" | "appUrl"> & { hasSecret: boolean; source: "settings" | "environment" | "none"; schedulerError: string | null };

// This is the CRM origin from the current browser, never an arbitrary API URL.
// A connection's upstream API is fixed by its provider, preventing credential
// submission to an attacker-supplied endpoint.
export function publicCrmOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.pathname !== "/" || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host) || /\.(?:local|localhost|internal|test|invalid)$/.test(host)) return null;
    return url.origin;
  } catch { return null; }
}

export function settingsConfig(input: ErpSettingsInput, saved: { appId: string; appSecret: string } | null) {
  const secret = input.appSecret || (saved?.appId === input.appId ? saved.appSecret : "");
  if (!secret) throw new Error("Enter the App Secret for this App ID. A blank field only keeps the secret for the same saved App ID.");
  return lingxingConfig({ LINGXING_APP_ID: input.appId, LINGXING_APP_SECRET: secret, LINGXING_WAREHOUSE_IDS: input.warehouseIds, LINGXING_SKU_MAP: JSON.stringify(Object.fromEntries(input.mappings.map(item => [item.crmSku, item.erpSku]))) })!;
}
