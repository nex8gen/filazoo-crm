import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth";
import { createSupabaseAdmin } from "../supabase/admin";
import { listWorkspaceFlows } from "../data/flows";
import { listWorkspaceMembers } from "../data/members";
import { loadAgentCompany } from "./agent-records";
import { crmReadSchema, type CrmRead } from "./crm-tools";

/** Explicit projections prevent credentials, tokens and raw webhook payloads entering prompts. */
const resources = {
  companies: { table: "companies", fields: "id,name,website,country,city,segment,status,contacts(id,name,email),pipeline(stage,owner_id,next_followup_at,estimated_value,currency)", search: "name", order: "id" },
  products: { table: "products", fields: "sku,name,material,color,diameter,weight,price,currency,moq,stock_status,lead_time,image_url,tags,active,sheet_updated_at", search: "name", order: "sku" },
  orders: { table: "purchase_orders", fields: "id,company_id,reference,document,version,total_minor,created_at", search: "reference", order: "created_at" },
  invoices: { table: "invoices", fields: "id,company_id,number,status,revision,total_minor,paid_minor,document,created_by,created_at", search: "number", order: "created_at" },
  tasks: { table: "crm_tasks", fields: "id,company_id,assigned_to,title,notes,priority,status,due_at,created_at", search: "title", order: "created_at" },
  alerts: { table: "internal_notifications", fields: "id,message,channel,conversation_id,read_at,created_at", search: "message", order: "created_at" },
  catalogs: { table: "catalogs", fields: "id,company_id,currency,product_skus,version,price_date,created_at", search: "id", order: "created_at" },
  messages: { table: "meta_messages", fields: "id,thread_id,sender_id,recipient_id,customer_name,direction,body,source,created_at", search: "customer_name", order: "created_at" },
  members: { table: "workspace_members", fields: "user_id,display_name,role,auto_assign_leads,activated_at", search: "display_name", order: "user_id" },
  mailboxes: { table: "workspace_mailboxes", fields: "id,user_id,email,display_name,type,is_active,is_default", search: "email", order: "id" },
} as const;

export async function readCrmRecords(viewer: WorkspaceViewer, request: CrmRead) {
  const input = crmReadSchema.parse(request);
  const db = createSupabaseAdmin();
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
  if (input.id) {
    if (input.resource !== "products" && !z.uuid().safeParse(input.id).success) throw new Error("Choose a valid record ID.");
    query = query.eq(input.resource === "products" ? "sku" : input.resource === "members" ? "user_id" : "id", input.id);
  }
  if (input.companyId) {
    if (["orders", "invoices", "tasks", "catalogs"].includes(input.resource)) query = query.eq("company_id", input.companyId);
    else if (input.resource === "companies") query = query.eq("id", input.companyId);
    else throw new Error("This resource does not support a company filter.");
  }
  if (input.query) {
    const literal = input.query.replace(/[\\%_]/g, "\\$&");
    if (input.resource === "products") {
      // Separate indexed SKU/name queries avoid interpreting user text as PostgREST filter syntax.
      const quoted = `"%${literal.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}%"`;
      query = query.or(`sku.ilike.${quoted},name.ilike.${quoted}`);
    } else if (input.resource === "invoices") {
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
  if (input.resource === "mailboxes" && viewer.role !== "admin") query = query.eq("user_id", viewer.id).eq("type", "personal");
  const { data, error, count } = await query.order(config.order, { ascending: input.resource === "products" || input.resource === "companies" }).range(input.offset, input.offset + 9);
  if (error) throw new Error(`Unable to read ${input.resource}. No changes were prepared.`);
  const rows = data ?? [];
  const encoded = JSON.stringify(rows);
  if (encoded.length > 60_000) throw new Error("These records are too large. Look up one exact record ID at a time.");
  return { records: rows, coverage: { matching: count, included: rows.length, offset: input.offset, nextOffset: count !== null && count > input.offset + rows.length ? input.offset + rows.length : null } };
}
