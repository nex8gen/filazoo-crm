import "server-only";
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
  segments: { table: "company_segments", fields: "id,name,description,rules,created_at", search: "name", order: "id" },
  business_facts: { table: "email_reply_knowledge", fields: "id,title,content,created_at", search: "title", order: "id" },
} as const;

export async function readCrmRecords(viewer: WorkspaceViewer, request: CrmRead) {
  const input = crmReadSchema.parse(request);
  const db = createSupabaseAdmin();
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
    if (input.resource !== "products" && !z.uuid().safeParse(input.id).success) throw new Error("Choose a valid record ID.");
    query = query.eq(input.resource === "products" ? "sku" : input.resource === "members" ? "user_id" : "id", input.id);
  }
  if (input.companyId) {
    if (["orders", "invoices", "tasks", "catalogs"].includes(input.resource)) query = query.eq("company_id", input.companyId);
    else if (input.resource === "companies") query = query.eq("id", input.companyId);
    else throw new Error("This resource does not support a company filter.");
  }
  if (input.query && !contactSearch) {
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
  if (input.resource === "products" && !rows.length && (input.query || input.id) && input.offset === 0) {
    // Variants are stored in encoded tags rather than a searchable SKU column.
    // A complete bounded scan resolves an exact variant without guessing a parent.
    const wanted = (input.id || input.query).toLowerCase();
    const matches: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const page = await db.from("products").select(config.fields).order("sku").range(offset, offset + 499);
      if (page.error) throw new Error("Unable to resolve the product variant.");
      for (const row of (page.data ?? []) as unknown as Array<Record<string, unknown> & { sku: string; tags: string[] | null; price: number | null; stock_status: string | null }>) {
        const variants = variantsFromTags(row.tags ?? [], [], String(row.sku), row.price === null ? "" : String(row.price), String(row.stock_status || ""));
        const matched = variants.filter((variant) => variant.sku.toLowerCase() === wanted || variant.id.toLowerCase() === wanted);
        if (matched.length || String(row.sku).toLowerCase() === wanted) matches.push({ ...row, matchedVariants: matched.map(({ id, name, sku, price }) => ({ id, name, sku, price })) });
      }
      if ((page.data?.length ?? 0) < 500) break;
      if (offset >= 4500) throw new Error("Narrow this variant lookup to a product family; the catalog scan limit was reached.");
    }
    if (matches.length > 10 || JSON.stringify(matches).length > 60_000) throw new Error("This variant matches too many product records. Narrow the product family.");
    return { records: matches, coverage: { matching: matches.length, included: matches.length, nextOffset: null, scope: "Exact variant SKU or ID matched to its saved parent product." } };
  }
  const encoded = JSON.stringify(rows);
  if (encoded.length > 60_000) throw new Error("These records are too large. Look up one exact record ID at a time.");
  return { records: rows, coverage: { matching: count, included: rows.length, offset: input.offset, nextOffset: count !== null && count > input.offset + rows.length ? input.offset + rows.length : null } };
}
