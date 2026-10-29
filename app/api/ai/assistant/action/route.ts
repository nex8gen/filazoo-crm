import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { agentApprovalAllowed, preparedAgentActionSchema } from "@/lib/ai/agent-actions";
import { executeAgentAction } from "@/lib/ai/agent-execution";

// Shipping approval uses the existing email API's after() worker budget.
export const maxDuration = 240;
const headers = { "Cache-Control": "private, no-store" };
const decisionSchema = z.object({ id: z.uuid(), decision: z.enum(["approve", "decline"]), approval: z.enum(["manual", "auto"]) }).strict();

export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Invalid proposal ID." }, { status: 400, headers });
  const { data, error } = await createSupabaseAdmin().from("workspace_agent_actions").select("status,result").eq("id", id.data).eq("user_id", viewer.id).maybeSingle();
  if (error) return Response.json({ error: "Unable to read action progress." }, { status: 503, headers });
  if (!data) return Response.json({ error: "Proposal not found." }, { status: 404, headers });
  return Response.json({ status: data.status, progress: data.result?.progress ?? null }, { headers });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403, headers });
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  if (viewer.role === "viewer") return Response.json({ error: "Your workspace role is read-only." }, { status: 403, headers });
  const parsed = decisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Approve or decline a saved agent proposal." }, { status: 400, headers });
  const { id, decision, approval } = parsed.data;
  const db = createSupabaseAdmin();
  const { data: row, error } = await db.from("workspace_agent_actions").select("*").eq("id", id).eq("user_id", viewer.id).maybeSingle();
  if (error) return Response.json({ error: "Unable to read the saved proposal." }, { status: 503, headers });
  if (!row) return Response.json({ error: "Proposal not found." }, { status: 404, headers });
  if (row.status === "completed") return Response.json({ ...row.result, status: "completed" }, { headers });
  if (row.status !== "pending") return Response.json({ ...row.result, status: row.status, error: row.result?.error || "This action has already been handled or is running. Check its result before starting another task." }, { status: 409, headers });
  if (new Date(row.expires_at).getTime() <= Date.now()) return Response.json({ error: "This proposal expired. Ask the agent to prepare it again.", status: "expired" }, { status: 409, headers });
  if (!agentApprovalAllowed(row.approval_mode, approval)) return Response.json({ error: "This proposal requires your manual approval." }, { status: 403, headers });
  const action = preparedAgentActionSchema.safeParse(row.action);
  if (!action.success) return Response.json({ error: "The saved proposal is invalid." }, { status: 400, headers });
  // Compare-and-set is the execution lock across clicks, retries and server instances.
  const { data: claimed, error: claimError } = await db.from("workspace_agent_actions").update({ status: decision === "decline" ? "declined" : "running", approval }).eq("id", id).eq("user_id", viewer.id).eq("status", "pending").select("id").maybeSingle();
  if (claimError || !claimed) return Response.json({ error: "Another request already handled this action. Check its result.", status: "running" }, { status: 409, headers });
  if (decision === "decline") return Response.json({ success: "Action declined. Nothing was changed.", status: "declined" }, { headers });
  try {
    const result = await executeAgentAction(id, action.data, viewer, request);
    const saved = await db.from("workspace_agent_actions").update({ status: "completed", result, finished_at: new Date().toISOString() }).eq("id", id).eq("user_id", viewer.id);
    if (saved.error) console.error("Agent result persistence failed", saved.error.code);
    return Response.json({ ...result, status: "completed" }, { headers });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "The action could not be completed. Check Invoices and Sent before starting another task.";
    const checkpoint = await db.from("workspace_agent_actions").select("result").eq("id", id).eq("user_id", viewer.id).maybeSingle();
    const result = { ...checkpoint.data?.result, error: message };
    await db.from("workspace_agent_actions").update({ status: "failed", result, finished_at: new Date().toISOString() }).eq("id", id).eq("user_id", viewer.id);
    return Response.json({ ...result, status: "failed" }, { status: 400, headers });
  }
}
