const submissionSources = new Set(["shopify_b2b_form", "shopify_b2b_form_opt_in", "meta_lead_ads"]);

/** The same recorded first-party inquiry exception used by the workflow sender. */
export function isCampaignContactEligible(verificationStatus: string, consentSource: string | null | undefined) {
  return verificationStatus === "valid" || (["unverified", "unknown"].includes(verificationStatus) && submissionSources.has(consentSource ?? ""));
}
