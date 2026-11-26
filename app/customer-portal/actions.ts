"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { portalDesignSchema } from "@/lib/portal-design";
import { addPortalTheme, getPortalDesign, managePortalTheme, savePortalDesign } from "@/lib/data/portal-design";
import { portalLibraryThemes, portalThemeIdSchema, portalThemeNameSchema } from "@/lib/portal-themes";

export async function updatePortalDesign(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = z.object({ design: portalDesignSchema, revision: z.number().int().min(0), publish: z.boolean(), themeId: portalThemeIdSchema.default("current"), themeName: portalThemeNameSchema.optional() }).strict().safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your portal settings." };
  try {
    const saved = await withWorkspaceViewer(viewer, () => savePortalDesign(parsed.data.design, parsed.data.revision, parsed.data.publish, viewer.id, parsed.data.themeId, parsed.data.themeName));
    revalidatePath("/customer-portal", "layout");
    return { saved };
  } catch (error) { return { error: error instanceof Error ? error.message : "Unable to save your portal." }; }
}

export async function createPortalTheme(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = z.object({ revision: z.number().int().min(0), templateId: z.string().max(40).optional(), sourceId: portalThemeIdSchema.optional() }).strict()
    .refine(value => Boolean(value.templateId) !== Boolean(value.sourceId), "Choose a template or an existing theme.").safeParse(input);
  if (!parsed.success) return { error: "Choose a template or an existing theme." };
  try {
    const result = await withWorkspaceViewer(viewer, () => addPortalTheme(parsed.data.revision, viewer.id, parsed.data, viewer.workspaceName));
    revalidatePath("/customer-portal", "layout");
    return result;
  } catch (error) { return { error: error instanceof Error ? error.message : "Unable to add this theme." }; }
}

export async function publishPortalTheme(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const parsed = z.object({ themeId: portalThemeIdSchema, revision: z.number().int().min(0) }).strict().safeParse(input);
  if (!parsed.success) return { error: "Choose a theme from your library." };
  try {
    const saved = await withWorkspaceViewer(viewer, async () => {
      const view = await getPortalDesign();
      const theme = portalLibraryThemes(view).find(item => item.id === parsed.data.themeId);
      if (!theme) throw new Error("This theme is no longer in your library.");
      return savePortalDesign(theme.design, parsed.data.revision, true, viewer.id, theme.id, theme.name);
    });
    revalidatePath("/customer-portal", "layout");
    return { saved };
  } catch (error) { return { error: error instanceof Error ? error.message : "Unable to publish this theme." }; }
}

export async function changePortalTheme(input: unknown) {
  const viewer = await requireWorkspaceMember(["admin"]);
  const common = { themeId: portalThemeIdSchema, revision: z.number().int().min(0) };
  const parsed = z.discriminatedUnion("action", [
    z.object({ ...common, action: z.literal("rename"), name: portalThemeNameSchema }).strict(),
    z.object({ ...common, action: z.literal("remove") }).strict(),
    z.object({ ...common, action: z.literal("restore") }).strict(),
  ]).safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your theme settings." };
  try {
    const saved = await withWorkspaceViewer(viewer, () => managePortalTheme(parsed.data.revision, viewer.id, parsed.data));
    revalidatePath("/customer-portal", "layout");
    return { saved };
  } catch (error) { return { error: error instanceof Error ? error.message : "Unable to update this theme." }; }
}
