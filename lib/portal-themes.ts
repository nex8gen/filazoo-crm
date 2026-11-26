import { z } from "zod";
import { portalDesignSchema } from "./portal-design.ts";

export const portalThemeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const portalThemeNameSchema = z.string().trim().min(1, "Give this theme a name.").max(80, "Use 80 characters or fewer for the theme name.");
export const portalSavedThemeSchema = z.object({ id: portalThemeIdSchema, name: portalThemeNameSchema, design: portalDesignSchema, updatedAt: z.string().nullable() }).strict();
export const portalThemeListSchema = z.array(portalSavedThemeSchema).max(20).refine(themes => new Set(themes.map(theme => theme.id)).size === themes.length, "Theme IDs must be unique.");

export { portalTemplates, createPortalTemplate, portalLibraryThemes, livePortalThemeId, portalThemeHasChanges, portalPages, portalPageHref } from "./portal-theme-model.ts";
export type { PortalPage } from "./portal-theme-model.ts";
