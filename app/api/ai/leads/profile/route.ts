import { getWorkspaceViewer } from "@/lib/auth";
import { LeadError, prepareLeadProfile } from "@/lib/data/ai-leads";

export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to an active workspace." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Open AI Leads in this CRM to prepare targeting." }, { status: 403, headers });
  try {
    const raw = await request.text();
    if (raw.length > 10000) throw new LeadError("Product description is too long.");
    const body = JSON.parse(raw);
    return Response.json({ profile: await prepareLeadProfile(viewer, body) }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Choose valid product information." }, { status: 400, headers });
    return Response.json({ error: error instanceof LeadError ? error.message : "Buyer targeting could not be prepared. Check workspace AI access and try again." }, { status: error instanceof LeadError ? error.status : 503, headers });
  }
}
