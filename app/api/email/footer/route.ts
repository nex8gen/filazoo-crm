import { requireWorkspaceMember } from "@/lib/auth";
import { getUserEmailFooter, saveUserEmailFooter } from "@/lib/data/email-footers";
import { z } from "zod";

export async function GET() {
  const viewer = await requireWorkspaceMember();
  try { return Response.json({ footer: await getUserEmailFooter(viewer.id) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load your email footer." }, { status: 500 }); }
}

export async function PUT(request: Request) {
  const viewer = await requireWorkspaceMember();
  const parsed = z.object({ html: z.string().max(8_000_000) }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid footer. Footer images must total 5 MB or less." }, { status: 400 });
  try { return Response.json({ footer: await saveUserEmailFooter(viewer.id, parsed.data.html) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to save your email footer." }, { status: 400 }); }
}
