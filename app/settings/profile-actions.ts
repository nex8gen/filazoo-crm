"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { isAvatarPreset, isWebp, ownAvatarPath, PROFILE_AVATAR_BUCKET, PROFILE_AVATAR_MAX_BYTES } from "@/lib/profile-avatar";
import { createClient } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export async function saveProfileAvatar(formData: FormData): Promise<{ error?: string; success?: string }> {
  const viewer = await requireWorkspaceMember();
  const preset = formData.get("preset");
  if (!isAvatarPreset(preset)) return { error: "Choose a default avatar." };
  const photo = formData.get("photo");
  const removePhoto = formData.get("removePhoto") === "true";
  const admin = createSupabaseAdmin();
  let path = ownAvatarPath(viewer.id, viewer.avatarPath);
  const previousPath = path;

  if (photo instanceof File && photo.size > 0) {
    if (photo.size > PROFILE_AVATAR_MAX_BYTES || photo.type !== "image/webp") return { error: "Choose a JPG, PNG, or WebP photo using the upload button." };
    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!isWebp(bytes)) return { error: "This image could not be read. Choose another photo." };
    const { data: bucket, error: bucketError } = await admin.storage.getBucket(PROFILE_AVATAR_BUCKET);
    if (!bucket) {
      if (bucketError && !["400", "404"].includes(String(bucketError.statusCode))) return { error: "Photo storage is unavailable. Please try again." };
      const { error } = await admin.storage.createBucket(PROFILE_AVATAR_BUCKET, { public: false, allowedMimeTypes: ["image/webp"], fileSizeLimit: PROFILE_AVATAR_MAX_BYTES });
      // Another upload may have created the bucket while this request was running.
      if (error && !(await admin.storage.getBucket(PROFILE_AVATAR_BUCKET)).data) return { error: "Photo storage could not be prepared. Please try again." };
    }
    path = `${viewer.id}/${crypto.randomUUID()}.webp`;
    const { error } = await admin.storage.from(PROFILE_AVATAR_BUCKET).upload(path, bytes, { contentType: "image/webp", upsert: false });
    if (error) return { error: "Your photo could not be uploaded. Please try again." };
  } else if (removePhoto) {
    path = null;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { avatar_path: path, avatar_preset: preset } });
  if (error) {
    if (path && path !== previousPath) await admin.storage.from(PROFILE_AVATAR_BUCKET).remove([path]);
    return { error: "Your avatar could not be saved. Please try again." };
  }
  if (previousPath && previousPath !== path) await admin.storage.from(PROFILE_AVATAR_BUCKET).remove([previousPath]);
  // updateUser saves metadata but keeps the old access token. Refresh its claims
  // so the server-rendered sidebar can display the new avatar immediately.
  const { error: refreshError } = await supabase.auth.refreshSession();
  revalidatePath("/", "layout");
  if (refreshError) return { error: "Your avatar was saved. Sign in again to display the update." };
  return { success: "Profile photo updated." };
}
