import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { buildMyDay, type MyDayData, type MyDayTask, type MyDayFollowup, type MyDayInvoice, type MyDayReply, type MyDaySource } from "../my-day.ts";

type Relation<T> = T | T[] | null;
const first = <T,>(value: Relation<T>): T | null => Array.isArray(value) ? value[0] ?? null : value;
type Company = { name: string; source?: string | null };
type TaskRow = Omit<MyDayTask, "company_name"> & { companies: Relation<Company> };
type FollowupRow = { company_id: string; next_followup_at: string; companies: Relation<Company> };
type InvoiceRow = Omit<MyDayInvoice, "company_name"> & { customer_name: string | null; companies?: Relation<Company> };
type ReplyRow = Omit<MyDayReply, "task_status"> & { crm_tasks: Relation<{ status: string; assigned_to: string | null }> };
type Result = { data: unknown[] | null; error: { message: string } | null; count: number | null };

// Only the server-authenticated wrapper calls this reader in the application.
// Separate inputs let integration tests verify real queries without forging sessions.
export async function readMyDayData(client: ReturnType<typeof createSupabaseAdmin>, viewer: { id: string; role: string }, now = new Date()): Promise<MyDayData> {
  const sources: MyDaySource[] = [];
  async function read<T>(id: string, label: string, query: (from: number, to: number) => PromiseLike<Result>): Promise<T[]> {
    try {
      const rows: T[] = [];
      for (;;) {
        const { data, error, count } = await query(rows.length, rows.length + 499);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as T[];
        rows.push(...batch);
        if (count !== null && rows.length >= count) break;
        if (!batch.length) {
          if (count !== null && rows.length < count) throw new Error("Incomplete My Day source");
          break;
        }
        if (count === null && batch.length < 500) break;
      }
      sources.push({ id, label, ok: true });
      return rows;
    } catch {
      sources.push({ id, label, ok: false });
      return [];
    }
  }
  const invoiceFields = "id,number,status,total_minor,paid_minor,customer_name:document->>customerName,due_date:document->>dueDate,currency:document->>currency";
  const replyQuery = () => {
    let query = client.from("agent_reply_requests")
      .select(`id,company_name,task_id,status,expires_at,crm_tasks(status,assigned_to)${viewer.role === "bd_manager" ? ",companies!inner(pipeline!inner(owner_id))" : ""}`, { count: "exact" })
      .eq("user_id", viewer.id).eq("owner_role", viewer.role).in("status", ["received", "expired", "blocked", "uncertain"]);
    if (viewer.role === "bd_manager") query = query.eq("companies.pipeline.owner_id", viewer.id);
    return query;
  };
  const today = new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
  const [tasks, followups, ownInvoices, assignedInvoices, replies] = await Promise.all([
    read<TaskRow>("tasks", "Your tasks", (from, to) => client.from("crm_tasks")
      .select("id,title,company_id,priority,due_at,status,notes,companies(name)", { count: "exact" })
      .eq("assigned_to", viewer.id).eq("status", "open").order("id").range(from, to)),
    read<FollowupRow>("followups", "Your customer follow-ups", (from, to) => client.from("pipeline")
      .select("company_id,next_followup_at,companies!inner(name,source)", { count: "exact" })
      .eq("owner_id", viewer.id).not("next_followup_at", "is", null).order("company_id").range(from, to)),
    read<InvoiceRow>("ownInvoices", "Invoices you created", (from, to) => client.from("invoices")
      .select(invoiceFields, { count: "exact" }).eq("created_by", viewer.id).eq("status", "issued")
      .lte("document->>dueDate", today).order("id").range(from, to)),
    read<InvoiceRow>("assignedInvoices", "Your customers' invoices", (from, to) => client.from("invoices")
      .select(`${invoiceFields},companies!inner(name,pipeline!inner(owner_id))`, { count: "exact" })
      .eq("companies.pipeline.owner_id", viewer.id).eq("status", "issued").lte("document->>dueDate", today).order("id").range(from, to)),
    viewer.role === "viewer" ? Promise.resolve([] as ReplyRow[]) : read<ReplyRow>("replies", "Your customer reply reviews", (from, to) => replyQuery().order("id").range(from, to)),
  ]);
  return {
    items: buildMyDay({
      tasks: tasks.map(({ companies, ...task }) => ({ ...task, company_name: first(companies)?.name ?? null })),
      followups: followups.filter(row => first(row.companies)?.source !== "sample_seed").map(row => ({ company_id: row.company_id, due_at: row.next_followup_at, company_name: first(row.companies)?.name ?? "Customer" } as MyDayFollowup)),
      invoices: [...ownInvoices, ...assignedInvoices].map(({ customer_name, companies, ...invoice }) => ({ ...invoice, company_name: first(companies ?? null)?.name || customer_name || "Customer" })),
      replies: replies.filter(row => !row.task_id || first(row.crm_tasks)?.assigned_to === viewer.id).map(({ crm_tasks, ...reply }) => ({ ...reply, task_status: first(crm_tasks)?.status ?? null })),
    }, now),
    sources: sources.sort((a, b) => a.id.localeCompare(b.id)), asOf: now.toISOString(),
  };
}

export async function getMyDayData(): Promise<MyDayData> {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return readMyDayData(createSupabaseAdmin(), viewer);
}
