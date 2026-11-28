export const MARKETING_ORIGIN = "https://www.newai.xin";
export const MARKETING_APP_ORIGIN = "https://app.newai.xin";

/** Exact matches keep customer portal domains separate from the public brand site. */
export function isMarketingHost(hostname: string) {
  return hostname === "www.newai.xin" || hostname === "newai.xin";
}

