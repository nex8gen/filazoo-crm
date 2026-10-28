import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { preparedAgentEmailSchema } from "@/lib/ai/agent-actions";
import { prepareAgentEmail } from "@/lib/ai/agent-records";
import { getInvoice } from "@/lib/data/invoices";
import { agentCatalogAttachments } from "@/lib/ai/agent-catalog";

const headers = { "Cache-Control": "private, no-store" };
const draftSchema = preparedAgentEmailSchema.extend({ invoiceId: z.uuid().optional(), revision: z.number().int().positive().optional() });

export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to open this draft." }, { status: 401, headers });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "Invalid draft ID." }, { status: 400, headers });
  const { data, error } = await createSupabaseAdmin().from("workspace_agent_actions").select("status,result").eq("id", id.data).eq("user_id", viewer.id).maybeSingle();
  if (error) return Response.json({ error: "Unable to load the draft." }, { status: 503, headers });
  const draft = draftSchema.safeParse(data?.result?.draft);
  if (data?.status !== "completed" || !draft.success) return Response.json({ error: "Draft not found." }, { status: 404, headers });
  try {
    await prepareAgentEmail(draft.data, viewer);
    if (draft.data.invoiceId) {
      const invoice = await getInvoice(draft.data.invoiceId);
      if (!invoice || invoice.status === "void" || invoice.revision !== draft.data.revision) throw new Error("The invoice changed. Ask the agent to prepare a fresh email draft.");
    }
    const attachments = await agentCatalogAttachments(draft.data);
    return Response.json({ draft: { ...draft.data, attachments } }, { headers });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "This draft is no longer available." }, { status: 409, headers });
  }
}
