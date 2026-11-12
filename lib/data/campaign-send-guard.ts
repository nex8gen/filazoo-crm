import type { WorkspaceViewer } from "../auth.ts";
import type { EmailSendInput } from "../email-workbench.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { env } from "../env.ts";
import { evaluateSend } from "../outreach-policy.ts";
import { CampaignDeliveryBlocked } from "../email-send-failure.ts";
import { isCampaignContactEligible } from "../campaign-contact-eligibility.ts";

/** Recheck mutable eligibility at delivery, including after an attachment/footer is prepared. */
export async function assertCampaignDelivery(viewer: WorkspaceViewer, input: EmailSendInput) {
  if (!input.campaign) return;
  const db = createSupabaseAdmin();
  const { data: campaign } = await db.from("marketing_assets").select("id,dispatch").eq("id", input.campaign.id).maybeSingle().throwOnError();
  if (!campaign?.dispatch || campaign.dispatch.userId !== viewer.id) throw new CampaignDeliveryBlocked("This campaign is not queued by this sender.");
  const { data: contact } = await db.from("contacts").select("id,company_id,email,verification_status,unsubscribed,consent_source").eq("id", input.campaign.contactId).maybeSingle().throwOnError();
  if (!contact || input.to.length !== 1 || String(contact.email).toLowerCase() !== input.to[0].toLowerCase()) throw new CampaignDeliveryBlocked("This recipient is no longer available.");
  if (viewer.role === "bd_manager") {
    const { data: assignment } = await db.from("pipeline").select("id").eq("company_id", contact.company_id).eq("owner_id", viewer.id).limit(1).maybeSingle().throwOnError();
    if (!assignment) throw new CampaignDeliveryBlocked("This recipient is no longer assigned to you.");
  }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const [{ count: suppressed }, { count: unsubscribed }, { count: sentToday }] = await Promise.all([
    db.from("suppression").select("email", { count: "exact", head: true }).eq("email", contact.email).throwOnError(),
    db.from("contacts").select("id", { count: "exact", head: true }).eq("email", contact.email).eq("unsubscribed", true).throwOnError(),
    db.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("user_id", viewer.id).gte("sent_at", today.toISOString()).throwOnError(),
  ]);
  const decision = evaluateSend({ email: contact.email, verified: contact.verification_status === "valid", inquiryResponse: isCampaignContactEligible(contact.verification_status, contact.consent_source), unsubscribed: Boolean(contact.unsubscribed || unsubscribed), suppressed: Boolean(suppressed), sentToday: sentToday ?? 0, dailyLimit: env.DAILY_SEND_LIMIT, bounceRate: 0, bouncePausePercent: env.BOUNCE_PAUSE_PERCENT, dryRun: env.dryRun });
  if (!decision.allowed || decision.mode !== "send") throw new CampaignDeliveryBlocked(decision.reason);
  if (input.campaign.smartSending) {
    const { count } = await db.from("mailbox_sent_messages").select("id", { count: "exact", head: true }).eq("user_id", viewer.id).eq("to_email", contact.email.toLowerCase()).gte("sent_at", new Date(Date.now() - 16 * 3600_000).toISOString()).throwOnError();
    if (count) throw new CampaignDeliveryBlocked("Smart sending: this recipient was emailed in the last 16 hours.");
  }
}
