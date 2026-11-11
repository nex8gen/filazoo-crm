import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { FlowPreparationRetry } from "../flow-execution-errors.ts";

export async function assignedFlowActor(authorId: string, companyId: string | null, pinned?: string) {
  if (!companyId) throw new FlowPreparationRetry("Assign this customer to a salesperson before sending.", 60_000, "data");
  const db = createSupabaseAdmin();
  const { data: pipeline } = await db.from("pipeline").select("owner_id").eq("company_id", companyId).maybeSingle().throwOnError();
  if (!pipeline?.owner_id) throw new FlowPreparationRetry("Assign this customer to a salesperson before sending.", 60_000, "data");
  const { data: members } = await db.from("workspace_members").select("user_id,role,activated_at").in("user_id", [authorId, pipeline.owner_id]).throwOnError();
  const author = members?.find(member => member.user_id === authorId), actor = members?.find(member => member.user_id === pipeline.owner_id);
  if (!actor?.activated_at || actor.role === "viewer" || !author?.activated_at || author.role === "viewer"
    || authorId !== actor.user_id && !["admin", "operator"].includes(author.role)) {
    throw new FlowPreparationRetry("The workflow is not authorized to send as this customer's assigned salesperson.", 3_600_000, "configuration");
  }
  if (pinned && pinned !== actor.user_id) throw new FlowPreparationRetry("The assigned salesperson changed after this journey started. Review the conversation before resuming.", 3_600_000, "data");
  return actor.user_id as string;
}

export async function assignedFlowCandidates(authorId: string, companyId?: string) {
  if (companyId) return [await assignedFlowActor(authorId, companyId)];
  const db = createSupabaseAdmin();
  const { data: author } = await db.from("workspace_members").select("role,activated_at").eq("user_id", authorId).maybeSingle().throwOnError();
  if (!author?.activated_at || !["admin", "operator"].includes(author.role)) throw new Error("Only an administrator or operator can enable assigned-salesperson sending for a workspace-wide workflow.");
  const { data } = await db.from("workspace_members").select("user_id").eq("auto_assign_leads", true).not("activated_at", "is", null).neq("role", "viewer").throwOnError();
  if (!data?.length) throw new Error("Enable lead assignment for at least one active salesperson before using assigned-salesperson sending.");
  return data.map(member => member.user_id as string);
}
