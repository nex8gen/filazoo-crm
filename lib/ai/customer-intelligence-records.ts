import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { requireAiData } from "../data/ai-settings";
import { createSupabaseAdmin } from "../supabase/admin";
import { threadKeyForEmail } from "../email-threading";
import { emailParticipantAddresses } from "../company-email";
import type { CrmRead } from "./crm-tools";
import { customerEmailHref, isCustomerHistoryMessage, loadCustomerEmailBody, loadCustomerEmailHistories, type CustomerEmailHistoryContext } from "./customer-email-history";
import { clipEvidence, customerSalesTotals, selectConversationEvidence, type IntelligenceInvoice } from "./customer-intelligence.ts";

type Row = Record<string, unknown>;
type Scan = { rows: Row[]; complete: boolean; available: boolean };
export type CustomerInsightContext = CustomerEmailHistoryContext;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const relation = (value: unknown) => object(Array.isArray(value) ? value[0] : value);
const string = (value: unknown) => typeof value === "string" ? value : "";
const absent = (): Scan => ({ rows: [], complete: false, available: false });

/** Scan stable pages, with explicit lower-bound counts if a source fails or exceeds the bound. */
async function scan(read: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<Scan> {
  const rows: Row[] = [];
  try {
    for (let from = 0; from < 10_000; from += 500) {
      const result = await read(from, from + 499);
      if (result.error) return { rows, complete: false, available: false };
      rows.push(...(result.data ?? []).map(object));
      if ((result.data?.length ?? 0) < 500) return { rows, complete: true, available: true };
    }
    return { rows, complete: false, available: true };
  } catch { return { rows, complete: false, available: false }; }
}

function commercialEvidence(row: Row, kind: "orders" | "invoices" | "quotations") {
  const document = object(kind === "quotations" ? row.quote_document : row.document);
  const items = Array.isArray(document.items) ? document.items : [];
  const root = { orders: "purchase-orders", invoices: "invoices", quotations: "company-quotations" }[kind];
  return {
    id: row.id, href: `/${root}/${row.id}`, createdAt: row.created_at,
    reference: row.reference ?? row.number ?? document.reference,
    status: row.status ?? row.quote_status ?? document.status,
    currency: document.currency ?? row.currency, totalMinor: row.total_minor ?? document.totalMinor, paidMinor: row.paid_minor,
    dueDate: document.dueDate, validUntil: document.validUntil, orderId: row.quote_order_id,
    items: items.slice(0, 10).map(value => {
      const item = object(value);
      return { productSku: item.productSku ?? item.sku, variantId: item.variantId, description: clipEvidence(item.description, 160), quantity: item.quantity, unitPriceMinor: item.unitPriceMinor };
    }),
    omittedItems: Math.max(0, items.length - 10), notes: clipEvidence(document.notes, 500),
  };
}

/** Workspace-scoped, assignment-scoped read only. No mutations and no model-generated scores. */
export async function readCustomerInsights(viewer: WorkspaceViewer, input: CrmRead, context: CustomerInsightContext = {}, options: { screening?: boolean } = {}) {
  const policy = await requireAiData("customers");
  const db = createSupabaseAdmin();
  const companyId = input.companyId ?? input.id;
  const screening = options.screening === true && !companyId;
  if (companyId && !z.uuid().safeParse(companyId).success) throw new Error("Choose a valid customer ID.");
  // Explicit assignment filtering is necessary even with workspace isolation.
  const pipeline = viewer.role !== "admin" ? "pipeline!inner" : "pipeline";
  let query = db.from("companies").select(`id,name,website,country,city,segment,status,contacts(id,name,role,email),company_profiles(summary,fit_score,interest_tags),${pipeline}(owner_id,next_followup_at)`, { count: "exact" })
    .or("source.is.null,source.neq.sample_seed");
  if (viewer.role !== "admin") query = query.eq("pipeline.owner_id", viewer.id);
  if (companyId) query = query.eq("id", companyId);
  if (input.query) query = query.ilike("name", `%${input.query.replace(/[\\%_]/g, "\\$&")}%`);
  const { data, error, count } = await query.order("id").range(input.offset, input.offset + (companyId ? 0 : screening ? 199 : 19));
  if (error) throw new Error("Unable to load the customer population for analysis.");
  const companies = (data ?? []) as unknown as Row[];
  const ids = companies.map(row => string(row.id));
  if (!ids.length) return { records: [], coverage: { matching: count, included: 0, offset: input.offset, nextOffset: null, scope: "Accessible saved customers" } };
  const source = (table: string, fields: string, own = false) => scan((from, to) => {
    let read = db.from(table).select(fields).in("company_id", ids);
    if (table === "events" && (screening || !Object.values(policy.data).every(Boolean))) read = read.eq("type", "staff_comment");
    if (own) read = read.eq(table === "crm_tasks" ? "assigned_to" : "user_id", viewer.id);
    return read.order("created_at", { ascending: false }).order("id").range(from, to);
  });
  const billingAvailable = policy.data.billing && ["admin", "operator"].includes(viewer.role);
  const ownerIds = [...new Set(companies.map(company => string(relation(company.pipeline).owner_id)).filter(Boolean))];
  const [events, orders, invoices, quotations, tasks, emailHistories, owners] = await Promise.all([
    source("events", "id,company_id,type,data,created_at"),
    billingAvailable ? source("purchase_orders", screening ? "id,company_id,document,created_at" : "id,company_id,reference,document,total_minor,created_at") : absent(),
    billingAvailable && !screening ? source("invoices", "id,company_id,number,status,total_minor,paid_minor,document,created_at") : absent(),
    billingAvailable && policy.data.products && !screening ? source("catalogs", "id,company_id,currency,quote_status,quote_order_id,quote_document,created_at", true) : absent(),
    policy.data.tasks && !screening ? source("crm_tasks", "id,company_id,title,notes,priority,status,due_at,created_at", true) : absent(),
    policy.data.emails ? loadCustomerEmailHistories(viewer, ids, context).catch(() => null) : null,
    ownerIds.length ? db.from("workspace_members").select("user_id,display_name").in("user_id", ownerIds) : { data: [], error: null },
  ]);
  // Resolve secondary addresses against the entire accessible contact set, not just
  // this page. Shared addresses must never silently attribute one buyer's emails to another.
  const addresses = [...new Set(companies.flatMap(company => (Array.isArray(company.contacts) ? company.contacts : []).map(contact => string(object(contact).email).trim().toLowerCase())).filter(Boolean))];
  const addressOwners = new Map<string, Set<string>>();
  let contactsComplete = true;
  if (emailHistories) for (let from = 0; from < addresses.length; from += 100) {
    // Case-insensitive exact matches also handle legacy mixed-case imports.
    const batch = addresses.slice(from, from + 100);
    const contacts = await scan((start, end) => db.from("contacts").select("id,company_id,email")
      .or(batch.map(email => `email.ilike.${JSON.stringify(email.replace(/[\\%_]/g, "\\$&"))}`).join(","))
      .order("id").range(start, end));
    contactsComplete &&= contacts.complete;
    for (const contact of contacts.rows) {
      const address = string(contact.email).trim().toLowerCase();
      const owners = addressOwners.get(address) ?? new Set<string>();
      owners.add(string(contact.company_id)); addressOwners.set(address, owners);
    }
  }
  const records = [];
  let remaining = screening ? 4_000_000 : 110_000;
  for (const company of companies) {
    const id = string(company.id), href = `/companies/${id}`;
    const profile = relation(company.company_profiles), account = relation(company.pipeline);
    const contacts = (Array.isArray(company.contacts) ? company.contacts : []).map(object);
    const history = emailHistories?.get(id);
    const emails = (history?.emails ?? []).filter(email => isCustomerHistoryMessage(email) && contactsComplete
      && emailParticipantAddresses(email).some(address => addressOwners.get(address)?.size === 1 && addressOwners.get(address)?.has(id)));
    // Deduplicate copies across folders/mailboxes by RFC message ID when present.
    const unique = [...new Map(emails.map(email => [email.messageId?.trim().toLowerCase() || `${email.mailboxId}:${email.id}`, email])).values()]
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const evidenceLimit = companyId ? 20 : 4;
    const ambiguousAddresses = contacts.filter(contact => (addressOwners.get(string(contact.email).trim().toLowerCase())?.size ?? 0) > 1).length;
    const emailCountsComplete = Boolean(history && contactsComplete && !ambiguousAddresses && !history.inboxError && !history.mailboxReadFailed && !history.mailboxSnapshotPartial && !history.mailboxHistoryPartial);
    const excerpts = await Promise.all(selectConversationEvidence(unique, evidenceLimit).map(email => companyId ? loadCustomerEmailBody(viewer, id, email, context) : email));
    const lastInboundAt = unique.find(email => email.direction === "inbound")?.timestamp;
    const lastOutboundAt = unique.find(email => email.direction === "outbound")?.timestamp;
    const ownerId = string(account.owner_id) || null;
    const ownerName = ownerId ? owners.data?.find(owner => owner.user_id === ownerId)?.display_name ?? null : null;
    const sourceRows = (read: Scan) => read.rows.filter(row => row.company_id === id);
    const summarize = (read: Scan, kind: "orders" | "invoices" | "quotations") => {
      const rows = sourceRows(read);
      return { count: rows.length, complete: read.complete, available: read.available, omittedEvidence: Math.max(0, rows.length - (screening ? 0 : evidenceLimit)), records: screening ? [] : rows.slice(0, evidenceLimit).map(row => commercialEvidence(row, kind)) };
    };
    // Generic events can contain billing/email/workflow facts: under restricted
    // policies expose only customer notes, consistent with the customer summary.
    const allDomains = Object.values(policy.data).every(Boolean) && billingAvailable;
    const notes = sourceRows(events).filter(row => allDomains || string(row.type) === "staff_comment");
    const noteExcerpts = [...notes.filter(row => row.type === "staff_comment"), ...notes.filter(row => row.type !== "staff_comment")].slice(0, evidenceLimit);
    const customerTasks = sourceRows(tasks);
    const record = {
      id, href, name: company.name, website: company.website, country: company.country, city: company.city, segment: company.segment, status: company.status,
      assignedTo: { userId: ownerId, name: ownerName, assigned: Boolean(ownerId), available: !owners.error, isCurrentUser: ownerId === viewer.id },
      profile: { summary: clipEvidence(profile.summary, companyId ? 6000 : 1200), fitScore: profile.fit_score, interests: profile.interest_tags, nextFollowupAt: account.next_followup_at },
      contacts: contacts.slice(0, 20), omittedContacts: Math.max(0, contacts.length - 20),
      notes: { count: notes.length, available: events.available, complete: events.complete && allDomains, omittedEvidence: Math.max(0, notes.length - evidenceLimit), records: noteExcerpts.map(row => ({ id: row.id, href, type: row.type, createdAt: row.created_at, summary: clipEvidence(object(row.data).summary ?? object(row.data).note, companyId ? 3000 : 500) })) },
      email: {
        messages: unique.length, inbound: unique.filter(email => email.direction === "inbound").length, outbound: unique.filter(email => email.direction === "outbound").length,
        conversations: new Set(unique.map(threadKeyForEmail)).size,
        earliestAt: unique.at(-1)?.timestamp, latestAt: unique[0]?.timestamp,
        available: Boolean(history), countsComplete: emailCountsComplete, ambiguousAddresses,
        lastInboundAt, lastOutboundAt,
        replyState: !emailCountsComplete ? "unknown" : !unique.length ? "no_messages" : unique[0].direction === "outbound" ? "awaiting_customer" : "awaiting_team",
        complete: emailCountsComplete && unique.length <= evidenceLimit && excerpts.every(email => email.bodyLoaded !== false && email.body.length <= (companyId ? 3000 : 700)),
        unloadedBodies: unique.filter(email => email.bodyLoaded === false && !excerpts.some(excerpt => excerpt.id === email.id && excerpt.bodyLoaded !== false)).length, omittedEvidence: Math.max(0, unique.length - evidenceLimit),
        records: excerpts.map(email => ({ id: email.id, href: customerEmailHref(id), direction: email.direction, from: email.from, to: email.to, subject: email.subject, timestamp: email.timestamp, threadId: threadKeyForEmail(email), contentAvailable: email.bodyLoaded !== false, body: clipEvidence(email.bodyLoaded === false ? "" : email.body, companyId ? 3000 : 700) })),
      },
      orders: summarize(orders, "orders"), invoices: summarize(invoices, "invoices"), quotations: summarize(quotations, "quotations"),
      purchasePipeline: { available: orders.available, complete: orders.complete,
        activeOrders: sourceRows(orders).filter(row => ["draft", "confirmed", "pending", "in_production"].includes(string(object(row.document).status).toLowerCase())).length },
      sales: { available: invoices.available, complete: invoices.complete, basis: "Saved invoices only; drafts separate; void invoices excluded; currencies separate; orders are not added to invoices", totals: customerSalesTotals(sourceRows(invoices) as unknown as IntelligenceInvoice[]) },
      tasks: { count: customerTasks.length, available: tasks.available, complete: tasks.complete, omittedEvidence: Math.max(0, customerTasks.length - evidenceLimit), records: customerTasks.slice(0, evidenceLimit).map(row => ({ id: row.id, href: "/tasks", title: row.title, notes: clipEvidence(row.notes, 500), status: row.status, priority: row.priority, dueAt: row.due_at })) },
    };
    // Large accounts keep exact totals/counts while clearly marking omitted
    // excerpts. Never return an unbounded provider prompt for one customer.
    const evidence = [record.notes, record.email, record.orders, record.invoices, record.quotations, record.tasks];
    while (JSON.stringify(record).length > 100_000) {
      const largest = [...evidence].filter(source => source.records.length).sort((a, b) => JSON.stringify(b.records).length - JSON.stringify(a.records).length)[0];
      if (!largest) break;
      largest.records.pop(); largest.omittedEvidence++;
      if (largest === record.email) record.email.complete = false;
    }
    const size = JSON.stringify(record).length;
    if (records.length && size > remaining) break;
    records.push(record); remaining -= size;
  }
  const next = input.offset + records.length;
  return { records, coverage: {
    matching: count, included: records.length, offset: input.offset, nextOffset: count !== null && next < count ? next : null,
    scope: "Accessible saved customers, assigned account managers, linked CRM activity, your quotations/tasks and the same customer-linked email history as each company profile Email tab, across staff accounts; no live mailbox sync. Counts are lower bounds when a source is incomplete. Unlinked Messenger/social conversations are not included. Evidence excerpts are bounded; inspect original records and paginate email for details.",
    billingAvailable, mailboxError: !emailHistories ? "Email history disabled or unavailable" : ids.some(id => { const history = emailHistories.get(id); return !history || history.inboxError || history.mailboxReadFailed || history.mailboxSnapshotPartial || history.mailboxHistoryPartial; }) ? "Some customer email history unavailable or incomplete" : null,
    ambiguousContactAddresses: addresses.filter(address => (addressOwners.get(address)?.size ?? 0) > 1).length,
    contactMatchingComplete: contactsComplete,
  } };
}
