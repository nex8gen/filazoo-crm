import "server-only";
import { requireAiData } from "../data/ai-settings";
import { createHash } from "node:crypto";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { commerceDefaults } from "../company-commerce";
import { getEmailInboxBackendData, type EmailInboxBackendData, type InboxEmailItem } from "../email-inbox";
import { getEffectiveMailbox, getViewerMailbox, getViewerMailboxes } from "../data/mailboxes";
import { loadMailboxMessageContent, mailboxSyncKey } from "../data/mailbox-sync";
import { groupEmailConversations, replyTarget, replyReferences, threadKeyForEmail } from "../email-threading";
import type { agentEmailSchema, AgentEmailSearch } from "./workspace-assistant";
import type { z } from "zod";
import type { CustomerEmailHistoryContext } from "./customer-email-history";
import { assertAiCustomerAccess, assignedAiCustomerIds } from "./customer-access.ts";

/** Read only the signed-in user's accessible inbox; never trust client email bodies or headers. */
export async function loadAgentEmails(viewer: WorkspaceViewer, emailId?: string, companyId?: string, mailboxId?: string, accessOnly = false, accessSnapshots?: Map<string, Promise<EmailInboxBackendData>>) {
  await requireAiData("emails", "customers");
  function readInbox(id?: string) {
    const key = id ?? "default";
    const prior = accessOnly ? accessSnapshots?.get(key) : undefined;
    if (prior) return prior;
    const read = getEmailInboxBackendData({ syncMailbox: false, history: true, ...(id ? { mailboxId: id } : {}) });
    if (accessOnly) accessSnapshots?.set(key, read);
    return read;
  }
  if (companyId) await assertAiCustomerAccess(viewer, companyId, createSupabaseAdmin());
  let inbox: EmailInboxBackendData;
  try { inbox = await readInbox(mailboxId); }
  catch { inbox = await readInbox(); }
  if (viewer.role === "admin" && emailId && !mailboxId && !inbox.emails.some(email => email.id === emailId && !email.demo)) {
    for (const mailbox of await getViewerMailboxes(viewer.id)) {
      if (mailbox.id === inbox.selectedMailboxId) continue;
      const candidate = await readInbox(mailbox.id);
      if (candidate.emails.some(email => email.id === emailId && !email.demo)) { inbox = candidate; break; }
    }
  }
  if (companyId) {
    const { loadCustomerEmailHistories } = await import("./customer-email-history");
    const history = (await loadCustomerEmailHistories(viewer, [companyId])).get(companyId);
    if (!history) throw new Error("This customer's email history is unavailable.");
    inbox = { ...inbox, emails: history.emails.map(email => ({ ...email, companyId })) };
  } else if (viewer.role !== "admin" || (emailId && !inbox.emails.some(email => email.id === emailId && !email.demo))) {
    const authorized = await loadAgentEmailIndex(viewer);
    inbox = { ...inbox, emails: authorized.inbox.emails.filter(email => !mailboxId || email.mailboxId === mailboxId) };
  }
  const { emails } = inbox;
  const selected = emailId ? emails.find((email) => email.id === emailId && !email.demo) : null;
  if (emailId && !selected) throw new Error("The selected email is unavailable or you no longer have access to it.");
  // History only verifies visibility; never fetch MIME bodies or IMAP content.
  if (accessOnly) return { current: selected, messages: [], mailboxId: selected?.mailboxId ?? inbox.selectedMailboxId ?? null, companyId: selected?.companyId ?? null };
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
      if (email.companyId) {
        const { loadCustomerEmailBody } = await import("./customer-email-history");
        return await loadCustomerEmailBody(viewer, email.companyId, email);
      }
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
  return { current, messages, mailboxId: current?.mailboxId ?? inbox.selectedMailboxId ?? null, companyId: companyIds.length === 1 ? companyIds[0] : null };
}

export function presentAgentEmail(email: InboxEmailItem) {
  return { id: email.id, direction: email.direction, status: email.status, from: email.from, to: email.to, contact: email.contact, replyTo: email.replyTo, subject: email.subject, text: email.bodyLoaded === false ? "" : email.body.slice(0, 12000), contentAvailable: email.bodyLoaded !== false, truncated: email.body.length > 12000, timestamp: email.timestamp, companyId: email.companyId, threadId: threadKeyForEmail(email) };
}

/** Uses the same access-filtered inbox as the email UI; never searches raw mailbox tables. */
export async function loadAgentEmailIndex(viewer: WorkspaceViewer, context: CustomerEmailHistoryContext = {}) {
  await requireAiData("emails", "customers");
  const { loadCustomerEmailHistories, isCustomerHistoryMessage } = await import("./customer-email-history");
  const db = createSupabaseAdmin(), ids: string[] = [];
  for (let offset = 0; ; offset += 200) {
    const query = viewer.role === "admin" ? db.from("companies").select("id")
      : db.from("companies").select("id,pipeline!inner(owner_id)").eq("pipeline.owner_id", viewer.id);
    const { data, error } = await query.order("id").range(offset, offset + 199);
    if (error) throw new Error("Unable to verify customer conversation access.");
    ids.push(...(data ?? []).map(row => row.id));
    if ((data?.length ?? 0) < 200) break;
  }
  const emails: InboxEmailItem[] = [];
  let incomplete = false;
  for (let offset = 0; offset < ids.length; offset += 200) {
    const histories = await loadCustomerEmailHistories(viewer, ids.slice(offset, offset + 200), context);
    for (const [companyId, history] of histories) {
      if (!history) { incomplete = true; continue; }
      incomplete ||= Boolean(history.inboxError || history.mailboxReadFailed || history.mailboxSnapshotPartial || history.mailboxHistoryPartial);
      emails.push(...history.emails.filter(isCustomerHistoryMessage).map(email => ({ ...email, companyId })));
    }
  }
  const inbox = { emails, inboxError: incomplete ? "Some customer conversation history unavailable or incomplete" : null };
  return { inbox, searched: [] as Awaited<ReturnType<typeof getViewerMailboxes>>, coverage: { mailboxesOmitted: 0, mailboxError: inbox.inboxError, customers: ids.length } };
}

/** The optional index is request-local; never cache a user's mailbox across requests. */
export async function searchAgentEmails(viewer: WorkspaceViewer, search: AgentEmailSearch, index?: Promise<Awaited<ReturnType<typeof loadAgentEmailIndex>>>, context: CustomerEmailHistoryContext = {}) {
  await requireAiData("emails", "customers");
  if (search.companyId) return searchCompanyEmails(viewer, search, context);
  const { inbox, searched, coverage } = await (index ?? loadAgentEmailIndex(viewer, context));
  const db = createSupabaseAdmin();
  const allowedIds = viewer.role === "admin" ? null : new Set(await assignedAiCustomerIds(viewer, db));
  const contacts = search.companyId ? await db.from("contacts").select("email").eq("company_id", search.companyId) : null;
  if (contacts?.error) throw new Error("Unable to load this customer's email addresses.");
  const addresses = new Set((contacts?.data ?? []).map((row) => row.email?.trim().toLowerCase()).filter(Boolean));
  const query = search.query.toLowerCase();
  const accessibleCandidates = inbox.emails.filter((email) => (allowedIds === null || Boolean(email.companyId && allowedIds.has(email.companyId))) && !email.demo && (search.direction === "all" || email.direction === (search.direction ?? "inbound"))
    && (!search.companyId || addresses.has(email.contact.trim().toLowerCase()))
    && (search.direction !== "all" || email.direction === "inbound" || /^sent$/i.test(email.status))
    && (!search.emailId || email.id === search.emailId));
  const candidates = accessibleCandidates.filter((email) => (!query || `${email.contact}\n${email.company}\n${email.subject}\n${email.body}`.toLowerCase().includes(query)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (search.emailId && !candidates.length) throw new Error("The requested customer email is unavailable or does not match this search.");
  const selected = candidates.slice(search.offset, search.offset + 8);
  const senders = [...new Set(selected.map((email) => email.contact.trim().toLowerCase()))];
  const matches = senders.length ? await db.from("contacts").select("company_id,email").in("email", senders) : null;
  if (matches?.error) throw new Error("Unable to match emails to customer profiles.");
  const messages = await Promise.all(selected.map(async (email) => {
    const mailbox = searched.find((candidate) => candidate.id === email.mailboxId);
    const companyIds = [...new Set((matches?.data ?? []).filter((row) => row.email?.trim().toLowerCase() === email.contact.trim().toLowerCase()).map((row) => row.company_id as string))];
    const companyId = companyIds.length === 1 ? companyIds[0] : null;
    try {
      let body = email.body;
      if (email.bodyLoaded === false) {
        if (companyId) {
          const { loadCustomerEmailBody } = await import("./customer-email-history");
          const loaded = await loadCustomerEmailBody(viewer, companyId, email, context);
          if (loaded.bodyLoaded === false) throw new Error("Message content unavailable.");
          body = loaded.body;
        } else {
          if (viewer.role !== "admin" || !mailbox || !email.uid || !email.uidValidity || email.mailboxKey !== mailboxSyncKey(mailbox)) throw new Error("Message content unavailable.");
          body = (await loadMailboxMessageContent(mailbox, email.uid, email.uidValidity)).body;
        }
      }
      return { ...presentAgentEmail({ ...email, body, bodyLoaded: true, companyId }), mailboxId: email.mailboxId, href: `/email?${email.mailboxId ? `mailbox=${encodeURIComponent(email.mailboxId)}&` : ""}thread=${encodeURIComponent(threadKeyForEmail(email))}`, contentAvailable: true };
    } catch {
      // A failed body load must never be presented as a complete message or used for extraction.
      return { ...presentAgentEmail({ ...email, body: "", companyId }), contentAvailable: false };
    }
  }));
  const companyIds = [...new Set(messages.flatMap((message) => message.companyId ? [message.companyId] : []))];
  return {
    messages,
    companies: await Promise.all(companyIds.map(id => loadAgentCompany(id, false, viewer))),
    coverage: {
      scope: `Customer-linked synced ${search.direction ?? "inbound"} conversations across staff mailboxes, restricted to assigned customers for non-administrators; no live mailbox sync; query matches only loaded bodies and headers`,
      ...coverage,
      conversations: new Set(candidates.map(email => `${email.mailboxId}:${threadKeyForEmail(email)}`)).size,
      inbound: candidates.filter(email => email.direction === "inbound").length,
      outbound: candidates.filter(email => email.direction === "outbound").length,
      matching: candidates.length, included: messages.length, offset: search.offset,
      nextOffset: candidates.length > search.offset + 8 ? search.offset + 8 : null,
      unloadedBodiesNotSearched: accessibleCandidates.filter((email) => email.bodyLoaded === false).length,
      mailboxError: inbox.inboxError,
    },
  };
}

/** Known customers use the profile Email tab, including their assigned manager's replies. */
async function searchCompanyEmails(viewer: WorkspaceViewer, search: AgentEmailSearch, context: CustomerEmailHistoryContext) {
  const { customerEmailHref, isCustomerHistoryMessage, loadCustomerEmailBody, loadCustomerEmailHistories } = await import("./customer-email-history");
  const companyId = search.companyId!;
  const history = (await loadCustomerEmailHistories(viewer, [companyId], context)).get(companyId);
  if (!history) throw new Error("This customer's email history is unavailable or you no longer have access to it.");
  const direction = search.direction ?? "inbound";
  const accessible = history.emails.filter(email => isCustomerHistoryMessage(email) && (direction === "all" || email.direction === direction));
  const query = search.query.trim().toLowerCase();
  const candidates = accessible.filter(email => (!search.emailId || email.id === search.emailId)
    && (!query || `${email.contact}\n${email.company}\n${email.subject}\n${email.bodyLoaded === false ? "" : email.body}`.toLowerCase().includes(query)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  if (search.emailId && !candidates.length) throw new Error("The requested customer email is unavailable or does not match this search.");
  const selected = candidates.slice(search.offset, search.offset + 8);
  const senders = [...new Set(selected.map(email => email.contact.trim().toLowerCase()))];
  const matches = senders.length ? await createSupabaseAdmin().from("contacts").select("company_id,email")
    .or(senders.map(email => `email.ilike.${JSON.stringify(email.replace(/[\\%_]/g, "\\$&"))}`).join(",")).limit(501) : null;
  if (matches?.error) throw new Error("Unable to match emails to customer profiles.");
  const messages = await Promise.all(selected.map(async email => {
    const loaded = await loadCustomerEmailBody(viewer, companyId, email, context);
    const owners = new Set((matches?.data ?? []).filter(row => row.email?.trim().toLowerCase() === email.contact.trim().toLowerCase()).map(row => row.company_id));
    const matchedCompany = (matches?.data?.length ?? 0) < 501 && owners.size === 1 && owners.has(companyId) ? companyId : null;
    return { ...presentAgentEmail({ ...loaded, companyId: matchedCompany }), mailboxId: email.mailboxId, href: customerEmailHref(companyId) };
  }));
  const mailboxError = history.inboxError || history.mailboxReadFailed || history.mailboxSnapshotPartial || history.mailboxHistoryPartial
    ? "Some customer email history unavailable or incomplete" : null;
  return { messages, companies: [await loadAgentCompany(companyId, false, viewer)], coverage: {
    scope: "Customer-linked synced email from the company profile Email tab across staff accounts; no live mailbox sync; query matches only loaded bodies and headers",
    countsComplete: !mailboxError, mailboxError,
    conversations: new Set(candidates.map(threadKeyForEmail)).size,
    inbound: candidates.filter(email => email.direction === "inbound").length,
    outbound: candidates.filter(email => email.direction === "outbound").length,
    matching: candidates.length, included: messages.length, offset: search.offset,
    nextOffset: candidates.length > search.offset + 8 ? search.offset + 8 : null,
    unloadedBodiesNotSearched: accessible.filter(email => email.bodyLoaded === false).length,
  } };
}

export async function prepareAgentEmail(email: z.infer<typeof agentEmailSchema>, viewer: WorkspaceViewer) {
  if (!email.sourceEmailId) return email;
  const context = await loadAgentEmails(viewer, email.sourceEmailId, undefined, email.mailboxId);
  const target = replyTarget(context.messages);
  if (!target || target.recipient.toLowerCase() !== email.to.toLowerCase()) throw new Error("A reply must use the selected conversation's recipient. Prepare a new email for a different recipient.");
  return { ...email, ...(context.mailboxId ? { mailboxId: context.mailboxId } : {}), threadId: context.current!.threadId || undefined, inReplyTo: target.parent.messageId?.match(/<[^<>\s]+>/)?.[0], references: replyReferences(target.parent) };
}

/** A complete editable snapshot, using raw values rather than display labels or defaults. */
export async function loadAgentCompany(companyId: string, includeBilling = true, viewer?: WorkspaceViewer) {
  if (!viewer) throw new Error("Authenticated AI customer access is required.");
  await requireAiData("customers", ...(includeBilling ? ["billing"] as const : []));
  const db = createSupabaseAdmin();
  await assertAiCustomerAccess(viewer, companyId, db);
  const [company, pipeline, profile, billing, contacts] = await Promise.all([
    db.from("companies").select("id,name,website,country,city,segment").eq("id", companyId).maybeSingle(),
    db.from("pipeline").select("next_followup_at").eq("company_id", companyId).maybeSingle(),
    db.from("company_profiles").select("summary,fit_score,interest_tags").eq("company_id", companyId).maybeSingle(),
    includeBilling ? db.from("customer_billing_profiles").select("profile").eq("company_id", companyId).maybeSingle() : { data: null, error: null },
    db.from("contacts").select("id,name,role,email").eq("company_id", companyId).order("created_at").order("id"),
  ]);
  if ([company, pipeline, profile, billing, contacts].some((result) => result.error)) throw new Error("Unable to load the current customer profile.");
  if (!company.data) throw new Error("The customer profile no longer exists.");
  const contact = contacts.data?.[0];
  const fields: Record<string, string> = {
    name: company.data.name, website: company.data.website || "", country: company.data.country || "", city: company.data.city || "", segment: company.data.segment || "",
    contactName: contact?.name || "", contactRole: contact?.role || "", contactEmail: contact?.email || "",
    nextFollowupAt: pipeline.data?.next_followup_at || "",
    summary: profile.data?.summary || "", fitScore: String(profile.data?.fit_score ?? ""), tags: (profile.data?.interest_tags ?? []).join(", "),
    ...(includeBilling ? Object.fromEntries(Object.entries(commerceDefaults(billing.data?.profile)).map(([key, value]) => [`commerce.${key}`, String(value)])) : {}),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify({ fields, contacts: contacts.data })).digest("hex");
  return { id: companyId, fields, contacts: contacts.data ?? [], fingerprint };
}
