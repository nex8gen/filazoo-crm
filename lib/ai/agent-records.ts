import "server-only";
import { createHash } from "node:crypto";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { commerceDefaults } from "../company-commerce";
import { getEmailInboxBackendData, type InboxEmailItem } from "../email-inbox";
import { getEffectiveMailbox, getViewerMailbox, getViewerMailboxes } from "../data/mailboxes";
import { loadMailboxMessageContent, mailboxSyncKey } from "../data/mailbox-sync";
import { groupEmailConversations, replyTarget, replyReferences, threadKeyForEmail } from "../email-threading";
import type { agentEmailSchema, AgentEmailSearch } from "./workspace-assistant";
import type { z } from "zod";

/** Read only the signed-in user's accessible inbox; never trust client email bodies or headers. */
export async function loadAgentEmails(viewer: WorkspaceViewer, emailId?: string, companyId?: string, mailboxId?: string) {
  let inbox = await getEmailInboxBackendData({ syncMailbox: false, history: true, ...(mailboxId ? { mailboxId } : {}) });
  // Approval and execution also reload source IDs after the user leaves the page.
  if (emailId && !mailboxId && !inbox.emails.some((email) => email.id === emailId && !email.demo)) {
    for (const mailbox of await getViewerMailboxes(viewer.id)) {
      if (mailbox.id === inbox.selectedMailboxId) continue;
      const candidate = await getEmailInboxBackendData({ syncMailbox: false, history: true, mailboxId: mailbox.id });
      if (candidate.emails.some((email) => email.id === emailId && !email.demo)) { inbox = candidate; break; }
    }
  }
  const { emails } = inbox;
  const selected = emailId ? emails.find((email) => email.id === emailId && !email.demo) : null;
  if (emailId && !selected) throw new Error("The selected email is unavailable or you no longer have access to it.");
  const groups = groupEmailConversations(emails);
  const conversation = selected ? [...groups.entries()].find(([, messages]) => messages.some((email) => email.id === selected.id)) : null;
  const companyContacts = companyId ? await createSupabaseAdmin().from("contacts").select("email").eq("company_id", companyId) : null;
  if (companyContacts?.error) throw new Error("Unable to load this customer's email addresses.");
  const addresses = new Set((companyContacts?.data ?? []).map((contact) => contact.email?.trim().toLowerCase()));
  const history = selected
    ? conversation?.[1] ?? [selected]
    : emails.filter((email) => (email.companyId === companyId || addresses.has(email.contact.toLowerCase())) && !email.demo);
  const mailbox = inbox.selectedMailboxId ? await getViewerMailbox(viewer.id, inbox.selectedMailboxId) : await getEffectiveMailbox(viewer.id);
  const recent = [...history].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-12);
  if (selected && !recent.some((email) => email.id === selected.id)) recent.unshift(selected);
  const messages = await Promise.all(recent.map(async (email) => {
    if (email.bodyLoaded !== false) return email;
    try {
      if (!mailbox || !email.uid || !email.uidValidity || email.mailboxKey !== mailboxSyncKey(mailbox)) throw new Error("Load this conversation before asking the agent to use it.");
      const full = await loadMailboxMessageContent(mailbox, email.uid, email.uidValidity);
      return { ...email, body: full.body, bodyLoaded: true };
    } catch (error) {
      if (email.id === selected?.id) throw error;
      return { ...email, body: "", bodyLoaded: false };
    }
  }));
  const loaded = selected ? messages.find((email) => email.id === selected.id) ?? selected : null;
  const current = loaded ? { ...loaded, threadId: conversation?.[0] || threadKeyForEmail(loaded) } : null;
  // Secondary contacts may not have been matched by the inbox's primary-contact map.
  const address = current?.contact.trim().toLowerCase();
  const matches = address ? await createSupabaseAdmin().from("contacts").select("company_id").eq("email", address) : null;
  if (matches?.error) throw new Error("Unable to match the email to its customer profile.");
  const companyIds = [...new Set((matches?.data ?? []).map((row) => row.company_id as string))];
  return { current, messages, mailboxId: inbox.selectedMailboxId ?? null, companyId: companyIds.length === 1 ? companyIds[0] : null };
}

export function presentAgentEmail(email: InboxEmailItem) {
  return { id: email.id, direction: email.direction, contact: email.contact, replyTo: email.replyTo, subject: email.subject, text: email.bodyLoaded === false ? "" : email.body.slice(0, 12000), contentAvailable: email.bodyLoaded !== false, truncated: email.body.length > 12000, timestamp: email.timestamp, companyId: email.companyId, threadId: threadKeyForEmail(email) };
}

/** Uses the same access-filtered inbox as the email UI; never searches raw mailbox tables. */
export async function searchAgentEmails(viewer: WorkspaceViewer, search: AgentEmailSearch) {
  const inbox = await getEmailInboxBackendData({ syncMailbox: false, history: true });
  const db = createSupabaseAdmin();
  const contacts = search.companyId ? await db.from("contacts").select("email").eq("company_id", search.companyId) : null;
  if (contacts?.error) throw new Error("Unable to load this customer's email addresses.");
  const addresses = new Set((contacts?.data ?? []).map((row) => row.email?.trim().toLowerCase()).filter(Boolean));
  const query = search.query.toLowerCase();
  const candidates = inbox.emails.filter((email) => !email.demo && email.direction === "inbound"
    && (!search.companyId || addresses.has(email.contact.trim().toLowerCase()))
    && (!search.emailId || email.id === search.emailId)
    && (!query || `${email.contact}\n${email.company}\n${email.subject}\n${email.body}`.toLowerCase().includes(query)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (search.emailId && !candidates.length) throw new Error("The requested customer email is unavailable or does not match this search.");
  const selected = candidates.slice(search.offset, search.offset + 8);
  const senders = [...new Set(selected.map((email) => email.contact.trim().toLowerCase()))];
  const matches = senders.length ? await db.from("contacts").select("company_id,email").in("email", senders) : null;
  if (matches?.error) throw new Error("Unable to match emails to customer profiles.");
  const mailbox = await getEffectiveMailbox(viewer.id);
  const messages = await Promise.all(selected.map(async (email) => {
    const companyIds = [...new Set((matches?.data ?? []).filter((row) => row.email?.trim().toLowerCase() === email.contact.trim().toLowerCase()).map((row) => row.company_id as string))];
    const companyId = companyIds.length === 1 ? companyIds[0] : null;
    try {
      let body = email.body;
      if (email.bodyLoaded === false) {
        if (!mailbox || !email.uid || !email.uidValidity || email.mailboxKey !== mailboxSyncKey(mailbox)) throw new Error("Message content unavailable.");
        body = (await loadMailboxMessageContent(mailbox, email.uid, email.uidValidity)).body;
      }
      return { ...presentAgentEmail({ ...email, body, bodyLoaded: true, companyId }), contentAvailable: true };
    } catch {
      // A failed body load must never be presented as a complete message or used for extraction.
      return { ...presentAgentEmail({ ...email, body: "", companyId }), contentAvailable: false };
    }
  }));
  const companyIds = [...new Set(messages.flatMap((message) => message.companyId ? [message.companyId] : []))];
  return {
    messages,
    companies: await Promise.all(companyIds.map(loadAgentCompany)),
    coverage: {
      scope: "accessible synced inbound emails; no live mailbox sync",
      matching: candidates.length, included: messages.length, offset: search.offset,
      nextOffset: candidates.length > search.offset + 8 ? search.offset + 8 : null,
      unloadedBodiesNotSearched: inbox.emails.filter((email) => !email.demo && email.direction === "inbound" && email.bodyLoaded === false).length,
      mailboxError: inbox.inboxError,
    },
  };
}

export async function prepareAgentEmail(email: z.infer<typeof agentEmailSchema>, viewer: WorkspaceViewer) {
  if (!email.sourceEmailId) return email;
  const context = await loadAgentEmails(viewer, email.sourceEmailId, undefined, email.mailboxId);
  const target = replyTarget(context.messages);
  if (!target || target.recipient.toLowerCase() !== email.to.toLowerCase()) throw new Error("A reply must use the selected conversation's recipient. Prepare a new email for a different recipient.");
  return { ...email, ...(context.mailboxId ? { mailboxId: context.mailboxId } : {}), threadId: context.current!.threadId || undefined, inReplyTo: target.parent.messageId?.match(/<[^<>\s]+>/)?.[0], references: replyReferences(target.parent) };
}

/** A complete editable snapshot, using raw values rather than display labels or defaults. */
export async function loadAgentCompany(companyId: string) {
  const db = createSupabaseAdmin();
  const [company, pipeline, profile, billing, contacts] = await Promise.all([
    db.from("companies").select("id,name,website,country,city,segment").eq("id", companyId).maybeSingle(),
    db.from("pipeline").select("stage,currency,estimated_order_quantity,estimated_value,next_followup_at").eq("company_id", companyId).maybeSingle(),
    db.from("company_profiles").select("summary,fit_score,interest_tags").eq("company_id", companyId).maybeSingle(),
    db.from("customer_billing_profiles").select("profile").eq("company_id", companyId).maybeSingle(),
    db.from("contacts").select("id,name,role,email").eq("company_id", companyId).order("created_at").order("id"),
  ]);
  if ([company, pipeline, profile, billing, contacts].some((result) => result.error)) throw new Error("Unable to load the current customer profile.");
  if (!company.data) throw new Error("The customer profile no longer exists.");
  const contact = contacts.data?.[0];
  const fields: Record<string, string> = {
    name: company.data.name, website: company.data.website || "", country: company.data.country || "", city: company.data.city || "", segment: company.data.segment || "",
    contactName: contact?.name || "", contactRole: contact?.role || "", contactEmail: contact?.email || "",
    stage: pipeline.data?.stage || "new", currency: pipeline.data?.currency || "USD",
    estimatedOrderQuantity: String(pipeline.data?.estimated_order_quantity ?? ""), estimatedValue: String(pipeline.data?.estimated_value ?? ""), nextFollowupAt: pipeline.data?.next_followup_at || "",
    summary: profile.data?.summary || "", fitScore: String(profile.data?.fit_score ?? ""), tags: (profile.data?.interest_tags ?? []).join(", "),
    ...Object.fromEntries(Object.entries(commerceDefaults(billing.data?.profile)).map(([key, value]) => [`commerce.${key}`, String(value)])),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({ fields, contacts: contacts.data })).digest("hex");
  return { id: companyId, fields, contacts: contacts.data ?? [], fingerprint };
}
