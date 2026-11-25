import type { PortalDesign, PortalWebsite, PortalWebsiteSection } from "./portal-design.ts";
import { publicWebsiteBlocks, resolveWebsiteBlocks } from "./portal-website-blocks.ts";

export type PublicWebsiteDesign = Pick<PortalDesign, "brandName" | "logoUrl" | "accent" | "theme" | "announcement" | "footer" | "supportEmail" | "website">;

export function publicWebsiteDesign(design: PortalDesign): PublicWebsiteDesign {
  const { brandName, logoUrl, accent, theme, announcement, footer, supportEmail, website } = design;
  return { brandName, logoUrl, accent, theme, announcement, footer, supportEmail,
    website: website ? { ...website, navigation: website.navigation?.filter(item => item.enabled), pages: website.pages.filter(page => page.enabled).map(page => ({ ...page, sections: page.sections.filter(section => section.enabled && !(section.style?.desktopVisible === false && section.style?.mobileVisible === false)).map(section => section.blocks ? {
      ...section, name: undefined, title: "", body: "", buttonLabel: "", buttonPage: "account", imageUrl: ["hero", "banner"].includes(section.type) ? section.imageUrl : "", blocks: publicWebsiteBlocks(resolveWebsiteBlocks(section.blocks, { brandName, supportEmail, pages: website.pages, pageId: page.id })),
    } : section) })) } : undefined };
}

export const websiteSectionTypes = [
  { value: "hero", label: "Hero banner" },
  { value: "text", label: "Rich text" },
  { value: "image", label: "Image with text" },
  { value: "links", label: "Page links" },
  { value: "contact", label: "Contact" },
  { value: "columns", label: "Multicolumn" }, { value: "gallery", label: "Image gallery" },
  { value: "faq", label: "FAQ / accordion" }, { value: "testimonials", label: "Customer testimonials" },
  { value: "statistics", label: "Statistics" }, { value: "banner", label: "Call to action" },
  { value: "slideshow", label: "Slideshow" }, { value: "logos", label: "Logo list" },
  { value: "products", label: "Product showcase" }, { value: "video", label: "Video" },
  { value: "spacer", label: "Spacer" },
] as const;

export function createWebsiteSection(type: PortalWebsiteSection["type"], id: string): PortalWebsiteSection {
  return { id, type, title: websiteSectionTypes.find(item => item.value === type)!.label, body: "", enabled: true,
    imageUrl: "", buttonLabel: "", buttonPage: "account", height: 480, alignment: "left" };
}

/** Saved account-only themes gain a website without altering their private account pages. */
export function portalWebsiteDesign(design: Pick<PortalDesign, "brandName" | "website">): PortalWebsite {
  return design.website ?? { pages: [
    { id: "home", title: "Home page", enabled: true, sections: [
      { ...createWebsiteSection("hero", "hero"), title: `Welcome to ${design.brandName}`, body: "Discover our business and get in touch to discuss your requirements.", buttonLabel: "Contact us", buttonPage: "pages/contact" },
      { ...createWebsiteSection("links", "explore"), title: "Explore our business" },
      { ...createWebsiteSection("contact", "contact"), title: "Let’s talk business", body: "Get in touch with our team about your next project." },
    ] },
    { id: "about", title: "About us", enabled: true, sections: [{ ...createWebsiteSection("text", "about"), title: `About ${design.brandName}` }] },
    { id: "contact", title: "Contact", enabled: true, sections: [{ ...createWebsiteSection("contact", "contact"), title: "Contact our team", body: "Tell us what you are looking for. Our team is here to help." }] },
  ] };
}

export function portalWebsiteHref(page: string) {
  return page === "home" ? "/" : page === "account" ? "/account" : `/${page}`;
}

export function portalWebsiteEditorPages(design: PortalDesign, includeHidden = false) {
  return portalWebsiteDesign(design).pages.filter(page => includeHidden || page.enabled).map(page => ({
    id: page.id === "home" ? "website/home" : `website/pages/${page.id}`, label: page.title, pageId: page.id, enabled: page.enabled,
  }));
}
