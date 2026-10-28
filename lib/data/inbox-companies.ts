import { createSupabaseAdmin } from "../supabase/admin.ts";
import { getInitials, getPipelineStageLabel } from "../crm-model.ts";
import type { InboxEmailItem } from "../email-inbox.ts";
import type { AssignedEmailContacts } from "../email-access.ts";

type Relation<T> = T | T[] | null;
type CompanyRow = {
  id: string; name: string; website: string | null; country: string | null; city: string | null; segment: string | null; status: string; source: string | null;
  contacts: Relation<{ name: string | null; role: string | null; email: string }>;
  company_profiles: Relation<{ summary: string | null; fit_score: number | null; interest_tags: string[] | null }>;
  pipeline: Relation<{ stage: string; estimated_order_quantity: number | null; estimated_value: number | null; currency: string; owner_id: string | null }>;
};
const fields = "id,name,website,country,city,segment,status,source,contacts(name,role,email),company_profiles(summary,fit_score,interest_tags),pipeline(stage,estimated_order_quantity,estimated_value,currency,owner_id)";
const first = <T>(value: Relation<T>) => Array.isArray(value) ? value[0] : value;
const literalPattern = (value: string) => JSON.stringify(value.replace(/[\\%_]/g, "\\$&"));

/** Caller has authorized and filtered the inbox. Enrich only its correspondents;
 * never scan all companies or fetch Auth profiles/Storage avatars for a list. */
export async function listInboxCompanies(messages: InboxEmailItem[], assigned: AssignedEmailContacts) {
  const admin = createSupabaseAdmin();
  const addresses = [...new Set(messages.map((item) => item.contact.trim().toLowerCase()).filter((email) => email.includes("@") && !assigned?.has(email)))];
  const ids = [...new Set(messages.flatMap((item) => {
    const id = assigned?.get(item.contact.trim().toLowerCase());
    return id ? [id] : [];
  }))];
  const names = [...new Set(messages.filter((item) => !item.contact.includes("@")).map((item) => item.company).filter(Boolean))];
  const rows = new Map<string, CompanyRow>();
  const aliases = new Map<string, string[]>();
  await Promise.all([
    (async () => {
      for (let start = 0; start < addresses.length; start += 50) {
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await admin.from("contacts").select(`email,companies!inner(${fields})`)
            .or(addresses.slice(start, start + 50).map((email) => `email.ilike.${literalPattern(email)}`).join(","))
            .order("id").range(offset, offset + 499);
          if (error) throw new Error(`Unable to load email customer context: ${error.message}`);
          for (const match of data ?? []) {
            const company = first(match.companies as unknown as Relation<CompanyRow>);
            if (!company || company.source === "sample_seed") continue;
            rows.set(company.id, company);
            aliases.set(company.id, [...(aliases.get(company.id) ?? []), match.email]);
          }
          if ((data?.length ?? 0) < 500) break;
        }
      }
    })(),
    (async () => {
      const filters = [...ids.map((id) => `id.eq.${JSON.stringify(id)}`), ...names.map((name) => `name.ilike.${literalPattern(name)}`)];
      for (let start = 0; start < filters.length; start += 50) {
        const { data, error } = await admin.from("companies").select(fields).or("source.is.null,source.neq.sample_seed")
          .or(filters.slice(start, start + 50).join(","));
        if (error) throw new Error(`Unable to load email customer context: ${error.message}`);
        for (const row of data ?? []) rows.set(row.id, row as unknown as CompanyRow);
      }
    })(),
  ]);
  const ownerIds = [...new Set([...rows.values()].map((row) => first(row.pipeline)?.owner_id).filter((id): id is string => Boolean(id)))];
  const { data: owners, error } = ownerIds.length
    ? await admin.from("workspace_members").select("user_id,display_name").in("user_id", ownerIds)
    : { data: [], error: null };
  if (error) throw new Error(`Unable to load email owners: ${error.message}`);
  const ownerNames = new Map((owners ?? []).map((owner) => [owner.user_id, owner.display_name || "BD Sales Manager"]));
  return { companies: [...rows.values()].flatMap((row) => {
    const contact = first(row.contacts), profile = first(row.company_profiles), pipeline = first(row.pipeline);
    const ownerId = pipeline?.owner_id ?? null;
    const ownerName = ownerId ? ownerNames.get(ownerId) || "BD Sales Manager" : "Unassigned";
    return [...new Set([contact?.email || "", ...(aliases.get(row.id) ?? [])])].map((email) => ({
      id: row.id, name: row.name, email, contact: contact?.name || "No contact yet", contactRole: contact?.role || "Role not confirmed",
      website: row.website || "", country: row.country || "Unknown", city: row.city || "", segment: row.segment || "Unclassified",
      summary: profile?.summary || "This company has not been profiled yet.", tags: profile?.interest_tags ?? [], fitScore: profile?.fit_score ?? 0,
      stage: getPipelineStageLabel(pipeline?.stage || row.status), estimatedOrderQuantity: pipeline?.estimated_order_quantity ?? null,
      estimatedValue: pipeline?.estimated_value == null ? null : Number(pipeline.estimated_value), currency: pipeline?.currency || "USD",
      ownerId, ownerName, ownerInitials: ownerId ? getInitials(ownerName) : "—", ownerAvatarUrl: undefined as string | undefined,
    }));
  }) };
}
