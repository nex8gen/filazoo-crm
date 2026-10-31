import { createHash } from "node:crypto";
import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { companyExportSnapshot } from "@/lib/ai/company-export-records";
import { companyExportCsv } from "@/lib/company-export";
import { preparedCrmActionSchema } from "@/lib/ai/crm-tools";
import { getAiSettings } from "@/lib/data/ai-settings";
import { aiActionApproval } from "@/lib/ai-policy";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers });
  if (viewer.role === "viewer") return Response.json({ error: "Your workspace role is read-only." }, { status: 403, headers });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Invalid export ID." }, { status: 400, headers });
  const { data, error } = await createSupabaseAdmin().from("workspace_agent_actions").select("action,status,expires_at").eq("id", id.data).eq("user_id", viewer.id).maybeSingle();
  if (error) return Response.json({ error: "Unable to read this export." }, { status: 503, headers });
  if (!data) return Response.json({ error: "Export not found." }, { status: 404, headers });
  const action = preparedCrmActionSchema.safeParse(data.action);
  if (data.status !== "completed" || !action.success || action.data.operation.op !== "export_companies") return Response.json({ error: "Approve this export before downloading it." }, { status: 409, headers });
  if (Date.parse(data.expires_at) <= Date.now()) return Response.json({ error: "This export expired. Prepare a new export." }, { status: 410, headers });
  try {
    aiActionApproval((await getAiSettings()).policy, action.data, "ask");
    const snapshot = await companyExportSnapshot(action.data.operation.selection);
    const hash = createHash("sha256").update(JSON.stringify(snapshot.value)).digest("hex");
    if (hash !== action.data.fingerprint) return Response.json({ error: "The selected data changed. Prepare a new export to review the current selection." }, { status: 409, headers });
    return new Response(companyExportCsv(snapshot.records), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="filazoo-companies.csv"' } });
  } catch { return Response.json({ error: "Unable to build this export. Refresh the selection and try again." }, { status: 503, headers }); }
}
