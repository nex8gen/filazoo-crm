import { requireWorkspaceMember } from "@/lib/auth";
import { importRemoteEmailImage } from "@/lib/remote-email-image";
import { z } from "zod";

export async function POST(request: Request) {
  await requireWorkspaceMember();
  const parsed = z.object({ url: z.string().url().max(12000) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Use a valid image URL." }, { status: 400 });
  try { return Response.json({ dataUrl: await importRemoteEmailImage(parsed.data.url) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to copy this image." }, { status: 400 }); }
}
