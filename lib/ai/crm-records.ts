import "server-only";
import { listReplyRequests } from "../data/customer-reply-requests";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { listWorkspaceFlows } from "../data/flows";
import { listWorkspaceMembers } from "../data/members";
import { loadAgentCompany } from "./agent-records";
import { crmReadSchema, type CrmRead } from "./crm-tools";
import { getInventoryState } from "../data/inventory";
import { readAgentAutoReplies } from "./crm-productivity-records";
import { variantsFromTags } from "../product-utils";
import { userProductRows } from "../data/product-personalization";

async function readPersonalProducts(viewer: WorkspaceViewer, input: CrmRead) {
  if (input.companyId) throw new Error("Products do not support a company filter.");
  const wanted = (input.id || input.query).toLowerCase();
  const all = await userProductRows(viewer.id);
  const matches = all.flatMap((row) => {
    const variants = variantsFromTags(row.tags ?? [], [], row.sku, String(row.price ?? ""), row.stock_status ?? "");
    const matchedVariants = variants.filter((variant) => variant.sku.toLowerCase() === wanted || variant.id.toLowerCase() === wanted);
    const parentMatches = input.id ? row.sku.toLowerCase() === wanted : !wanted || `${row.sku} ${row.name} ${row.color ?? ""}`.toLowerCase().includes(wanted);
    return parentMatches || matchedVariants.length ? [{ ...row, ...(matchedVariants.length ? { matchedVariants } : {}) }] : [];
  });
  const records = matches.slice(input.offset, input.offset + 10);
  if (JSON.stringify(records).length > 60_000) throw new Error("These records are too large. Look up one exact product at a time.");
  return { records, coverage: { matching: matches.length, included: records.length, offset: input.offset, nextOffset: matches.length > input.offset + records.length ? input.offset + records.length : null } };
}

/** Explicit projections prevent credentials, tokens and raw webhook payloads entering prompts. */
const resources = {
  companies: { table: "companies", fields: "id,name,website,country,city,segment,status,contacts(id,name,email),account: pipeline(owner_id,next_followup_at)", search: "name", order: "id" },
  products: { table: "products", fields: "sku,name,material,color,diameter,weight,price,currency,moq,stock_status,lead_time,image_url,tags,active,sheet_updated_at", search: "name", order: "sku" },
  orders: { table: "purchase_orders", fields: "id,company_id,reference,document,version,total_minor,created_at", search: "reference", order: "created_at" },
  invoices: { table: "invoices", fields: "id,company_id,number,status,revision,total_minor,paid_minor,document,created_by,created_at", search: "number", order: "created_at" },
  tasks: { table: "crm_tasks", fields: "id,company_id,assigned_to,title,notes,priority,status,due_at,created_at,workflow:crm_task_workflows(kind,status,invoice_id,revision)", search: "title", order: "created_at" },
  alerts: { table: "internal_notifications", fields: "id,message,channel,conversation_id,read_at,created_at", search: "message", order: "created_at" },
  catalogs: { table: "catalogs", fields: "id,company_id,currency,product_skus,version,price_date,created_at", search: "id", order: "created_at" },
  messages: { table: "meta_messages", fields: "id,thread_id,sender_id,recipient_id,customer_name,direction,body,source,created_at", search: "customer_name", order: "created_at" },
  members: { table: "workspace_members", fields: "user_id,display_name,role,auto_assign_leads,activated_at", search: "display_name", order: "user_id" },
  mailboxes: { table: "workspace_mailboxes", fields: "id,user_id,email,display_name,type,is_active,is_default", search: "email", order: "id" },
  segments: { table: "company_segments", fields: "id,name,description,rules,created_at", search: "name", order: "id" },
  business_facts: { table: "email_reply_knowledge", fields: "id,title,content,created_at", search: "title", order: "id" },
} as const;

export async function readCrmRecords(viewer: WorkspaceViewer, request: CrmRead) {
  const input = crmReadSchema.parse(request);
  const db = createSupabaseAdmin();
  if (input.resource === "reply_requests") {
    const all = await listReplyRequests(viewer, { id: input.id, query: input.query, companyId: input.companyId });
    const records = all.slice(input.offset, input.offset + 10);
    return { records, coverage: { included: records.length, offset: input.offset, nextOffset: all.length > input.offset + records.length ? input.offset + records.length : null, scope: "Your accessible 50 most recent customer waits; older waits may be omitted." } };
  }
  if (input.resource === "products") return readPersonalProducts(viewer, input);
  if (input.resource === "auto_replies") return readAgentAutoReplies(viewer, input);
  if (input.resource === "inventory") {
    if (input.companyId) throw new Error("Inventory does not support a company filter.");
    const { status, snapshots, skuMap } = await getInventoryState();
    const aliases = Object.entries(skuMap);
    const matches = snapshots.filter((row) => (!input.id || row.sku === (skuMap[input.id] ?? input.id)) && (!input.query || [row.sku, ...aliases.filter(([, erpSku]) => erpSku === row.sku).map(([crmSku]) => crmSku)].some((sku) => sku.toLowerCase().includes(input.query.toLowerCase()))));
    const records = matches.slice(input.offset, input.offset + 10).map((row) => ({ ...row, crmSkus: aliases.filter(([, erpSku]) => erpSku === row.sku).map(([crmSku]) => crmSku) }));
    return { records, status, coverage: { matching: matches.length, included: records.length, nextOffset: matches.length > input.offset + 10 ? input.offset + 10 : null, scope: "Saved ERP snapshot; quantities aggregate the configured warehouses. No sync was started." } };
  }
  if (input.resource === "settings") {
    const personal = { preferences: viewer.preferences ?? {}, profile: { displayName: viewer.displayName } };
    if (!["admin", "operator"].includes(viewer.role)) return { records: [{ ...personal, billingAvailable: false }], coverage: { matching: 1, included: 1, nextOffset: null } };
    const { data, error } = await db.from("invoice_settings").select("settings").eq("singleton", true).maybeSingle();
    if (error) throw new Error("Unable to read billing settings.");
    return { records: [{ billing: data?.settings ?? {}, ...personal, billingAvailable: true }], coverage: { matching: 1, included: 1, nextOffset: null } };
  }
  if (input.resource === "flows") {
    const all = (await listWorkspaceFlows()).filter((flow) => (!input.id || flow.id === input.id) && (!input.query || flow.name.toLowerCase().includes(input.query.toLowerCase())));
    return { records: all.slice(input.offset, input.offset + 10), coverage: { matching: all.length, included: Math.min(10, Math.max(0, all.length - input.offset)), nextOffset: all.length > input.offset + 10 ? input.offset + 10 : null } };
  }
  if (input.resource === "members" && viewer.role === "admin") {
    const members = (await listWorkspaceMembers()).filter((member) => (!input.id || member.id === input.id) && (!input.query || `${member.displayName} ${member.email}`.toLowerCase().includes(input.query.toLowerCase())));
    return { records: members.slice(input.offset, input.offset + 10).map(({ id, email, displayName, role, autoAssignLeads, activated }) => ({ id, email, displayName, role, autoAssignLeads, activated })), coverage: { matching: members.length, included: Math.min(10, Math.max(0, members.length - input.offset)), nextOffset: members.length > input.offset + 10 ? input.offset + 10 : null } };
  }
  if (input.resource === "companies" && input.id) {
    if (!z.uuid().safeParse(input.id).success) throw new Error("Choose a valid company ID.");
    return { records: [await loadAgentCompany(input.id)], coverage: { matching: 1, included: 1, nextOffset: null } };
  }
  const config: { table: string; fields: string; search: string; order: string } = resources[input.resource];
  let query = db.from(config.table).select(config.fields, { count: "exact" });
  // Imported contact addresses can contain valid local-part characters that
  // the interactive form's stricter email validator does not accept.
  const contactSearch = input.resource === "companies" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.query);
  if (contactSearch) {
    const { data, error, count } = await db.from("contacts").select("company_id", { count: "exact" }).ilike("email", input.query.replace(/[\\%_]/g, "\\$&")).order("company_id").range(0, 500);
    if (error || (count ?? data?.length ?? 0) > 500) throw new Error("Unable to resolve this contact email. Use a company name or exact ID.");
    const ids = [...new Set((data ?? []).map((contact) => contact.company_id).filter((id) => typeof id === "string"))];
    if (!ids.length) return { records: [], coverage: { matching: 0, included: 0, nextOffset: null } };
    query = query.in("id", ids);
  }
  if (input.id) {
    if (!z.uuid().safeParse(input.id).success) throw new Error("Choose a valid record ID.");
    query = query.eq(input.resource === "members" ? "user_id" : "id", input.id);
  }
  if (input.companyId) {
    if (["orders", "invoices", "tasks", "catalogs"].includes(input.resource)) query = query.eq("company_id", input.companyId);
    else if (input.resource === "companies") query = query.eq("id", input.companyId);
    else throw new Error("This resource does not support a company filter.");
  }
  if (input.query && !contactSearch) {
    const literal = input.query.replace(/[\\%_]/g, "\\$&");
    if (input.resource === "invoices") {
      const number = /^(?:INV-)?0*(\d+)$/i.exec(input.query)?.[1];
      if (!number) throw new Error("Look up invoices by invoice number, exact ID, or companyId.");
      query = query.eq("number", Number(number));
    } else if (input.resource === "catalogs") {
      if (!z.uuid().safeParse(input.query).success) throw new Error("Look up catalogs by exact ID or companyId.");
      query = query.eq("id", input.query);
    } else query = query.ilike(config.search, `%${literal}%`);
  }
  if (input.resource === "tasks") query = query.eq("assigned_to", viewer.id);
  if (input.resource === "alerts") query = query.eq("user_id", viewer.id);
  if (input.resource === "catalogs") query = query.eq("user_id", viewer.id);
  if (input.resource === "mailboxes" && viewer.role !== "admin") query = query.eq("user_id", viewer.id).eq("type", "personal");
  const { data, error, count } = await query.order(config.order, { ascending: input.resource === "companies" }).range(input.offset, input.offset + 9);
  if (error) throw new Error(`Unable to read ${input.resource}. No changes were prepared.`);
  const rows = data ?? [];
  const encoded = JSON.stringify(rows);
  if (encoded.length > 60_000) throw new Error("These records are too large. Look up one exact record ID at a time.");
  return { records: rows, coverage: { matching: count, included: rows.length, offset: input.offset, nextOffset: count !== null && count > input.offset + rows.length ? input.offset + rows.length : null } };
}
