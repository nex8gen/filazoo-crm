import type { GenerateLinkType } from "@supabase/supabase-js";

export function buildInvitationConfirmationUrl(appUrl: string, tokenHash: string, type: GenerateLinkType) {
  const url = new URL("/auth/confirm", appUrl);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("next", "/update-password");
  return url.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildInvitationEmail(displayName: string, confirmationUrl: string) {
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(confirmationUrl);

  return {
    subject: "You have been invited to Filazoo CRM",
    text: [
      `Hello ${displayName},`,
      "",
      "You have been invited to join the Filazoo CRM workspace.",
      "Open the secure link below to choose your password and activate your account:",
      confirmationUrl,
      "",
      "This link is personal and expires. If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
    html: `<p>Hello ${safeName},</p><p>You have been invited to join the Filazoo CRM workspace.</p><p><a href="${safeUrl}">Choose your password and activate your account</a></p><p>This link is personal and expires. If you were not expecting this invitation, you can ignore this email.</p>`,
  };
}
