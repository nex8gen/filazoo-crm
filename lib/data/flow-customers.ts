import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { flowCustomerQuerySchema, type FlowCustomer, type FlowCompany } from "../flow-customers.ts";

export async function listFlowCustomers(input: unknown) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const parsed = flowCustomerQuerySchema.parse(input);
  const admin = createSupabaseAdmin();
  const pageSize = 50;
  // Strip PostgREST filter syntax; searches are literal words, never expressions.
  const search = parsed.query.replace(/[,().%_*"\\]/g, " ").trim();
  if (parsed.kind === "companies") {
    let query = admin.from("companies").select("id,name").order("name").order("id");
    if (search) query = query.ilike("name", `%${search}%`);
    const { data, error } = await query.range(parsed.offset, parsed.offset + pageSize);
    if (error) throw new Error(`Unable to load companies: ${error.message}`);
    return { companies: (data ?? []).slice(0, pageSize) as FlowCompany[], hasMore: (data?.length ?? 0) > pageSize };
  }
  let query = admin.from("contacts").select("id,name,email,company_id,companies!inner(name)").order("name", { nullsFirst: false }).order("id");
  if (parsed.ids) query = query.in("id", parsed.ids);
  else {
    query = query.eq("company_id", parsed.companyId!);
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    query = query.range(parsed.offset, parsed.offset + pageSize);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Unable to load customers: ${error.message}`);
  const customers: FlowCustomer[] = (parsed.ids ? data ?? [] : (data ?? []).slice(0, pageSize)).map((row) => {
    const company = row.companies as unknown as { name: string } | Array<{ name: string }>;
    return { id: row.id, name: row.name, email: row.email, companyId: row.company_id, companyName: (Array.isArray(company) ? company[0]?.name : company?.name) || "Company" };
  });
  return { customers, hasMore: !parsed.ids && (data?.length ?? 0) > pageSize };
}
