import "server-only";
import { cache } from "react";
import { requireWorkspaceMember } from "../auth.ts";
import { env, hasSupabaseConfig } from "../env.ts";
import type { AppConnectionSummary } from "../app-connection-status.ts";
import { getViewerMailboxes } from "./mailboxes.ts";
import { emailConnectionAccounts, emailProviderSummary, type EmailConnectionsOverview } from "../email-connections.ts";
import { getErpSettingsView } from "./erp-settings.ts";

const getEmailAppMailboxes = cache(async () => {
  const viewer = await requireWorkspaceMember();
  return getViewerMailboxes(viewer.id);
});

export const getPersonalAppMailboxes = cache(async () => {
  const viewer = await requireWorkspaceMember();
  const mailboxes = await getEmailAppMailboxes();
  return { mailboxes: mailboxes.filter(mailbox => mailbox.type === "personal" && mailbox.userId === viewer.id) };
});

export const getTeamAppMailboxes = cache(async () => {
  await requireWorkspaceMember(["admin"]);
  const mailboxes = await getEmailAppMailboxes();
  return { mailboxes: mailboxes.filter(mailbox => mailbox.type === "workspace") };
});

export const getEmailConnectionsOverview = cache(async (): Promise<EmailConnectionsOverview> => {
  const viewer = await requireWorkspaceMember();
  try { return { accounts: emailConnectionAccounts(await getEmailAppMailboxes(), viewer.id), error: null }; }
  catch { return { accounts: [], error: "Email connections could not be loaded. Refresh before changing an account." }; }
});

export const getAppConnectionSummaries = cache(async (): Promise<Record<string, AppConnectionSummary>> => {
  const viewer = await requireWorkspaceMember();
  const [mailboxes, erp] = await Promise.allSettled([
    getEmailConnectionsOverview(), viewer.role === "admin" ? getErpSettingsView() : Promise.resolve(null),
  ]);
  const summaries: Record<string, AppConnectionSummary> = {};
  for (const id of ["gmail", "outlook", "netease-mail"]) summaries[id] = mailboxes.status === "fulfilled"
    ? emailProviderSummary(mailboxes.value, id)
    : { status: "unavailable", message: "Saved account status could not be loaded." };
  summaries.lingxing = erp.status === "rejected" ? { status: "unavailable" }
    : erp.value?.hasSecret && erp.value.appId ? { status: erp.value.enabled ? "connected" : "paused", message: "Credentials are saved. Use Test connection to verify current ERP access." }
    : { status: viewer.role === "admin" ? "not_connected" : "unavailable" };
  const twilio = Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WEBHOOK_URL);
  const meta = Boolean(env.META_FACEBOOK_PAGE_ACCESS_TOKEN && env.META_FACEBOOK_PAGE_ID && env.META_WEBHOOK_SECRET && env.META_VERIFY_TOKEN);
  // Server credentials mean setup exists; they do not prove a working channel.
  summaries.whatsapp = { status: twilio && env.TWILIO_WHATSAPP_FROM ? "configured" : "not_connected" };
  summaries.facebook = { status: meta || (twilio && env.TWILIO_FACEBOOK_FROM) ? "configured" : "not_connected" };
  summaries.instagram = { status: meta ? "configured" : "not_connected" };
  summaries.shopify = { status: env.SHOPIFY_WEBHOOK_SECRET && env.SHOPIFY_STORE_DOMAIN ? "configured" : "not_connected" };
  for (const id of ["meta-leads", "make"]) summaries[id] = { status: hasSupabaseConfig() ? "configured" : "not_connected" };
  for (const id of ["google-calendar", "outlook-calendar", "google-drive", "onedrive", "zapier"]) summaries[id] = { status: "planned" };
  return summaries;
});
