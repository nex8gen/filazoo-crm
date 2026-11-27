import type { PortalDesign, PortalDesignView, PortalSavedTheme } from "./portal-design.ts";
import { defaultPortalDesign } from "./portal-design-defaults.ts";
import { createWebsiteSection, portalWebsiteDesign } from "./portal-website-design.ts";

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
  const website = portalWebsiteDesign({ brandName });
  const home = website.pages[0];
  const hero = home.sections[0];
  // Starting layouts use editable, factual copy instead of invented testimonials or business metrics.
  if (id === "forma") {
    hero.alignment = "center"; hero.height = 560; hero.title = `Build your next project with ${brandName}`;
    home.sections.splice(1, 0, { ...createWebsiteSection("text", "approach"), title: "From first conversation to your next order", body: "Talk to our team about your requirements and keep your order details in one place.", alignment: "center" });
  } else if (id === "bloom") {
    hero.alignment = "center"; hero.height = 440; hero.title = `A warm welcome to ${brandName}`;
    home.sections[1].style = { paddingTop: 48, paddingBottom: 48, headingSize: 32 };
  } else if (id === "noir") {
    hero.height = 400; hero.title = `${brandName}. Let’s get to work.`;
    home.sections = [hero, home.sections[2]];
    website.header = { sticky: true };
  } else if (id === "clay") {
    hero.height = 520; hero.title = `Good business starts with a conversation`;
    home.sections.splice(1, 0, { ...createWebsiteSection("text", "introduction"), title: `Meet ${brandName}`, body: "Learn about our business, share what you need, and connect with our team." });
    home.sections[2].style = { paddingTop: 40, paddingBottom: 40, headingSize: 28 };
  } else if (id === "ocean") {
    hero.height = 420; hero.alignment = "center";
    home.sections[1].alignment = "center";
    website.header = { sticky: true };
  }
  return { ...defaultPortalDesign(brandName), theme: template.theme, accent: template.accent, website,
    heading: "", welcome: "",
    sections: defaultPortalDesign().sections.map(section => ({ ...section, title: section.type === "tracking" ? "Your orders" : section.type === "messages" ? "Messages" : section.type === "invoice" ? "Invoices" : section.title })),
  };
}
/** Older saved portals become a library theme without changing their published design. */
export function portalLibraryThemes(view: PortalDesignView): PortalSavedTheme[] {
  const themes = view.themes?.length ? view.themes : [{ id: "current", name: "My website", design: view.draft, updatedAt: view.updatedAt }];
  return themes.map(theme => theme.name === "My customer portal" ? { ...theme, name: "My website" } : theme);
}
export function livePortalThemeId(view: PortalDesignView) {
  return view.published ? view.liveThemeId ?? "current" : null;
}
export function portalThemeHasChanges(view: PortalDesignView, themeId: string) {
  const theme = portalLibraryThemes(view).find(item => item.id === themeId);
  return Boolean(theme && (livePortalThemeId(view) !== themeId || JSON.stringify(theme.design) !== JSON.stringify(view.published)));
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
