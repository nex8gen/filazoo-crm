import { requireWorkspaceMember } from "../auth.ts";
import type { WorkspaceViewer } from "../auth.ts";
import { formatRelativeDate, getInitials, getPipelineStageLabel } from "../crm-model.ts";
import { env, hasSupabaseConfig } from "../env.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { ActivityItem, Catalog, Company, CompanyActivity, CompanyDetails, ContactOption, DataMode, EmailDraft, Product, Reply } from "../types.ts";
import { crmProduct } from "../product-utils.ts";
import { metaOrderLabel } from "../order-estimate.ts";
import { billingActivity, sentMailActivity, mergeCompanyActivity, type ActivityInvoice, type ActivityInvoiceEvent, type ActivityPayment, type ActivitySentMail } from "../company-activity.ts";
import { readActivityHistory } from "./activity-history.ts";
import { literalInvoiceEmail } from "../invoice-related.ts";
import { resolveMemberAvatars } from "./member-avatars.ts";

type Relation<T> = T | T[] | null;

type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  domain: string | null;
  country: string | null;
  city: string | null;
  segment: string | null;
  source: string | null;
  status: string;
  meta_leads: Relation<{ created_at: string; field_data: unknown }>;
  company_profiles: Relation<{
    summary: string | null;
    fit_score: number | null;
    interest_tags: string[] | null;
  }>;
  contacts: Relation<{
    id: string;
    name: string | null;
    role: string | null;
    email: string;
    verification_status: string;
    emails: Relation<{
      status: string;
      direction: string;
      created_at: string;
    }>;
  }>;
  pipeline: Relation<{
    stage: string;
    next_followup_at: string | null;
    estimated_order_quantity: number | null;
    estimated_value: number | null;
    currency: string;
    owner_id: string | null;
  }>;
};

type EmailRow = {
  id: string;
  subject: string | null;
  body: string | null;
  step: number;
  scheduled_for: string | null;
  status: string;
  contacts: Relation<{
    name: string | null;
    email: string;
    companies: Relation<{ name: string }>;
  }>;
};

type EventRow = {
  type: string;
  data: Record<string, unknown> | null;
  created_at: string;
  companies: Relation<{ name: string }>;
};

type ContactOptionRow = {
  id: string;
  company_id: string;
  name: string | null;
  email: string;
  verification_status: string;
  companies: Relation<{ name: string }>;
};

type CatalogRow = {
  id: string;
  product_skus: string[] | null;
  currency: string;
  price_date: string;
  version: number;
  pdf_url: string | null;
  created_at: string;
  companies: Relation<{ name: string }>;
};

type ReplyRow = {
  id: string;
  message_id: string | null;
  thread_id: string | null;
  subject: string | null;
  body: string | null;
  sent_at: string | null;
  created_at: string;
  contacts: Relation<{
    name: string | null;
    email: string;
    companies: Relation<{ name: string }>;
  }>;
};

function first<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function websiteDomain(website: string | null) {
  if (!website) return "No domain";
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\//, "").split("/")[0] || "No domain";
  }
}

function sourceLabel(source: string | null) {
  if (source?.includes("shopify")) return "Shopify B2B";
  if (source?.includes("meta") || source?.includes("facebook") || source?.includes("messenger")) return "Meta";
  if (source === "manual") return "Manual";
  return source ? source.replaceAll("_", " ") : "Imported";
}

function getOutreachStatus(contacts: CompanyRow["contacts"], source: string | null) {
  const contactList = Array.isArray(contacts) ? contacts : contacts ? [contacts] : [];
  const emails = contactList.flatMap((contact) => Array.isArray(contact.emails) ? contact.emails : contact.emails ? [contact.emails] : []);
  const latest = emails.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latest) {
    if (latest.direction === "received") return "Email replied";
    return `Email · ${latest.status.replaceAll("_", " ")}`;
  }
  if (source?.includes("meta_lead_ads")) return "Meta form lead";
  if (source?.includes("meta") || source?.includes("facebook") || source?.includes("messenger")) return "Messenger lead";
  return "Not started";
}

export function getCrmDataMode(): DataMode {
  const serverIsConfigured = hasSupabaseConfig();
  const productionIsProtected = process.env.NODE_ENV !== "production" || env.authRequired;
  return serverIsConfigured && productionIsProtected ? "live" : "demo";
}

async function authorizeLiveRead() {
  if (getCrmDataMode() === "live" && env.authRequired) {
    return await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  }
}

function mapCompany(row: CompanyRow, ownerNames = new Map<string, string>(), ownerAvatars = new Map<string, string>()): Company {
  const profile = first(row.company_profiles);
  const contact = first(row.contacts);
  const pipeline = first(row.pipeline);
  const domain = row.domain || websiteDomain(row.website);
  const ownerId = pipeline?.owner_id ?? null;
  const ownerName = ownerId ? ownerNames.get(ownerId) || "BD Sales Manager" : "Unassigned";
  return {
    id: row.id,
    name: row.name,
    initials: getInitials(row.name),
    ownerId,
    ownerName,
    ownerAvatarUrl: ownerId ? ownerAvatars.get(ownerId) : undefined,
    ownerInitials: ownerId ? getInitials(ownerName) : "—",
    website: row.website || "",
    domain,
    country: row.country || "Unknown",
    city: row.city || "",
    segment: row.segment || "Unclassified",
    source: row.source || "imported",
    sourceLabel: sourceLabel(row.source),
    fitScore: profile?.fit_score ?? 0,
    stage: getPipelineStageLabel(pipeline?.stage || row.status),
    outreachStatus: getOutreachStatus(row.contacts, row.source),
    estimatedOrderQuantity: pipeline?.estimated_order_quantity ?? null,
    estimatedOrderLabel: metaOrderLabel(Array.isArray(row.meta_leads) ? row.meta_leads : row.meta_leads ? [row.meta_leads] : [], pipeline?.estimated_order_quantity ?? null),
    estimatedValue: pipeline?.estimated_value == null ? null : Number(pipeline.estimated_value),
    currency: pipeline?.currency || "USD",
    nextFollowupAt: pipeline?.next_followup_at || null,
    nextAction: pipeline?.next_followup_at ? `Follow up ${formatRelativeDate(pipeline.next_followup_at).toLowerCase()}` : "Review company",
    tags: profile?.interest_tags ?? [],
    contact: contact?.name || "No contact yet",
    contactRole: contact?.role || "Role not confirmed",
    email: contact?.email || "",
    summary: profile?.summary || "This company has not been profiled yet.",
  };
}

export async function listCompanies(): Promise<{ mode: DataMode; companies: Company[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, companies: [] };
  await authorizeLiveRead();

  return { mode, companies: await queryCompanies() };
}

async function queryCompanies(id?: string): Promise<Company[]> {
  const rows: CompanyRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const query = createSupabaseAdmin()
      .from("companies")
      .select("id,name,website,domain,country,city,segment,source,status,meta_leads(created_at,field_data),company_profiles(summary,fit_score,interest_tags),contacts(id,name,role,email,verification_status,emails(status,direction,created_at)),pipeline(stage,next_followup_at,estimated_order_quantity,estimated_value,currency,owner_id)")
      .or("source.is.null,source.neq.sample_seed")
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 499);
    const { data, error } = await (id === undefined ? query : query.eq("id", id));
    if (error) throw new Error(`Unable to load companies: ${error.message}`);
    rows.push(...(data ?? []) as unknown as CompanyRow[]);
    if (!data || data.length < 500) break;
  }
  const ownerIds = [...new Set(rows.map((row) => first(row.pipeline)?.owner_id).filter((value): value is string => Boolean(value)))];
  const [{ data: owners }, ownerAvatars] = await Promise.all([
    ownerIds.length ? createSupabaseAdmin().from("workspace_members").select("user_id,display_name").in("user_id", ownerIds) : Promise.resolve({ data: [] }),
    resolveMemberAvatars(createSupabaseAdmin(), ownerIds),
  ]);
  const ownerNames = new Map((owners ?? []).map((owner) => [owner.user_id, owner.display_name || "BD Sales Manager"]));
  return rows.map((row) => mapCompany(row, ownerNames, ownerAvatars));
}

type CompanyEventRow = { id: string; type: string; data: Record<string, unknown> | null; actor_id: string | null; created_at: string };
type CompanyEmailRow = { id: string; message_id: string | null; subject: string | null; body: string | null; status: string; direction: string; approved_by: string | null; sent_at: string | null; created_at: string; contacts: Relation<{ name: string | null; email: string }> };
type CompanyCatalogRow = { id: string; version: number; product_skus: string[] | null; created_at: string };

/** Profile fields only: history is loaded separately when its tab is opened. */
export async function getCompanyProfile(id: string): Promise<{ mode: DataMode; details: CompanyDetails | null }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, details: null };
  await authorizeLiveRead();
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return { mode, details: null };
  const admin = createSupabaseAdmin();
  const [companyResult, contactsResult, commerceResult] = await Promise.all([
    admin.from("companies").select("id,name,website,domain,country,city,segment,source,status,meta_leads(created_at,field_data),company_profiles(summary,fit_score,interest_tags),pipeline(stage,next_followup_at,estimated_order_quantity,estimated_value,currency,owner_id)").eq("id", id).maybeSingle(),
    admin.from("contacts").select("id,name,role,email,verification_status").eq("company_id", id).order("created_at").order("id"),
    admin.from("customer_billing_profiles").select("profile").eq("company_id", id).maybeSingle(),
  ]);
  if (companyResult.error) throw new Error(`Unable to load company: ${companyResult.error.message}`);
  if (!companyResult.data) return { mode, details: null };
  const error = contactsResult.error || commerceResult.error;
  if (error) throw new Error(`Unable to load company profile: ${error.message}`);
  const companyRow = { ...companyResult.data, contacts: contactsResult.data ?? [] } as unknown as CompanyRow;
  const ownerId = first(companyRow.pipeline)?.owner_id;
  const [{ data: owner }, avatars] = await Promise.all([
    ownerId ? admin.from("workspace_members").select("display_name").eq("user_id", ownerId).maybeSingle() : Promise.resolve({ data: null }),
    resolveMemberAvatars(admin, ownerId ? [ownerId] : []),
  ]);
  const ownerNames = new Map<string, string>();
  if (ownerId) ownerNames.set(ownerId, owner?.display_name || "BD Sales Manager");
  return {
    mode,
    details: {
      company: mapCompany(companyRow, ownerNames, avatars),
      contacts: (contactsResult.data ?? []).map(contact => ({ id: contact.id, name: contact.name || "No name", role: contact.role || "Role not confirmed", email: contact.email, verificationStatus: contact.verification_status })),
      commerce: commerceResult.data?.profile,
      activity: [],
    },
  };
}

export async function getCompanyDetails(id: string): Promise<{ mode: DataMode; details: CompanyDetails | null }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, details: null };
  await authorizeLiveRead();
  const admin = createSupabaseAdmin();
  const [companyResult, contactsResult, eventsResult, emailsResult, catalogsResult, commerceResult] = await Promise.all([
    admin.from("companies").select("id,name,website,domain,country,city,segment,source,status,meta_leads(created_at,field_data),company_profiles(summary,fit_score,interest_tags),contacts(id,name,role,email,verification_status,emails(status,direction,created_at)),pipeline(stage,next_followup_at,estimated_order_quantity,estimated_value,currency,owner_id)").eq("id", id).maybeSingle(),
    admin.from("contacts").select("id,name,role,email,verification_status").eq("company_id", id).order("created_at").order("id"),
    readActivityHistory((from, to) => admin.from("events").select("id,type,data,actor_id,created_at").eq("company_id", id).order("created_at", { ascending: false }).order("id").range(from, to)),
    readActivityHistory((from, to) => admin.from("emails").select("id,message_id,subject,body,status,direction,approved_by,sent_at,created_at,contacts!inner(name,email,company_id)").eq("contacts.company_id", id).order("created_at", { ascending: false }).order("id").range(from, to)),
    readActivityHistory((from, to) => admin.from("catalogs").select("id,version,product_skus,created_at").eq("company_id", id).order("created_at", { ascending: false }).order("id").range(from, to)),
    admin.from("customer_billing_profiles").select("profile").eq("company_id", id).maybeSingle(),
  ]);
  if (companyResult.error) throw new Error(`Unable to load company: ${companyResult.error.message}`);
  if (!companyResult.data) return { mode, details: null };
  const failures = [contactsResult.error, commerceResult.error].filter(Boolean);
  if (failures.length) throw new Error(`Unable to load company activity: ${failures[0]?.message}`);

  const events = eventsResult as CompanyEventRow[];
  const emails = emailsResult as unknown as CompanyEmailRow[];
  const addresses = [...new Set((contactsResult.data ?? []).map((contact) => contact.email))];
  const [sentMail, invoiceGroups] = await Promise.all([
    addresses.length ? readActivityHistory<ActivitySentMail>((from, to) => admin.from("mailbox_sent_messages").select("id,user_id,from_email,to_email,subject,body,status,sent_at,message_id,attachments").in("to_email", addresses).order("sent_at", { ascending: false }).order("id").range(from, to)) : Promise.resolve([]),
    // Legacy invoices
    // match exact customer emails only when not linked to another company.
    Promise.all([
      readActivityHistory<ActivityInvoice>((from, to) => admin.from("invoices").select("id,number,status,total_minor,paid_minor,created_by,created_at,document").eq("company_id", id).order("id").range(from, to)),
      ...addresses.map((email) => readActivityHistory<ActivityInvoice>((from, to) => admin.from("invoices").select("id,number,status,total_minor,paid_minor,created_by,created_at,document").is("company_id", null).ilike("document->>customerEmail", literalInvoiceEmail(email)).order("id").range(from, to))),
    ]),
  ]);
  const invoices = [...new Map(invoiceGroups.flat().map((invoice) => [invoice.id, invoice])).values()];
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const [payments, invoiceEvents] = invoiceIds.length ? await Promise.all([
    readActivityHistory<ActivityPayment>((from, to) => admin.from("invoice_payments").select("*").in("invoice_id", invoiceIds).order("id").range(from, to)),
    readActivityHistory<ActivityInvoiceEvent>((from, to) => admin.from("invoice_events").select("*").in("invoice_id", invoiceIds).order("id").range(from, to)),
  ]) : [[], []];
  const actorIds = [...new Set([...events.map((event) => event.actor_id), ...emails.map((email) => email.approved_by), ...sentMail.map((mail) => mail.user_id), ...invoices.map((invoice) => invoice.created_by), ...payments.map((payment) => payment.created_by), ...invoiceEvents.map((event) => event.actor_id)].filter((value): value is string => Boolean(value)))];
  const memberNames = new Map<string, string>();
  if (actorIds.length) {
    const { data: members } = await admin.from("workspace_members").select("user_id,display_name").in("user_id", actorIds);
    for (const member of members ?? []) memberNames.set(member.user_id, member.display_name || "Workspace member");
  }
  const companyRow = companyResult.data as unknown as CompanyRow;
  const ownerId = first(companyRow.pipeline)?.owner_id;
  const actorAvatars = await resolveMemberAvatars(admin, ownerId ? [...actorIds, ownerId] : actorIds);

  const activity: CompanyActivity[] = mergeCompanyActivity([
    // Billing audit rows and payments provide one detailed entry per action.
    ...events.filter((event) => !invoices.some((invoice) => invoice.id === event.data?.invoiceId && event.type.startsWith("invoice_")) && !(event.type === "catalog_created" && (catalogsResult as CompanyCatalogRow[]).some((catalog) => catalog.id === event.data?.catalogId))).map((event) => ({
      id: `event-${event.id}`,
      type: "event" as const,
      title: event.type.replaceAll("_", " "),
      detail: typeof event.data?.summary === "string" ? event.data.summary : "Company activity recorded.",
      actor: event.actor_id ? memberNames.get(event.actor_id) || "Workspace member" : "Automation",
      actorId: event.actor_id,
      createdAt: event.created_at,
      metadata: Object.entries(event.data ?? {}).filter(([key, value]) => key !== "summary" && value != null).map(([key, value]) => ({ label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " "), value: typeof value === "object" ? JSON.stringify(value, null, 2) : String(value) })),
    })),
    ...emails.map((email) => {
      const contact = first(email.contacts);
      return {
        id: `email-${email.id}`,
        type: "email" as const,
        title: email.direction === "received" ? "Email received" : `Email ${email.status.replaceAll("_", " ")}`,
        detail: `${email.subject || "Untitled email"}${contact ? ` · ${contact.name || contact.email}` : ""}`,
        body: email.body || undefined,
        messageId: email.message_id,
        metadata: [{ label: "Subject", value: email.subject || "Untitled email" }, { label: email.direction === "received" ? "From" : "To", value: contact?.email || "Unknown contact" }, { label: "Status", value: email.status.replaceAll("_", " ") }],
        direction: email.direction === "received" ? "received" as const : "sent" as const,
        actor: email.direction === "received" ? contact?.name || contact?.email || "Contact" : email.approved_by ? memberNames.get(email.approved_by) || "Workspace member" : "AI automation",
        actorId: email.direction === "received" ? null : email.approved_by,
        createdAt: email.sent_at || email.created_at,
      };
    }),
    ...(catalogsResult as CompanyCatalogRow[]).map((catalog) => {
      const creatorId = events.find((event) => event.type === "catalog_created" && event.data?.catalogId === catalog.id)?.actor_id;
      return {
        id: `catalog-${catalog.id}`,
        type: "catalog" as const,
        title: `Catalog v${catalog.version} created`,
        detail: `${catalog.product_skus?.length ?? 0} products included.`,
        actor: creatorId ? memberNames.get(creatorId) || "Workspace member" : "Creator not recorded",
        actorId: creatorId,
        createdAt: catalog.created_at,
      };
    }),
    ...sentMailActivity(sentMail, memberNames),
    ...billingActivity(invoices, payments, invoiceEvents, memberNames),
  ]).map((item) => ({ ...item, actorAvatarUrl: item.actorId ? actorAvatars.get(item.actorId) : undefined }));

  const { data: owner } = ownerId ? await admin.from("workspace_members").select("display_name").eq("user_id", ownerId).maybeSingle() : { data: null };
  const ownerNames = new Map<string, string>();
  if (ownerId) ownerNames.set(ownerId, owner?.display_name || "BD Sales Manager");
  return {
    mode,
    details: {
      commerce: commerceResult.data?.profile,
      company: { ...mapCompany(companyRow, ownerNames, actorAvatars), ...(contactsResult.data?.[0] ? { contact: contactsResult.data[0].name || "No contact yet", contactRole: contactsResult.data[0].role || "Role not confirmed", email: contactsResult.data[0].email } : {}) },
      contacts: (contactsResult.data ?? []).map((contact) => ({
        id: contact.id,
        name: contact.name || "No name",
        role: contact.role || "Role not confirmed",
        email: contact.email,
        verificationStatus: contact.verification_status,
      })),
      activity,
    },
  };
}

export async function getCompany(id: string) {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, company: null };
  await authorizeLiveRead();
  // Preserve missing-record behavior without sending malformed UUIDs to Postgres.
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return { mode, company: null };
  const companies = await queryCompanies(id);
  return { mode, company: companies[0] ?? null };
}

function emailStatus(status: string): EmailDraft["status"] {
  if (status === "pending_approval") return "Needs approval";
  if (status === "scheduled" || status === "approved") return "Scheduled";
  return "Draft";
}

export function isSampleEmailSubject(subject: string | null | undefined) {
  return /\[sample\]/i.test(subject ?? "");
}

export async function listEmailDrafts(authorizedViewer?: WorkspaceViewer): Promise<{ mode: DataMode; emails: EmailDraft[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, emails: [] };
  if (!authorizedViewer) await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("emails")
    .select("id,subject,body,step,scheduled_for,status,contacts(name,companies(name))")
    .in("status", ["draft", "pending_approval", "approved", "scheduled"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Unable to load email queue: ${error.message}`);

  const emails = ((data ?? []) as unknown as EmailRow[]).filter((row) => !isSampleEmailSubject(row.subject)).map((row) => {
    const contact = first(row.contacts);
    const company = first(contact?.companies ?? null);
    return {
      id: row.id,
      company: company?.name || "Unknown company",
      contact: contact?.name || "Unknown contact",
      subject: row.subject || "Untitled draft",
      preview: row.body || "No email body has been generated yet.",
      step: row.step,
      scheduledFor: formatRelativeDate(row.scheduled_for),
      status: emailStatus(row.status),
    };
  });
  return { mode, emails };
}

export async function listContactOptions(): Promise<{ mode: DataMode; contacts: ContactOption[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, contacts: [] };
  await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("contacts")
    .select("id,company_id,name,email,verification_status,companies(name)")
    .eq("unsubscribed", false)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Unable to load contacts: ${error.message}`);

  return {
    mode,
    contacts: ((data ?? []) as unknown as ContactOptionRow[]).map((row) => ({
      id: row.id,
      companyId: row.company_id,
      company: first(row.companies)?.name || "Unknown company",
      name: row.name || row.email,
      email: row.email,
      verificationStatus: row.verification_status,
    })),
  };
}

export async function listCatalogs(): Promise<{ mode: DataMode; catalogs: Catalog[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, catalogs: [] };
  await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("catalogs")
    .select("id,product_skus,currency,price_date,version,pdf_url,created_at,companies(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Unable to load catalogs: ${error.message}`);

  return {
    mode,
    catalogs: ((data ?? []) as unknown as CatalogRow[]).map((row) => ({
      id: row.id,
      company: first(row.companies)?.name || "Unknown company",
      productSkus: row.product_skus ?? [],
      currency: row.currency,
      priceDate: row.price_date,
      version: row.version,
      pdfUrl: row.pdf_url,
      createdAt: row.created_at,
    })),
  };
}

export async function listReplies(authorizedViewer?: WorkspaceViewer): Promise<{ mode: DataMode; replies: Reply[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, replies: [] };
  if (!authorizedViewer) await authorizeLiveRead();

  const { data, error } = await createSupabaseAdmin()
    .from("emails")
    .select("id,subject,body,sent_at,created_at,message_id,thread_id,contacts(name,email,companies(name))")
    .eq("direction", "received")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Unable to load replies: ${error.message}`);

  return {
    mode,
    replies: ((data ?? []) as unknown as ReplyRow[]).filter((row) => !isSampleEmailSubject(row.subject)).map((row) => {
      const contact = first(row.contacts);
      return {
        id: row.id,
        company: first(contact?.companies ?? null)?.name || "Unknown company",
        contact: contact?.email || "Unknown contact",
        subject: row.subject || "Untitled reply",
        body: row.body || "No reply body was stored.",
        receivedAt: row.sent_at || row.created_at,
        messageId: row.message_id,
        threadId: row.thread_id,
      };
    }),
  };
}

export async function listProducts(skus?: string[]): Promise<{ mode: DataMode; products: Product[] }> {
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, products: [] };
  await authorizeLiveRead();

  const query = createSupabaseAdmin()
    .from("products")
    .select("sku,name,image_url,material,color,diameter,weight,price,currency,moq,stock_status,lead_time,tags,active,sheet_updated_at")
    .order("name")
    .limit(500);
  const { data, error } = await (skus ? query.in("sku", skus) : query);
  if (error) throw new Error(`Unable to load products: ${error.message}`);
  const syncedProducts = (data ?? []).filter((row) => !row.sku.startsWith("SAMPLE-") && !row.name.toLowerCase().startsWith("[sample]")).map(crmProduct);
  const { withErpInventory } = await import("./inventory.ts");
  return { mode, products: await withErpInventory(syncedProducts) };
}

function eventTone(type: string) {
  if (type.includes("reply") || type.includes("interest")) return "green";
  if (type.includes("catalog")) return "violet";
  if (type.includes("sync")) return "amber";
  return "blue";
}

export async function getDashboardData() {
  const mode = getCrmDataMode();
  if (mode === "demo") {
    return {
      mode,
      companies: [],
      activity: [],
      emailQueueCount: 0,
      sentCount: 0,
      replyCount: 0,
      bigOrderCount: 0,
    };
  }

  await authorizeLiveRead();
  const client = createSupabaseAdmin();
  const [companies, eventsResult, queuedResult, sentResult, repliesResult, bigOrdersResult] = await Promise.all([
    queryCompanies(),
    client.from("events").select("type,data,created_at,companies(name)").order("created_at", { ascending: false }).limit(4),
    client.from("emails").select("id", { count: "exact", head: true }).in("status", ["draft", "pending_approval", "approved", "scheduled"]),
    client.from("emails").select("id", { count: "exact", head: true }).eq("status", "sent"),
    client.from("emails").select("id", { count: "exact", head: true }).eq("direction", "received"),
    client.from("pipeline").select("company_id", { count: "exact", head: true }).eq("stage", "big_order"),
  ]);
  if (eventsResult.error) throw new Error(`Unable to load activity: ${eventsResult.error.message}`);

  const activity: ActivityItem[] = ((eventsResult.data ?? []) as unknown as EventRow[]).map((row) => {
    const company = first(row.companies);
    const detail = typeof row.data?.summary === "string" ? row.data.summary : company?.name || "CRM event recorded";
    return { title: row.type.replaceAll("_", " "), detail, time: formatRelativeDate(row.created_at), tone: eventTone(row.type) };
  });

  return {
    mode,
    companies,
    activity,
    emailQueueCount: queuedResult.count ?? 0,
    sentCount: sentResult.count ?? 0,
    replyCount: repliesResult.count ?? 0,
    bigOrderCount: bigOrdersResult.count ?? 0,
  };
}
