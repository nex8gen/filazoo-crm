import { getWorkspaceViewer } from "@/lib/auth";
import { ownAvatarPath, PROFILE_AVATAR_BUCKET } from "@/lib/profile-avatar";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return new Response(null, { status: 401 });
  const path = ownAvatarPath(viewer.id, viewer.avatarPath);
  if (!path) return new Response(null, { status: 404 });
  const { data, error } = await createSupabaseAdmin().storage.from(PROFILE_AVATAR_BUCKET).download(path);
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(data, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
