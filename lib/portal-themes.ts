import { z } from "zod";
import { defaultPortalDesign, portalDesignSchema, type PortalDesign, type PortalDesignView, type PortalSavedTheme } from "./portal-design.ts";

export const portalThemeIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const portalSavedThemeSchema = z.object({ id: portalThemeIdSchema, name: z.string().trim().min(1).max(80), design: portalDesignSchema, updatedAt: z.string().nullable() }).strict();
export const portalThemeListSchema = z.array(portalSavedThemeSchema).max(20).refine(themes => new Set(themes.map(theme => theme.id)).size === themes.length, "Theme IDs must be unique.");
export const portalTemplates = [
  { id: "studio", name: "Studio", description: "A calm, focused home for every customer.", theme: "minimal", accent: "#16776b", tag: "Popular" },
  { id: "forma", name: "Forma", description: "Confident lines. A little more personality.", theme: "bold", accent: "#5261d8", tag: "New" },
  { id: "bloom", name: "Bloom", description: "Soft colors and a warm welcome.", theme: "soft", accent: "#8867ac", tag: "" },
  { id: "noir", name: "Noir", description: "An understated, premium customer space.", theme: "bold", accent: "#333b49", tag: "" },
  { id: "clay", name: "Clay", description: "Earthy tones. Thoughtful, human details.", theme: "soft", accent: "#ab644d", tag: "" },
  { id: "ocean", name: "Ocean", description: "Fresh, spacious, and easy to navigate.", theme: "minimal", accent: "#2879a5", tag: "" },
] as const;
export function createPortalTemplate(id: string, brandName = "Your brand"): PortalDesign {
  const template = portalTemplates.find(item => item.id === id);
  if (!template) throw new Error("Choose a template from the theme library.");
  return { ...defaultPortalDesign(brandName), theme: template.theme, accent: template.accent,
    heading: "", welcome: "",
    sections: defaultPortalDesign().sections.map(section => ({ ...section, title: section.type === "tracking" ? "Your orders" : section.type === "messages" ? "Messages" : section.type === "invoice" ? "Invoices" : section.title })),
  };
}
/** Older saved portals become a library theme without changing their published design. */
export function portalLibraryThemes(view: PortalDesignView): PortalSavedTheme[] {
  return view.themes?.length ? view.themes : [{ id: "current", name: "My customer portal", design: view.draft, updatedAt: view.updatedAt }];
}
export function livePortalThemeId(view: PortalDesignView) {
  return view.liveThemeId ?? (view.published ? "current" : null);
}
export type PortalPage = { id: string; label: string; type: "home" | "tracking" | "invoice" | "messages" | "content"; sectionId?: string; enabled: boolean };
export function portalPages(design: PortalDesign, includeHidden = false): PortalPage[] {
  const pages: PortalPage[] = [{ id: "home", label: "Home", type: "home", sectionId: design.sections.find(s => s.type === "overview")?.id, enabled: true }];
  for (const section of design.sections) {
    if (section.type === "overview") continue;
    pages.push({ id: section.type === "tracking" ? "orders" : section.type === "invoice" ? "billing" : section.type === "messages" ? "messages" : `pages/${section.id}`,
      label: section.type === "tracking" ? "Orders" : section.type === "invoice" ? "Invoices" : section.type === "messages" ? "Messages" : section.title,
      type: section.type, sectionId: section.id, enabled: section.enabled });
  }
  return includeHidden ? pages : pages.filter(page => page.enabled);
}
export function portalPageHref(invoiceId: string, page: string) {
  return `/customer/invoices/${encodeURIComponent(invoiceId)}${page === "home" ? "" : `/${page.split("/").map(encodeURIComponent).join("/")}`}`;
}
