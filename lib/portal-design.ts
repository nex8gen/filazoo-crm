import { z } from "zod";
import type { PortalInvoice, PortalMessage, PortalShipment } from "./customer-portal.ts";
import { invoiceLabel } from "./invoices.ts";

export const portalSectionTypes = ["overview", "tracking", "invoice", "messages", "content"] as const;
export const portalSectionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  type: z.enum(portalSectionTypes),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(2000),
  enabled: z.boolean(),
}).strict();
export const websiteColorSchema = z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export const websiteLinkSchema = z.string().max(2000).refine(value => {
  if (!value || /^(home|account|pages\/[A-Za-z0-9_-]{1,64}|#[A-Za-z][A-Za-z0-9_-]{0,63})$/.test(value)) return true;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^tel:\+?[0-9 ()-]{3,30}$/.test(value)) return true;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}, "Use a website page, an HTTPS URL, an email link, or a phone link.");
export const websiteBlockTypes = ["heading", "text", "image", "button", "group", "card", "slide", "faq", "testimonial", "stat", "icon", "video", "divider", "spacer"] as const;
export const websiteBlockStyleSchema = z.object({
  alignment: z.enum(["inherit", "left", "center", "right"]).optional(),
  fontSize: z.number().int().min(10).max(96).optional(),
  fontWeight: z.enum(["400", "500", "600", "700"]).optional(),
  color: websiteColorSchema.optional(), background: websiteColorSchema.optional(),
  padding: z.number().int().min(0).max(80).optional(), gap: z.number().int().min(0).max(64).optional(),
  radius: z.number().int().min(0).max(48).optional(), columns: z.number().int().min(1).max(4).optional(),
  mobileColumns: z.number().int().min(1).max(2).optional(),
  height: z.number().int().min(0).max(600).optional(),
  width: z.enum(["auto", "full"]).optional(),
  buttonStyle: z.enum(["solid", "outline", "text"]).optional(),
  imageAspect: z.enum(["natural", "square", "landscape", "portrait"]).optional(),
  imageFit: z.enum(["cover", "contain"]).optional(),
  desktopVisible: z.boolean().optional(), mobileVisible: z.boolean().optional(),
}).strict();
const websiteBlockFields = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), type: z.enum(websiteBlockTypes), enabled: z.boolean(),
  title: z.string().trim().max(120), text: z.string().trim().max(4000),
  imageUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2000)]),
  alt: z.string().trim().max(200), link: websiteLinkSchema,
  icon: z.enum(["building", "package", "truck", "shield", "check", "star", "mail", "globe"]).optional(),
  rating: z.number().int().min(0).max(5).optional(), newTab: z.boolean().optional(),
  headingLevel: z.enum(["h1", "h2", "h3"]).optional(),
  binding: z.enum(["title", "body", "image", "button", "eyebrow", "email", "page-title", "page-link"]).optional(),
  contentOverride: z.boolean().optional(),
  sourcePageId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  style: websiteBlockStyleSchema.optional(),
};
const websiteLeafBlockSchema = z.object(websiteBlockFields).strict();
const websiteChildBlockSchema = websiteLeafBlockSchema.extend({ children: z.array(websiteLeafBlockSchema).max(24).optional() });
export const portalWebsiteBlockSchema = websiteLeafBlockSchema.extend({ children: z.array(websiteChildBlockSchema).max(24).optional() });
export const websiteSectionStyleSchema = z.object({
  columns: z.number().int().min(1).max(4).optional(), mobileColumns: z.number().int().min(1).max(2).optional(),
  gap: z.number().int().min(0).max(64).optional(),
  paddingTop: z.number().int().min(0).max(160).optional(), paddingBottom: z.number().int().min(0).max(160).optional(),
  paddingX: z.number().int().min(0).max(120).optional(), maxWidth: z.number().int().min(320).max(1600).optional(),
  background: websiteColorSchema.optional(), color: websiteColorSchema.optional(),
  headingSize: z.number().int().min(20).max(96).optional(), textSize: z.number().int().min(10).max(32).optional(),
  mobileHeight: z.number().int().min(160).max(900).optional(),
  imagePosition: z.enum(["left", "right"]).optional(), overlay: z.number().int().min(0).max(80).optional(),
  contentPosition: z.enum(["start", "center", "end"]).optional(),
  desktopVisible: z.boolean().optional(), mobileVisible: z.boolean().optional(),
  autoPlay: z.boolean().optional(), slideInterval: z.number().int().min(3).max(15).optional(),
}).strict();
export const portalWebsiteSectionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  type: z.enum(["hero", "text", "image", "contact", "links", "columns", "gallery", "faq", "testimonials", "statistics", "banner", "slideshow", "logos", "products", "video", "spacer"]),
  name: z.string().trim().max(120).optional(),
  title: z.string().trim().max(120),
  body: z.string().trim().max(4000),
  enabled: z.boolean(),
  imageUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2000)]),
  buttonLabel: z.string().trim().max(60),
  buttonPage: z.string().regex(/^(home|account|pages\/[A-Za-z0-9_-]{1,64})$/),
  height: z.number().int().min(160).max(900),
  alignment: z.enum(["left", "center"]),
  blocks: z.array(portalWebsiteBlockSchema).max(60).optional(),
  style: websiteSectionStyleSchema.optional(),
}).strict().superRefine((section, ctx) => {
  const ids = new Set<string>(); let count = 0;
  const visit = (blocks: z.infer<typeof portalWebsiteBlockSchema>[]) => {
    for (const block of blocks) {
      count++;
      if (ids.has(block.id)) ctx.addIssue({ code: "custom", path: ["blocks"], message: "Element IDs must be unique within a section." });
      ids.add(block.id);
      if (block.children?.length && !["group", "card", "slide", "faq"].includes(block.type)) ctx.addIssue({ code: "custom", path: ["blocks"], message: "Only containers and FAQ items can hold nested elements." });
      if (block.children) visit(block.children);
    }
  };
  visit(section.blocks ?? []);
  if (count > 60) ctx.addIssue({ code: "custom", path: ["blocks"], message: "A section supports up to 60 elements." });
});
export const portalWebsitePageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).refine(id => id !== "account", "This page address is reserved."),
  title: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  sections: z.array(portalWebsiteSectionSchema).max(20).refine(sections => new Set(sections.map(section => section.id)).size === sections.length, "Section IDs must be unique."),
}).strict();
export const portalWebsiteSchema = z.object({
  pages: z.array(portalWebsitePageSchema).min(1).max(12),
  header: z.object({
    enabled: z.boolean().optional(), showBrand: z.boolean().optional(), showLogo: z.boolean().optional(),
    showNavigation: z.boolean().optional(), showAccount: z.boolean().optional(),
    accountLabel: z.string().trim().max(60).optional(), logoWidth: z.number().int().min(40).max(240).optional(),
    sticky: z.boolean().optional(), background: websiteColorSchema.optional(), color: websiteColorSchema.optional(),
    padding: z.number().int().min(8).max(64).optional(),
  }).strict().optional(),
  navigation: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), label: z.string().trim().min(1).max(60), link: websiteLinkSchema, enabled: z.boolean() }).strict()).max(16).refine(items => new Set(items.map(item => item.id)).size === items.length, "Navigation IDs must be unique.").optional(),
  footer: z.object({
    enabled: z.boolean().optional(), showBrand: z.boolean().optional(), showEmail: z.boolean().optional(), showNavigation: z.boolean().optional(),
    background: websiteColorSchema.optional(), color: websiteColorSchema.optional(), padding: z.number().int().min(8).max(100).optional(),
  }).strict().optional(),
}).strict().superRefine((website, ctx) => {
  if (new Set(website.pages.map(page => page.id)).size !== website.pages.length)
    ctx.addIssue({ code: "custom", path: ["pages"], message: "Website page IDs must be unique." });
  if (website.pages.filter(page => page.id === "home" && page.enabled).length !== 1)
    ctx.addIssue({ code: "custom", path: ["pages"], message: "Keep one visible website home page." });
  const count = (blocks: z.infer<typeof portalWebsiteBlockSchema>[]): number => blocks.reduce((total, block) => total + 1 + count(block.children ?? []), 0);
  if (website.pages.reduce((total, page) => total + page.sections.reduce((sum, section) => sum + count(section.blocks ?? []), 0), 0) > 1000)
    ctx.addIssue({ code: "custom", path: ["pages"], message: "A website supports up to 1,000 elements." });
});
export const portalDesignSchema = z.object({
  brandName: z.string().trim().min(1).max(80),
  logoUrl: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(2000)]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a six-digit hex color."),
  theme: z.enum(["minimal", "soft", "bold"]),
  layout: z.enum(["columns", "stacked"]),
  heading: z.string().trim().max(120),
  welcome: z.string().trim().max(300),
  announcement: z.string().trim().max(300),
  footer: z.string().trim().max(200),
  supportEmail: z.union([z.literal(""), z.email().max(254)]),
  features: z.object({ downloadInvoice: z.boolean(), sendMessages: z.boolean(), languageSwitcher: z.boolean() }).strict(),
  sections: z.array(portalSectionSchema).min(1).max(12),
  website: portalWebsiteSchema.optional(),
}).strict().superRefine((design, ctx) => {
  if (JSON.stringify(design).length > 300000)
    ctx.addIssue({ code: "custom", path: ["website"], message: "This theme is too large. Shorten its content or use fewer sections." });
  if (new Set(design.sections.map(s => s.id)).size !== design.sections.length)
    ctx.addIssue({ code: "custom", path: ["sections"], message: "Section IDs must be unique." });
  for (const type of portalSectionTypes.filter(t => t !== "content")) {
    if (design.sections.filter(s => s.type === type).length !== 1)
      ctx.addIssue({ code: "custom", path: ["sections"], message: `Keep exactly one ${type} section.` });
  }
});
export type PortalDesign = z.infer<typeof portalDesignSchema>;
export type PortalSection = z.infer<typeof portalSectionSchema>;
export type PortalWebsite = z.infer<typeof portalWebsiteSchema>;
export type PortalWebsitePage = z.infer<typeof portalWebsitePageSchema>;
export type PortalWebsiteSection = z.infer<typeof portalWebsiteSectionSchema>;
export type PortalWebsiteBlock = z.infer<typeof portalWebsiteBlockSchema>;
export type WebsiteBlockStyle = z.infer<typeof websiteBlockStyleSchema>;
export type WebsiteSectionStyle = z.infer<typeof websiteSectionStyleSchema>;
export type PortalSavedTheme = { id: string; name: string; design: PortalDesign; updatedAt: string | null };
export type PortalDesignView = { draft: PortalDesign; published: PortalDesign | null; revision: number; updatedAt: string | null; publishedAt: string | null; themes?: PortalSavedTheme[]; liveThemeId?: string | null };

export { defaultPortalDesign, portalAccentForeground } from "./portal-design-defaults.ts";

export function portalSectionEnabled(design: PortalDesign, type: PortalSection["type"]) {
  return design.sections.some(section => section.type === type && section.enabled);
}
export function portalFeatureAllowed(design: PortalDesign, feature: "downloadInvoice" | "sendMessages") {
  return design.features[feature] && portalSectionEnabled(design, feature === "downloadInvoice" ? "invoice" : "messages");
}
export function canManagePortal(role: string) { return role === "admin"; }

type PortalSource = { invoice: PortalInvoice; email: string; needsPassword: boolean; messages: PortalMessage[]; shipment: PortalShipment | null; order: { reference: string; status: string; deliveryDate: string } | null };
/** Apply visibility before serializing. Hidden CRM data never reaches the customer browser. */
export function projectPortalData(source: PortalSource, design: PortalDesign) {
  const invoice = source.invoice;
  return {
    design, email: source.email, needsPassword: source.needsPassword,
    customerName: invoice.document.customerName, label: invoiceLabel(invoice), reference: invoice.document.reference,
    invoice: portalSectionEnabled(design, "invoice") ? invoice : null,
    overview: portalSectionEnabled(design, "overview") ? { status: invoice.status, paid_minor: invoice.paid_minor, total_minor: invoice.total_minor, dueDate: invoice.document.dueDate, currency: invoice.document.currency } : null,
    messages: portalSectionEnabled(design, "messages") ? source.messages : [],
    shipment: portalSectionEnabled(design, "tracking") ? source.shipment : null,
    order: portalSectionEnabled(design, "tracking") ? source.order : null,
  };
}
