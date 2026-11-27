import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveMemberAvatars } from "@/lib/data/cached-member-avatars";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { z } from "zod";

export async function GET(request: Request) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("memberId"));
  if (!id.success) return new Response(null, { status: 400 });
  return withWorkspaceViewer(viewer, async () => {
    const { data, error } = await createSupabaseAdmin().from("workspace_members").select("user_id").eq("user_id", id.data).not("activated_at", "is", null).maybeSingle();
    if (error || !data) return new Response(null, { status: 404 });
    const url = (await resolveMemberAvatars([id.data])).get(id.data);
    return url ? new Response(null, { status: 307, headers: { Location: url, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } }) : new Response(null, { status: 404 });
  });
}
