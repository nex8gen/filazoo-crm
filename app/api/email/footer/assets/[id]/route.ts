import { requireWorkspaceMember } from "@/lib/auth";
import { loadFooterImage } from "@/lib/data/email-footers";

export async function GET(_request: Request, context: RouteContext<"/api/email/footer/assets/[id]">) {
  const viewer = await requireWorkspaceMember();
  try {
    const { id } = await context.params;
    const image = await loadFooterImage(viewer.id, id);
    return new Response(image, { headers: { "Content-Type": image.type, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("Footer image not found.", { status: 404 }); }
}
