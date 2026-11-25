import { z } from "zod";
import type { PortalInvoice, PortalMessage, PortalShipment } from "./customer-portal.ts";
import { invoiceLabel } from "./invoices.ts";
import { sanitizePortalWebsite } from "./portal-website.ts";

export const portalSectionTypes = ["overview", "tracking", "invoice", "messages", "content"] as const;
export const portalSectionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  type: z.enum(portalSectionTypes),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().max(2000),
  enabled: z.boolean(),
  website: z.object({ html: z.string().max(60000), css: z.string().max(20000) }).strict().transform(sanitizePortalWebsite).optional(),
}).strict();
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
}).strict().superRefine((design, ctx) => {
  if (new Set(design.sections.map(s => s.id)).size !== design.sections.length)
    ctx.addIssue({ code: "custom", path: ["sections"], message: "Section IDs must be unique." });
  for (const type of portalSectionTypes.filter(t => t !== "content")) {
    if (design.sections.filter(s => s.type === type).length !== 1)
      ctx.addIssue({ code: "custom", path: ["sections"], message: `Keep exactly one ${type} section.` });
  }
});
export type PortalDesign = z.infer<typeof portalDesignSchema>;
export type PortalSection = z.infer<typeof portalSectionSchema>;
export type PortalSavedTheme = { id: string; name: string; design: PortalDesign; updatedAt: string | null };
export type PortalDesignView = { draft: PortalDesign; published: PortalDesign | null; revision: number; updatedAt: string | null; publishedAt: string | null; themes?: PortalSavedTheme[]; liveThemeId?: string | null };

export function defaultPortalDesign(brandName = "Filazoo"): PortalDesign {
  return {
    brandName, logoUrl: "", accent: "#25865b", theme: "minimal", layout: "columns",
    heading: "", welcome: "",
    announcement: "", footer: "", supportEmail: "",
    features: { downloadInvoice: true, sendMessages: true, languageSwitcher: true },
    sections: [
      { id: "overview", type: "overview", title: "Payment overview", body: "", enabled: true },
      { id: "tracking", type: "tracking", title: "Order tracking", body: "", enabled: true },
      { id: "invoice", type: "invoice", title: "Invoices", body: "", enabled: true },
      { id: "messages", type: "messages", title: "Messages", body: "", enabled: true },
    ],
  };
}
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

export function portalAccentForeground(color: string) {
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? "#111827" : "#ffffff";
}
