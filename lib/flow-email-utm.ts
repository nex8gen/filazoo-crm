import type { JsonConfig } from "./flows.ts";

export const flowUtmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
export function applyFlowUtm(url: URL, config: JsonConfig, flowId: string) {
  if (config.utmTracking === false) return url;
  const custom = config.useCustomUtm && config.utmParameters && typeof config.utmParameters === "object" && !Array.isArray(config.utmParameters) ? config.utmParameters : null;
  const defaults = { utm_source: "filazoo", utm_medium: "email", utm_campaign: flowId };
  if (custom) {
    for (const key of flowUtmKeys) {
      const value = custom[key];
      if (typeof value === "string" && value.trim()) url.searchParams.set(key, value.trim());
      else url.searchParams.delete(key);
    }
  } else for (const [key, value] of Object.entries(defaults)) url.searchParams.set(key, value);
  return url;
}
