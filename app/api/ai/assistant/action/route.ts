import { createCompany } from "@/app/crm-actions";
import { getWorkspaceViewer } from "@/lib/auth";
import { workspaceActionSchema } from "@/lib/ai/workspace-assistant";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403, headers: responseHeaders });
  }
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in with an active workspace account." }, { status: 401, headers: responseHeaders });
  if (!(["admin", "operator", "bd_manager"] as string[]).includes(viewer.role)) {
    return Response.json({ error: "Your workspace role is read-only." }, { status: 403, headers: responseHeaders });
  }
  const parsed = workspaceActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "This proposed action is incomplete or invalid." }, { status: 400, headers: responseHeaders });

  if (parsed.data.type === "create_company") {
    const formData = new FormData();
    Object.entries(parsed.data.company).forEach(([key, value]) => formData.set(key, value));
    const result = await createCompany(undefined, formData);
    if (result?.error) return Response.json({ error: result.error }, { status: 400, headers: responseHeaders });
    return Response.json({ success: result?.success || `${parsed.data.company.name} was added.` }, { headers: responseHeaders });
  }
}
