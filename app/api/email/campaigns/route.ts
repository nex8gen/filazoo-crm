import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { campaignConfigSchema } from "@/lib/email-campaigns";
import { marketingYearSchema } from "@/lib/marketing-assets";
import { MarketingAssetError } from "@/lib/data/marketing-assets";
import { getCampaignOptions, getCampaignDeliverySummary, queueCampaign, resolveCampaignAudience } from "@/lib/data/email-campaigns";

export const maxDuration = 240;
const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof MarketingAssetError ? error.message : "Unable to load or update this campaign. Please try again." }, { status: error instanceof MarketingAssetError ? error.status : 503, headers });
}
export async function GET() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to an active workspace." }, { status: 401, headers });
  try { return Response.json(await getCampaignOptions(viewer), { headers }); }
  catch (error) { return failure(error); }
}
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), config: campaignConfigSchema }),
  z.object({ action: z.literal("delivery"), id: z.uuid() }),
  z.object({ action: z.literal("queue"), id: z.uuid(), year: marketingYearSchema, updatedAt: z.iso.datetime({ offset: true }) }),
]);
export async function POST(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to an active workspace." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Use this workspace to update campaigns." }, { status: 403, headers });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the campaign settings." }, { status: 400, headers });
  if (parsed.data.action === "queue" && viewer.role === "viewer") return Response.json({ error: "Your role cannot send campaigns." }, { status: 403, headers });
  try {
    const input = parsed.data;
    if (input.action === "delivery") return Response.json(await getCampaignDeliverySummary(viewer, input.id), { headers });
    if (input.action === "preview") {
      const preview = await resolveCampaignAudience(viewer, input.config);
      return Response.json({ count: preview.recipients.length, selected: preview.selected, unverified: preview.unverified, excluded: preview.excluded, recent: preview.recent, recipients: preview.recipients.slice(0, 10) }, { headers });
    }
    return Response.json(await queueCampaign(viewer, input.id, input.year, input.updatedAt), { headers });
  } catch (error) { return failure(error); }
}
