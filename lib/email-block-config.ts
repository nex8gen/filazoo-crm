import { z } from "zod";
import type { EmailBlock } from "./email-design.ts";

export const emailFonts = ["Arial", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Times New Roman", "Helvetica", "Lucida Sans", "Courier New", "Manrope"] as const;
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const clearColor = z.union([color, z.literal("transparent")]);
const px = z.number().int().min(0).max(80);
export const emailInsetsSchema = z.object({ top: px, right: px, bottom: px, left: px });
export type EmailInsets = z.infer<typeof emailInsetsSchema>;
export const emailBorderSchema = z.object({ style: z.enum(["none", "solid", "dashed", "dotted", "double"]), width: z.number().int().min(0).max(20), color });
export const emailPresentationSchema = z.object({
  padding: emailInsetsSchema.optional(), areaPadding: emailInsetsSchema.optional(), areaBackground: clearColor.optional(), blockBackground: clearColor.optional(), border: emailBorderSchema.optional(),
  letterSpacing: z.number().min(-5).max(30).optional(), strike: z.boolean().optional(), fullWidthMobile: z.boolean().optional(), showDesktop: z.boolean().optional(), showMobile: z.boolean().optional(),
  shadowColor: color.optional(), shadowStrength: z.enum(["small", "medium", "large"]).optional(), lineStyle: z.enum(["solid", "dashed", "dotted", "double"]).optional(),
  backgroundImage: z.string().max(2000).optional(), minHeight: z.number().int().min(0).max(1200).optional(), lineHeight: z.number().min(0.8).max(3).optional(),
  image: z.object({ autoWidth: z.boolean().optional(), height: z.number().int().min(1).max(1200).nullable().optional(), lockAspect: z.boolean().optional(), fill: z.boolean().optional(), fillMobile: z.boolean().optional() }).optional(),
  button: z.object({ fullWidth: z.boolean().optional(), padding: emailInsetsSchema.optional() }).optional(),
  columns: z.object({ widths: z.array(z.number().min(1).max(99)).min(2).max(3).optional(), gap: z.number().int().min(0).max(120).optional(), stack: z.enum(["left", "right", "none"]).optional() }).optional(),
  header: z.object({ layout: z.enum(["stacked", "inline", "reverse"]).optional(), mobileLayout: z.enum(["stack", "inline", "logo-only", "links-only"]).optional(), sameMobileLogo: z.boolean().optional(), mobileSrc: z.string().max(1100000).optional(), mobileAlt: z.string().max(300).optional(), logoHref: z.string().max(2000).optional(), gap: z.number().int().min(0).max(80).optional(), linkPadding: emailInsetsSchema.optional(), verticalAlign: z.enum(["top", "middle", "bottom"]).optional(), horizontal: z.enum(["auto", "manual"]).optional(), linkGap: z.number().int().min(0).max(80).optional(), linkColor: color.optional(), linkSize: z.number().int().min(8).max(64).optional() }).optional(),
}).default({});

const textStyle = z.object({ fontFamily: z.enum(emailFonts), fontSize: z.number().int().min(8).max(64), color, bold: z.boolean(), italic: z.boolean(), underline: z.boolean(), strike: z.boolean(), letterSpacing: z.number().min(-5).max(30), paddingTop: px, paddingBottom: px });
export const emailProductCardSchema = z.object({ sku: z.string().max(200), name: z.string().max(300), imageUrl: z.string().max(1100000), description: z.string().max(12000), price: z.string().max(100), originalPrice: z.string().max(100).default(""), rating: z.number().min(0).max(5).nullable().default(null), href: z.string().max(2000) });
export const emailProductConfigSchema = z.object({
  mode: z.enum(["static", "dynamic"]).default("static"), cards: z.array(emailProductCardSchema).max(9).default([]), feed: z.object({ name: z.string().max(160), material: z.string().max(120), search: z.string().max(200), availableOnly: z.boolean(), sort: z.enum(["name", "newest", "price-low", "price-high"]), linkTemplate: z.string().max(2000).default("") }).optional(),
  start: z.number().int().min(0).max(499).default(0), perRow: z.number().int().min(1).max(3).default(3), rows: z.number().int().min(1).max(3).default(1), layout: z.enum(["grid", "image-left", "image-right"]).default("grid"), stackMobile: z.boolean().default(true), maxImageHeight: z.number().int().min(20).max(600).default(125), cardPadding: emailInsetsSchema.optional(), border: emailBorderSchema.optional(),
  showName: z.boolean().default(true), linkName: z.boolean().default(false), showPrice: z.boolean().default(true), showOriginalPrice: z.boolean().default(false), showDescription: z.boolean().default(false), showRating: z.boolean().default(false), showButton: z.boolean().default(true), buttonText: z.string().max(120).default("Shop now"), nameStyle: textStyle.optional(), priceStyle: textStyle.optional(),
  button: z.object({ fontFamily: z.enum(emailFonts), fontSize: z.number().int().min(8).max(64), color, background: clearColor, radius: z.number().int().min(0).max(40), bold: z.boolean(), italic: z.boolean(), underline: z.boolean(), strike: z.boolean(), letterSpacing: z.number().min(-5).max(30), align: z.enum(["left", "center", "right"]), padding: emailInsetsSchema, border: emailBorderSchema, shadow: z.boolean(), shadowColor: color }).optional(),
}).optional();
export type EmailProductConfig = NonNullable<z.infer<typeof emailProductConfigSchema>>;
export type EmailProductCard = z.infer<typeof emailProductCardSchema>;
export const insets = (value: number): EmailInsets => ({ top: value, right: value, bottom: value, left: value });
export const cssInsets = (value: EmailInsets) => `${value.top}px ${value.right}px ${value.bottom}px ${value.left}px`;
export const noBorder = { style: "none" as const, width: 0, color: "#000000" };
export function blockPresentation(block: EmailBlock) {
  const p = Object.fromEntries(Object.entries(block.presentation ?? {}).filter(([, value]) => value !== undefined)) as EmailBlock["presentation"];
  return { padding: insets(block.padding), areaPadding: insets(0), areaBackground: "transparent", blockBackground: block.type === "button" ? "transparent" : block.background,
    border: noBorder, letterSpacing: 0, strike: false, fullWidthMobile: false, showDesktop: true, showMobile: true, backgroundImage: "", minHeight: 0, lineHeight: 1.6, shadowColor: "#202020", shadowStrength: "medium" as "small" | "medium" | "large", lineStyle: "solid" as "solid" | "dashed" | "dotted" | "double", ...p,
    image: { autoWidth: false, height: null as number | null, lockAspect: true, fill: false, fillMobile: false, ...p.image },
    button: { fullWidth: false, padding: { top: 12, right: 24, bottom: 12, left: 24 }, ...p.button },
    columns: { widths: Array.from({ length: block.columnCount }, () => 100 / block.columnCount), gap: 8, stack: "left" as "left" | "right" | "none", ...p.columns },
    header: { layout: "stacked" as "stacked" | "inline" | "reverse", mobileLayout: "stack" as "stack" | "inline" | "logo-only" | "links-only", sameMobileLogo: true, mobileSrc: "", mobileAlt: "", logoHref: block.href, gap: 16, linkPadding: insets(10), verticalAlign: "middle" as "top" | "middle" | "bottom", horizontal: "auto" as "auto" | "manual", linkGap: 10, linkColor: block.color, linkSize: 14, ...p.header },
  };
}
export function blockInsets(block: EmailBlock, mobile = false): EmailInsets {
  const p = blockPresentation(block);
  let padding = p.padding;
  if (block.type === "social" && !block.presentation?.padding) padding = { top: block.social?.paddingY ?? block.padding, bottom: block.social?.paddingY ?? block.padding, left: block.social?.paddingX ?? block.padding, right: block.social?.paddingX ?? block.padding };
  return mobile && p.fullWidthMobile ? { ...padding, left: 0, right: 0 } : padding;
}
export function borderCss(border: typeof noBorder | z.infer<typeof emailBorderSchema>) { return border.style === "none" || !border.width ? "none" : `${border.width}px ${border.style} ${border.color}`; }
export function shadowCss(block: EmailBlock) { const p = blockPresentation(block); return block.shadow ? `${{ small: "0 1px 4px", medium: "0 3px 10px", large: "0 6px 20px" }[p.shadowStrength]} ${p.shadowColor}40` : "none"; }
export function blockTextCss(block: EmailBlock) { const p = blockPresentation(block); return `font-family:'${block.fontFamily}',Arial,sans-serif;font-size:${block.fontSize}px;color:${block.color};font-weight:${block.bold ? "bold" : "normal"};font-style:${block.italic ? "italic" : "normal"};text-decoration:${[block.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ") || "none"};letter-spacing:${p.letterSpacing}px;`; }
export function blockOuterCss(block: EmailBlock, mobile = false) { const p = blockPresentation(block); return `padding:${cssInsets(blockInsets(block, mobile))};background:${p.blockBackground};${blockTextCss(block)}text-align:${block.align};line-height:${p.lineHeight};${block.type === "button" ? "" : `border-radius:${block.radius}px;box-shadow:${shadowCss(block)};`}`; }
export function setColumnWidth(block: EmailBlock, column: number, value: number) {
  const count = block.columnCount, widths = [...blockPresentation(block).columns.widths];
  const next = Math.min(99 - (count - 2), Math.max(1, value));
  const remaining = 100 - next;
  return widths.map((_, i) => i === column ? next : remaining / (count - 1));
}
export function productConfig(block: EmailBlock): EmailProductConfig { return emailProductConfigSchema.parse(block.product ?? {})!; }
export function productTextStyle(block: EmailBlock, which: "name" | "price") { return { fontFamily: block.fontFamily, fontSize: block.fontSize, color: block.color, bold: which === "name", italic: false, underline: false, strike: false, letterSpacing: 0, paddingTop: 5, paddingBottom: 0, ...(which === "name" ? block.product?.nameStyle : block.product?.priceStyle) }; }
export function productButtonStyle(block: EmailBlock) { return { fontFamily: block.fontFamily, fontSize: 16, color: "#ffffff", background: "#121212", radius: 3, bold: true, italic: false, underline: false, strike: false, letterSpacing: 0, align: "center" as "left" | "center" | "right", padding: { top: 16, right: 24, bottom: 16, left: 24 }, border: noBorder as z.infer<typeof emailBorderSchema>, shadow: false, shadowColor: "#202020", ...block.product?.button }; }
