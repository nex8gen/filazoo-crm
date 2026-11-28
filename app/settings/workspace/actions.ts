"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { workspaceNameSchema } from "@/lib/workspaces";
import { businessHoursSchema, timeZoneSchema, workspaceLogoMaxBytes, workspaceWebsiteSchema } from "@/lib/workspace-settings";

export type WorkspaceSettingsState = { error?: string; success?: string } | undefined;

export async function saveWorkspaceDetails(_state: WorkspaceSettingsState, formData: FormData): Promise<WorkspaceSettingsState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.workspaceId === "legacy") return { error: "Workspace management is unavailable." };
  const name = workspaceNameSchema.safeParse(formData.get("name"));
  const website = workspaceWebsiteSchema.safeParse(formData.get("website"));
  if (!name.success) return { error: name.error.issues[0].message };
  if (!website.success) return { error: website.error.issues[0].message };
  const updates: { name: string; website: string; updated_at: string; logo_data_url?: string | null } = {
    name: name.data, website: website.data, updated_at: new Date().toISOString(),
  };
  const logo = formData.get("logo");
  if (logo instanceof File && logo.size) {
    if (logo.size > workspaceLogoMaxBytes || !["image/png", "image/jpeg", "image/webp"].includes(logo.type)) {
      return { error: "Choose a PNG, JPG, or WebP logo smaller than 2 MB." };
    }
    try {
      const sharp = (await import("sharp")).default;
      const image = sharp(Buffer.from(await logo.arrayBuffer()), { limitInputPixels: 16_000_000, animated: false });
      const metadata = await image.metadata();
      if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) throw new Error("Unsupported image");
      const bytes = await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
      if (bytes.length > 140_000) throw new Error("Image too large");
      updates.logo_data_url = `data:image/webp;base64,${bytes.toString("base64")}`;
    } catch { return { error: "This logo could not be read. Choose another image." }; }
  } else if (formData.get("removeLogo") === "true") updates.logo_data_url = null;
  const { data, error } = await createSupabaseControl(viewer.id).from("workspaces").update(updates).eq("id", viewer.workspaceId).select("id").single();
  if (error || !data) return { error: "Unable to save workspace details. Please try again." };
  revalidatePath("/", "layout");
  return { success: "Workspace details saved." };
}

export async function saveWorkspaceSchedule(_state: WorkspaceSettingsState, formData: FormData): Promise<WorkspaceSettingsState> {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.workspaceId === "legacy") return { error: "Workspace management is unavailable." };
  const timezone = timeZoneSchema.safeParse(formData.get("timezone"));
  const hours = businessHoursSchema.safeParse({ days: formData.getAll("days").map(Number), start: formData.get("start"), end: formData.get("end") });
  if (!timezone.success) return { error: timezone.error.issues[0].message };
  if (!hours.success) return { error: hours.error.issues[0].message };
  const { data, error } = await createSupabaseControl(viewer.id).from("workspaces").update({
    timezone: timezone.data, business_hours: hours.data, updated_at: new Date().toISOString(),
  }).eq("id", viewer.workspaceId).select("id").single();
  if (error || !data) return { error: "Unable to save workspace hours. Please try again." };
  revalidatePath("/", "layout");
  return { success: "Timezone and business hours saved." };
}
