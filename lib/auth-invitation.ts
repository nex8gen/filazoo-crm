import type { GenerateLinkType } from "@supabase/supabase-js";

export function buildInvitationConfirmationUrl(appUrl: string, tokenHash: string, type: GenerateLinkType) {
  const url = new URL("/auth/confirm", appUrl);
  if (url.hostname.endsWith(".vercel.app")) {
    throw new Error("Team invitations require a public custom-domain NEXT_PUBLIC_APP_URL.");
  }
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  url.searchParams.set("next", "/accept-invitation");
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
      "Open the secure link below to complete your profile, choose a password, and activate your account:",
      confirmationUrl,
      "",
      "This link is personal and expires. If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
    html: `<p>Hello ${safeName},</p><p>You have been invited to join the Filazoo CRM workspace.</p><p><a href="${safeUrl}">Complete your profile and activate your account</a></p><p>This link is personal and expires. If you were not expecting this invitation, you can ignore this email.</p>`,
  };
}
