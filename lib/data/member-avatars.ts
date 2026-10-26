import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_PRESETS, ownAvatarPath, PROFILE_AVATAR_BUCKET } from "../profile-avatar.ts";

// Call after authorizing the containing workspace data. Auth metadata and
// private Storage paths stay on the server; callers receive display URLs only.
export async function resolveMemberAvatars(admin: Pick<SupabaseClient, "auth" | "storage">, userIds: readonly string[]): Promise<Map<string, string>> {
  const avatars = new Map<string, string>();
  const ids = [...new Set(userIds.filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 8) {
    await Promise.allSettled(ids.slice(offset, offset + 8).map(async (id) => {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data.user) return;
      const metadata = data.user.user_metadata ?? {};
      avatars.set(id, (AVATAR_PRESETS.find((preset) => preset.id === metadata.avatar_preset) ?? AVATAR_PRESETS[0]).image);
      const path = ownAvatarPath(id, metadata.avatar_path);
      if (path) {
        const { data: photo } = await admin.storage.from(PROFILE_AVATAR_BUCKET).createSignedUrl(path, 3600);
        if (photo?.signedUrl) avatars.set(id, photo.signedUrl);
      }
    }));
  }
  return avatars;
}
