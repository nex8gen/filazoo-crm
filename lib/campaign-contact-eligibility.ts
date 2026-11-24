const submissionSources = new Set(["shopify_b2b_form", "shopify_b2b_form_opt_in", "meta_lead_ads"]);

/** The same recorded first-party inquiry exception used by the workflow sender. */
export function isCampaignContactEligible(verificationStatus: string, consentSource: string | null | undefined) {
  return verificationStatus === "valid" || (["unverified", "unknown"].includes(verificationStatus) && submissionSources.has(consentSource ?? ""));
}

export function campaignContactStatus(contact: { email: string; verificationStatus: string; consentSource?: string | null; unsubscribed?: boolean; suppressed?: boolean }) {
  if (!contact.email.trim()) return { eligible: false, status: "Missing email", reason: "Add an email address to this contact before campaign sending." };
  if (contact.unsubscribed) return { eligible: false, status: "Unsubscribed", reason: "This email address has opted out of email and is excluded from campaigns." };
  if (contact.suppressed) return { eligible: false, status: "Suppressed", reason: "This email address is on the suppression list and is excluded from campaigns." };
  if (contact.verificationStatus === "invalid") return { eligible: false, status: "Invalid email", reason: "Email verification marked this address invalid. Correct the address before campaign sending." };
  if (contact.verificationStatus === "risky") return { eligible: false, status: "Risky email", reason: "Email verification marked this address risky. Review and verify the address before campaign sending." };
  if (isCampaignContactEligible(contact.verificationStatus, contact.consentSource)) return {
    eligible: true,
    status: contact.verificationStatus === "valid" ? "Verified" : "Submitted",
    reason: contact.verificationStatus === "valid" ? "This email address has been verified." : "This contact has a recorded Shopify or Meta form submission and is eligible for campaign email.",
  };
  return { eligible: false, status: "Unverified email", reason: contact.consentSource === "historical_customer_email"
    ? "This contact came from email history. Its address has not been verified for campaign sending."
    : "This address has not been verified and has no recorded Shopify or Meta form submission. Verify the address before campaign sending." };
}
