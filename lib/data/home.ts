import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { buildHomePeriod, buildHomeReport, type HomeData, type HomeInputs, type HomePeriod, type HomeRange } from "../home.ts";
import { resolveMemberAvatars } from "./cached-member-avatars.ts";

type Relation<T> = T | T[] | null;
const first = <T,>(value: Relation<T>) => Array.isArray(value) ? value[0] ?? null : value;
type CompanyRow = { id: string; created_at: string; pipeline: Relation<{ owner_id: string | null; stage: string }> };
type OrderRow = { company_id: string; order_date: string; created_at: string; status: string; currency: string; total_minor: number };
type PageResult = { data: unknown[] | null; count: number | null; error: { message: string } | null };

export async function getHomeData(range?: Partial<HomeRange>): Promise<HomeData> {
  const viewer = await requireWorkspaceMember();
  const client = createSupabaseAdmin(), now = new Date(), isAdmin = viewer.role === "admin";
  const unavailable: string[] = [];
  async function read<T>(label: string, query: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
    try {
      const rows: T[] = [];
      for (;;) {
        const { data, count, error } = await query(rows.length, rows.length + 499);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as T[];
        rows.push(...batch);
        if (count !== null && rows.length >= count) return rows;
        if (!batch.length) {
          if (count !== null && rows.length < count) throw new Error("Incomplete source");
          return rows;
        }
        if (count === null && batch.length < 500) return rows;
      }
    } catch { unavailable.push(label); return []; }
  }
  const [companies, emails, orders, members] = await Promise.all([
    read<CompanyRow>("Customers", (from, to) => {
      let query = client.from("companies").select(`id,created_at,pipeline${isAdmin ? "" : "!inner"}(owner_id,stage)`, { count: "exact" }).or("source.is.null,source.neq.sample_seed");
      if (!isAdmin) query = query.eq("pipeline.owner_id", viewer.id);
      return query.order("id").range(from, to);
    }),
    read<{ owner_id: string | null; sent_at: string; created_at: string }>("Sent emails", (from, to) => {
      let query = client.from("emails").select("owner_id,sent_at,created_at", { count: "exact" }).eq("direction", "sent").eq("status", "sent");
      if (!isAdmin) query = query.eq("owner_id", viewer.id);
      return query.order("id").range(from, to);
    }),
    read<OrderRow>("Orders", (from, to) => {
      let query = client.from("purchase_orders").select(`company_id,created_at,total_minor,order_date:document->>orderDate,status:document->>status,currency:document->>currency${isAdmin ? "" : ",companies!inner(pipeline!inner(owner_id))"}`, { count: "exact" });
      if (!isAdmin) query = query.eq("companies.pipeline.owner_id", viewer.id);
      return query.order("id").range(from, to);
    }),
    // Do not query or serialize other teammates' performance for non-admins.
    isAdmin ? read<{ user_id: string; display_name: string | null; role: string }>("Team members", (from, to) => client.from("workspace_members").select("user_id,display_name,role", { count: "exact" }).not("activated_at", "is", null).order("user_id").range(from, to)) : Promise.resolve([]),
  ]);
  const avatars = isAdmin ? await resolveMemberAvatars(members.map(row => row.user_id)) : new Map<string, string>();
  const input: HomeInputs = {
    companies: companies.map(row => ({ id: row.id, createdAt: row.created_at, ownerId: first(row.pipeline)?.owner_id ?? null, stage: first(row.pipeline)?.stage ?? "new" })),
    emails: emails.map(row => ({ ownerId: row.owner_id, sentAt: row.sent_at || row.created_at })),
    orders: orders.map(row => ({ companyId: row.company_id, date: row.order_date || row.created_at, status: row.status || "draft", currency: row.currency || "USD", totalMinor: Number(row.total_minor) })),
    members: members.map(row => ({ id: row.user_id, name: row.display_name || "Workspace member", role: row.role, avatarUrl: avatars.get(row.user_id) })),
  };
  return { name: viewer.displayName?.split(/\s+/)[0] || "there", workspaceName: viewer.workspaceName, isAdmin, asOf: now.toISOString(),
    preferenceKey: `${viewer.workspaceId}:${viewer.id}`,
    report: buildHomeReport(input, range, now, isAdmin),
    unavailable: unavailable.sort(),
    periods: Object.fromEntries((["today", "month", "all"] as HomePeriod[]).map(period => [period, buildHomePeriod(input, period, now, isAdmin)])) as HomeData["periods"] };
}
