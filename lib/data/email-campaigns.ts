import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { WorkspaceViewer } from "../auth.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { env } from "../env.ts";
import { listSegmentCompanies, listProducts } from "./crm.ts";
import { listSavedSegments } from "./segments.ts";
import { getViewerMailboxes, mailboxHasSmtp } from "./mailboxes.ts";
import { matchesSegment } from "../segments.ts";
import { isCampaignContactEligible } from "../campaign-contact-eligibility.ts";
import { campaignConfigSchema, campaignMessageIssues, personalizeCampaign, selectCampaignRecipients, type CampaignConfig, type CampaignOptions, type CampaignDeliverySummary } from "../email-campaigns.ts";
import { emailSendSchema } from "../email-workbench.ts";
import { buildFlowEmail } from "../flow-tracking.ts";
import { renderEmailDesign } from "../email-design.ts";
import { assignCampaignSubjects, embeddedCampaignPreheader } from "../campaign-message-tools.ts";
import { prepareComposerMessage } from "../email-composer.ts";
import { resolveEmailProductFeeds } from "../email-products.ts";
import { embedPrivateProductImages } from "./email-product-images.ts";
import { listMarketingAssets, MarketingAssetError } from "./marketing-assets.ts";

type Contact = { id: string; company_id: string; email: string; name: string | null; unsubscribed: boolean; verification_status: string; consent_source: string | null };

async function audienceData(viewer: WorkspaceViewer) {
  const [{ companies }, segments, mailboxes] = await Promise.all([listSegmentCompanies(), listSavedSegments(), getViewerMailboxes(viewer.id)]);
  const db = createSupabaseAdmin();
  const contacts: Contact[] = [];
  for (let batch = 0; batch < companies.length; batch += 200) {
    for (let offset = 0; ; offset += 1000) {
      const { data } = await db.from("contacts").select("id,company_id,email,name,unsubscribed,verification_status,consent_source")
        .in("company_id", companies.slice(batch, batch + 200).map(company => company.id)).order("id").range(offset, offset + 999).throwOnError();
      contacts.push(...(data ?? []) as Contact[]);
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  const suppressed = new Set<string>();
  for (let offset = 0; ; offset += 1000) {
    const { data } = await db.from("suppression").select("email").order("email").range(offset, offset + 999).throwOnError();
    for (const item of data ?? []) suppressed.add(String(item.email).toLowerCase());
    if ((data?.length ?? 0) < 1000) break;
  }
  const names = new Map(companies.map(company => [company.id, company.name]));
  const normalized = contacts.map(contact => ({ id: contact.id, companyId: contact.company_id, companyName: names.get(contact.company_id) ?? "", name: contact.name ?? "", email: contact.email ?? "", unsubscribed: contact.unsubscribed, sourceEligible: isCampaignContactEligible(contact.verification_status, contact.consent_source), eligible: isCampaignContactEligible(contact.verification_status, contact.consent_source) && !suppressed.has(String(contact.email).toLowerCase()) }));
  const memberships = new Map(segments.map(segment => [segment.id, new Set(companies.filter(company => matchesSegment(company, segment.rules)).map(company => company.id))]));
  const businessSegments = [...new Set(companies.map(company => company.segment))].sort((a, b) => a.localeCompare(b));
  for (const name of businessSegments) memberships.set(`business:${name}`, new Set(companies.filter(company => company.segment === name).map(company => company.id)));
  memberships.set("all", new Set(companies.map(company => company.id)));
  const count = (ids: Set<string>) => new Set(normalized.filter(contact => ids.has(contact.companyId) && contact.email.trim()).map(contact => contact.email.trim().toLowerCase())).size;
  const options: CampaignOptions = {
    mailboxes: mailboxes.map(mailbox => ({ id: mailbox.id, email: mailbox.email, name: mailbox.displayName ?? "", available: mailboxHasSmtp(mailbox) })),
    audiences: [{ id: "all", name: "All contacts", kind: "all", count: count(memberships.get("all")!) }, ...segments.map(segment => ({ id: segment.id, name: segment.name, kind: "saved" as const, count: count(memberships.get(segment.id)!) })), ...businessSegments.map(name => ({ id: `business:${name}`, name, kind: "business" as const, count: count(memberships.get(`business:${name}`)!) }))],
    contacts: contacts.map(contact => ({ id: `contact:${contact.id}`, name: contact.name || contact.email || "Unnamed contact", email: contact.email ?? "", companyName: names.get(contact.company_id) ?? "", verificationStatus: contact.verification_status, consentSource: contact.consent_source ?? "", eligible: isCampaignContactEligible(contact.verification_status, contact.consent_source) && !contact.unsubscribed && !suppressed.has(String(contact.email).toLowerCase()) })).sort((a, b) => a.name.localeCompare(b.name)),
    sendingEnabled: !env.dryRun,
  };
  return { options, normalized, memberships };
}

export async function getCampaignOptions(viewer: WorkspaceViewer) {
  return withWorkspaceViewer(viewer, async () => (await audienceData(viewer)).options);
}

export async function resolveCampaignAudience(viewer: WorkspaceViewer, config: CampaignConfig) {
  return withWorkspaceViewer(viewer, async () => {
    const { normalized, memberships, options } = await audienceData(viewer);
    const contactIds = new Set(normalized.map(contact => contact.id));
    for (const id of [...config.includeSegments, ...config.excludeSegments]) if (!memberships.has(id) && !(id.startsWith("contact:") && contactIds.has(id.slice(8)))) throw new MarketingAssetError("A selected audience or contact is no longer available. Refresh your selections.");
    const included = new Set(config.includeSegments.flatMap(id => [...(memberships.get(id) ?? [])]));
    const excluded = new Set(config.excludeSegments.flatMap(id => [...(memberships.get(id) ?? [])]));
    const includedContacts = new Set(config.includeSegments.filter(id => id.startsWith("contact:")).map(id => id.slice(8)));
    const excludedContacts = new Set(config.excludeSegments.filter(id => id.startsWith("contact:")).map(id => id.slice(8)));
    const recent = new Set<string>();
    if (config.smartSending) {
      for (let offset = 0; ; offset += 1000) {
        const { data } = await createSupabaseAdmin().from("mailbox_sent_messages").select("id,to_email").eq("user_id", viewer.id)
          .gte("sent_at", new Date(Date.now() - 16 * 3600_000).toISOString()).order("id").range(offset, offset + 999).throwOnError();
        for (const item of data ?? []) recent.add(String(item.to_email).toLowerCase());
        if ((data?.length ?? 0) < 1000) break;
      }
    }
    const selected = normalized.filter(contact => included.has(contact.companyId) || includedContacts.has(contact.id));
    return { ...selectCampaignRecipients(normalized, included, excluded, recent, includedContacts, excludedContacts), selected: new Set(selected.map(contact => contact.email.trim().toLowerCase()).filter(Boolean)).size, unverified: new Set(selected.filter(contact => !contact.sourceEligible).map(contact => contact.email.trim().toLowerCase())).size, options };
  });
}

export async function getCampaignDeliverySummary(viewer: WorkspaceViewer, id: string): Promise<CampaignDeliverySummary> {
  return withWorkspaceViewer(viewer, async () => {
    const empty = () => ({ total: 0, scheduled: 0, sent: 0, failed: 0, skipped: 0, pending: 0 });
    const result: CampaignDeliverySummary = empty();
    for (let offset = 0; ; offset += 1000) {
      const { data } = await createSupabaseAdmin().from("email_send_operations").select("id,status,payload->campaign").eq("campaign_id", id).order("id").range(offset, offset + 999).throwOnError();
      for (const operation of data ?? []) {
        const status = operation.status === "sent" ? "sent" : operation.status === "scheduled" ? "scheduled" : operation.status === "cancelled" ? "skipped" : ["failed", "uncertain"].includes(operation.status) ? "failed" : "pending";
        result.total++; result[status]++;
        const variant = (operation.campaign as { variant?: string } | null)?.variant;
        if (variant === "A" || variant === "B") {
          result.variants ??= { A: empty(), B: empty() };
          result.variants[variant].total++; result.variants[variant][status]++;
        }
      }
      if ((data?.length ?? 0) < 1000) return result;
    }
  });
}

export async function queueCampaign(viewer: WorkspaceViewer, id: string, year: number, updatedAt: string) {
  if (viewer.role === "viewer") throw new MarketingAssetError("Your role cannot send campaigns.", 403);
  return withWorkspaceViewer(viewer, async () => {
    const asset = (await listMarketingAssets(viewer, year)).find(item => item.id === id);
    if (!asset || asset.category !== "factory_sale") throw new MarketingAssetError("Campaign not found.", 404);
    if (asset.dispatch) return { dispatch: asset.dispatch, asset };
    if (asset.updatedAt !== updatedAt) throw new MarketingAssetError("This campaign changed. Reload before sending.", 409);
    const config = campaignConfigSchema.parse(asset.campaignConfig ?? {});
    const { recipients, options } = await resolveCampaignAudience(viewer, config);
    let emailDesign = config.emailDesign;
    if (emailDesign?.blocks.some(block => block.type === "product" && block.product?.mode === "dynamic")) emailDesign = resolveEmailProductFeeds(emailDesign, (await listProducts()).products);
    const issues = campaignMessageIssues({ ...config, emailDesign }, asset.message, options.mailboxes.find(mailbox => mailbox.id === config.mailboxId));
    if (!options.sendingEnabled) issues.push("Live email sending is disabled for this workspace.");
    if (config.subjectTest && recipients.length < 2) issues.push("A/B testing needs at least two eligible recipients.");
    if (!recipients.length) issues.push("Choose an audience with eligible recipients.");
    if (recipients.length > 5000) issues.push("Choose an audience with at most 5,000 recipients.");
    if (issues.length) throw new MarketingAssetError(issues[0]);
    if (emailDesign) {
      try { emailDesign = await embedPrivateProductImages(emailDesign, viewer.id); }
      catch { throw new MarketingAssetError("A selected product image could not be prepared. Replace the image and try again."); }
    }
    const scheduledAt = config.sendMode === "scheduled" ? config.scheduledAt : new Date(Date.now() + 90_000).toISOString();
    if (!scheduledAt || Date.parse(scheduledAt) < Date.now() + 60_000 || Date.parse(scheduledAt) > Date.now() + 365 * 86400_000) throw new MarketingAssetError("Choose a send time between one minute and one year from now.");
    const operations = assignCampaignSubjects(config, recipients, asset.id).map(({ recipient, variant, subject }) => {
      const requestId = randomUUID();
      const rendered = emailDesign ? renderEmailDesign(emailDesign, { personalize: value => personalizeCampaign(value, recipient), utmCampaign: config.utmTracking ? asset.id : undefined, preheader: embeddedCampaignPreheader(emailDesign) ? undefined : config.preheader }) : null;
      const content = rendered ? prepareComposerMessage(rendered.text, rendered.html, "", undefined, requestId) : buildFlowEmail({ body: personalizeCampaign(asset.message, recipient), config: { trackOpens: false, trackClicks: false, utmTracking: config.utmTracking, preheader: personalizeCampaign(config.preheader, recipient) }, runId: requestId, stepId: asset.id, flowId: asset.id, appUrl: env.NEXT_PUBLIC_APP_URL, secret: "" });
      if (config.plainText !== undefined && rendered) content.text = personalizeCampaign(config.plainText, recipient);
      const input = emailSendSchema.parse({ to: [recipient.email], subject: personalizeCampaign(subject, recipient), ...content, footerIncluded: Boolean(config.emailDesign), mailboxId: config.mailboxId, senderName: config.senderName, replyTo: config.useSenderReplyTo ? undefined : config.replyTo, requestId, scheduleAt: scheduledAt, campaign: { id: asset.id, contactId: recipient.id, smartSending: config.smartSending, ...(variant ? { variant } : {}) } });
      const message = { ...input }; delete message.requestId; delete message.scheduleAt;
      return { id: requestId, scheduledAt, hash: createHash("sha256").update(JSON.stringify(message)).digest("hex"), payload: input };
    });
    const dispatch = { queuedAt: new Date().toISOString(), scheduledAt, recipientCount: recipients.length, userId: viewer.id };
    const { data, error } = await createSupabaseAdmin().rpc("queue_marketing_campaign", { p_campaign_id: id, p_expected_updated_at: updatedAt, p_user_id: viewer.id, p_operations: operations, p_dispatch: dispatch });
    if (error) throw new MarketingAssetError("This campaign could not be queued. Refresh its delivery status before trying again.", 409);
    return { dispatch: data, asset: (await listMarketingAssets(viewer, year)).find(item => item.id === id)! };
  });
}
