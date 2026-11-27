import { requireWorkspaceMember } from "../auth.ts";
import { companyListRequestSchema, type CompanyListPage, type CompanyListRequest } from "../company-list.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { SegmentRules } from "../segments.ts";
import { getCrmDataMode, listCompanies, mapCompany } from "./crm.ts";
import { memberAvatarUrl } from "../member-avatar-url.ts";

export async function listCompanyPage(input: CompanyListRequest, rules?: SegmentRules, asOf = new Date().toISOString()): Promise<CompanyListPage> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const request = companyListRequestSchema.parse(input);
  const mode = getCrmDataMode();
  if (mode === "demo") return { mode, companies: [], total: 0, page: 1, countries: [], segments: [], buckets: [] };
  const { data, error } = await createSupabaseAdmin().rpc("crm_company_list_page", {
    p_owner: viewer.role === "bd_manager" ? viewer.id : null,
    p_rules: rules ?? {}, p_segment: request.segment ?? null,
    p_query: request.query, p_country: request.country, p_tag: request.tag,
    p_sort: request.sort, p_desc: request.descending, p_page: request.page, p_size: request.pageSize, p_as_of: asOf,
  });
  if (error) throw new Error(`Unable to load companies: ${error.message}`);
  const result = data as { ids: string[]; rows?: Array<{ row: Parameters<typeof mapCompany>[0]; ownerName: string; paidOrderCount: number }>; total: number; page: number; countries: string[]; segments: string[]; buckets: CompanyListPage["buckets"] };
  // Current databases return the visible rows in one RPC. The bounded ID read
  // keeps older database versions usable during rolling deployments.
  const { companies } = result.rows ? { companies: result.rows.map(({ row, ownerName, paidOrderCount }) => {
    const ownerId = (Array.isArray(row.pipeline) ? row.pipeline[0] : row.pipeline)?.owner_id;
    return mapCompany(row, ownerId ? new Map([[ownerId, ownerName]]) : new Map(), ownerId ? new Map([[ownerId, memberAvatarUrl(ownerId)]]) : new Map(), paidOrderCount);
  }) } : result.ids.length ? await listCompanies({ ids: result.ids }) : { companies: [] };
  const byId = new Map(companies.map(company => [company.id, company]));
  return { mode, total: result.total, page: result.page, countries: result.countries, segments: result.segments, buckets: result.buckets,
    companies: result.ids.flatMap(id => { const company = byId.get(id); return company ? [company] : []; }) };
}
