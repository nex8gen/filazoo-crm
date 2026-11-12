import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspaceViewer } from "@/lib/auth";
import { deleteMarketingAsset, listMarketingAssets, MarketingAssetError, saveMarketingAsset } from "@/lib/data/marketing-assets";
import { marketingYearSchema } from "@/lib/marketing-assets";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof MarketingAssetError ? error.message : "Marketing assets are temporarily unavailable. Please try again." }, { status: error instanceof MarketingAssetError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to an active workspace." }, { status: 401, headers });
  const year = marketingYearSchema.safeParse(new URL(request.url).searchParams.get("year"));
  if (!year.success) return Response.json({ error: "Choose a valid year." }, { status: 400, headers });
  try {
    const assets = await listMarketingAssets(viewer, year.data);
    return Response.json({ assets }, { headers });
  }
  catch (error) { return failure(error); }
}
async function write(request: Request, remove: boolean) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return Response.json({ error: "Sign in to an active workspace." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Use this workspace to update marketing assets." }, { status: 403, headers });
  if (viewer.role === "viewer") return Response.json({ error: "Your role cannot edit marketing assets." }, { status: 403, headers });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400, headers }); }
  try {
    if (remove) {
      const parsed = z.object({ id: z.uuid(), updatedAt: z.iso.datetime({ offset: true }) }).safeParse(body);
      if (!parsed.success) return Response.json({ error: "Choose a saved marketing asset." }, { status: 400, headers });
      await deleteMarketingAsset(viewer, parsed.data.id, parsed.data.updatedAt);
      revalidatePath("/email/campaigns");
      return Response.json({ ok: true }, { headers });
    }
    const asset = await saveMarketingAsset(viewer, body);
    revalidatePath("/email/campaigns");
    return Response.json({ asset }, { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) { return write(request, false); }
export async function DELETE(request: Request) { return write(request, true); }
