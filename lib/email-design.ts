import { z } from "zod";
import { parseDocument } from "htmlparser2";
import { emailSafeStyle, escapeEmailHtml } from "./email-markup.ts";

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const fonts = ["Arial", "Georgia", "Verdana", "Tahoma", "Trebuchet MS", "Times New Roman"] as const;
export const emailBlockTypes = ["text", "image", "button", "columns", "header", "section", "divider", "social", "spacer", "product", "coupon", "table", "quote", "video", "html"] as const;
export type EmailBlockType = typeof emailBlockTypes[number];
export const emailBlockLabels: Record<EmailBlockType, string> = { text: "Text", image: "Image", button: "Button", columns: "Columns", header: "Header bar", section: "Section", divider: "Divider", social: "Social links", spacer: "Spacer", product: "Product", coupon: "Coupon", table: "Table", quote: "Review quote", video: "Video", html: "HTML" };
const blockSchema = z.object({
  id: z.uuid(), type: z.enum(emailBlockTypes), parentId: z.uuid().nullable().default(null), column: z.number().int().min(0).max(2).default(0),
  text: z.string().max(12000).default(""), heading: z.string().max(300).default(""), html: z.string().max(30000).default(""),
  src: z.string().max(1100000).default(""), href: z.string().max(2000).default(""), alt: z.string().max(300).default(""),
  color: color.default("#202020"), background: z.union([color, z.literal("transparent")]).default("transparent"), align: z.enum(["left", "center", "right"]).default("left"),
  fontSize: z.number().int().min(8).max(64).default(16), fontFamily: z.enum(fonts).default("Arial"), bold: z.boolean().default(false), italic: z.boolean().default(false), underline: z.boolean().default(false),
  padding: z.number().int().min(0).max(80).default(20), radius: z.number().int().min(0).max(40).default(0), height: z.number().int().min(1).max(400).default(24), width: z.number().int().min(20).max(1200).default(560),
  columnCount: z.number().int().min(2).max(3).default(2), shadow: z.boolean().default(false), productSku: z.string().max(200).default(""),
  links: z.array(z.object({ label: z.string().max(80), href: z.string().max(2000) })).max(10).default([]),
  rows: z.array(z.array(z.string().max(500)).min(1).max(6)).max(20).default([]),
});
export type EmailBlock = z.infer<typeof blockSchema>;
export const emailDesignSchema = z.object({
  version: z.literal(1),
  theme: z.object({ background: color, contentBackground: color, textColor: color, accent: color, width: z.number().int().min(320).max(900), radius: z.number().int().min(0).max(40), marginTop: z.number().int().min(0).max(120), padding: z.number().int().min(0).max(80), fontFamily: z.enum(fonts), fontSize: z.number().int().min(10).max(32), backgroundImage: z.string().max(2000).default("") }),
  blocks: z.array(blockSchema).max(100),
}).superRefine((design, context) => {
  const nodes = new Map(design.blocks.map(block => [block.id, block]));
  if (nodes.size !== design.blocks.length) context.addIssue({ code: "custom", message: "Each email block needs a unique ID." });
  for (const block of design.blocks) {
    let parent = block.parentId, depth = 0;
    const visited = new Set([block.id]);
    while (parent) {
      const owner = nodes.get(parent);
      if (!owner || !["columns", "section"].includes(owner.type) || visited.has(parent) || ++depth > 4) { context.addIssue({ code: "custom", message: "Email sections must form a valid layout, up to four levels deep." }); break; }
      if (depth === 1 && block.column >= (owner.type === "columns" ? owner.columnCount : 1)) context.addIssue({ code: "custom", message: "Choose an available column for this block." });
      visited.add(parent); parent = owner.parentId;
    }
  }
  if (design.blocks.filter(block => block.src.startsWith("data:")).length > 8) context.addIssue({ code: "custom", message: "An email supports up to eight uploaded images." });
  if (JSON.stringify(design).length > 4000000) context.addIssue({ code: "custom", message: "Keep the email design under 4 MB. Use smaller images." });
});
export type EmailDesign = z.infer<typeof emailDesignSchema>;

export function newEmailBlock(type: EmailBlockType, values: Partial<EmailBlock> = {}): EmailBlock {
  const defaults: Partial<EmailBlock> = {
    ...(type === "text" ? { text: "Add your text here." } : {}),
    ...(type === "button" ? { text: "Shop now", color: "#ffffff", background: "#0b494c", align: "center", radius: 4 } : {}),
    ...(type === "header" ? { text: "FILAZOO", fontSize: 30, bold: true, color: "#0b494c", align: "center", padding: 28 } : {}),
    ...(type === "quote" ? { text: "Add a customer quote.", heading: "Customer name", italic: true } : {}),
    ...(type === "coupon" ? { text: "YOURCODE", heading: "Your offer", background: "#f1f6f5", align: "center", bold: true } : {}),
    ...(type === "table" ? { rows: [["Item", "Details"], ["Product", "Description"]] } : {}),
    ...(type === "divider" ? { color: "#e5e5e5", height: 1, padding: 20 } : {}),
    ...(type === "image" ? { align: "center", alt: "Image" } : {}),
    ...(type === "product" ? { heading: "Choose a product", text: "", align: "center" } : {}),
    ...(type === "social" ? { links: [{ label: "Website", href: "" }], align: "center" } : {}),
    ...(type === "html" ? { html: "<p>Add your HTML content here.</p>" } : {}),
  };
  return blockSchema.parse({ id: crypto.randomUUID(), type, ...defaults, ...values });
}

export function newEmailDesign(text = "", mode: "design" | "text" | "html" = "design"): EmailDesign {
  const blocks = mode === "html" ? [newEmailBlock("html", { html: text || "<p>Hello {{first_name}},</p>" })] : mode === "text" ? [newEmailBlock("text", { text: text || "Hello {{first_name}},\n\n" })] : [newEmailBlock("header"), ...(text ? [newEmailBlock("text", { text })] : [])];
  return { version: 1, theme: { background: "#f3f6f6", contentBackground: "#ffffff", textColor: "#202020", accent: "#0b494c", width: 600, radius: 0, marginTop: 32, padding: 0, fontFamily: "Arial", fontSize: 16, backgroundImage: "" }, blocks };
}

export function removeEmailBlock(design: EmailDesign, id: string): EmailDesign {
  const removed = new Set([id]);
  for (let i = 0; i < 5; i++) for (const block of design.blocks) if (block.parentId && removed.has(block.parentId)) removed.add(block.id);
  return { ...design, blocks: design.blocks.filter(block => !removed.has(block.id)) };
}

export function moveEmailBlock(design: EmailDesign, id: string, parentId: string | null, column: number, beforeId?: string): EmailDesign {
  const block = design.blocks.find(item => item.id === id);
  if (!block || beforeId === id) return design;
  const moved = { ...block, parentId, column };
  const blocks = design.blocks.filter(item => item.id !== id);
  const position = beforeId ? blocks.findIndex(item => item.id === beforeId) : -1;
  blocks.splice(position < 0 ? blocks.length : position, 0, moved);
  const candidate = { ...design, blocks };
  return emailDesignSchema.safeParse(candidate).success ? candidate : design;
}

export function duplicateEmailBlock(design: EmailDesign, id: string): { design: EmailDesign; id: string } {
  const copies = new Map<string, string>();
  copies.set(id, crypto.randomUUID());
  for (let i = 0; i < 4; i++) for (const block of design.blocks) if (block.parentId && copies.has(block.parentId) && !copies.has(block.id)) copies.set(block.id, crypto.randomUUID());
  const clones = design.blocks.filter(block => copies.has(block.id)).map(block => ({ ...block, id: copies.get(block.id)!, parentId: block.parentId && copies.has(block.parentId) ? copies.get(block.parentId)! : block.parentId }));
  const index = design.blocks.findIndex(block => block.id === id);
  const blocks = [...design.blocks]; blocks.splice(index + 1, 0, ...clones);
  return { design: { ...design, blocks }, id: copies.get(id)! };
}

export function emailDesignUrl(value: string, image = false) {
  const input = value.trim();
  if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+=*$/i.test(input)) return input;
  try { const url = new URL(input); return (image ? ["https:", "http:"] : ["https:", "http:", "mailto:", "tel:"]).includes(url.protocol) ? url.toString() : ""; } catch { return ""; }
}

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
/** Raw HTML blocks keep email markup while discarding scripts, forms, handlers and unsafe URLs. */
export function sanitizeEmailDesignHtml(source: string, mapHref: (href: string) => string = href => href) {
  const document = parseDocument(source);
  const tags = new Set(["div", "p", "span", "br", "b", "strong", "i", "em", "u", "s", "a", "ul", "ol", "li", "blockquote", "table", "tbody", "thead", "tr", "td", "th", "img", "h1", "h2", "h3", "hr"]);
  const drop = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "button", "link", "meta"]);
  function render(node: HtmlNode): string {
    if (node.type === "text") return escapeEmailHtml(node.data);
    if (!("name" in node) || !("attribs" in node) || !("children" in node) || drop.has(node.name.toLowerCase())) return "";
    const name = node.name.toLowerCase(), inner = node.children.map(render).join("");
    if (!tags.has(name)) return inner;
    let attrs = "";
    const style = emailSafeStyle(node.attribs.style ?? ""); if (style) attrs += ` style="${escapeEmailHtml(style)}"`;
    if (name === "a") { const href = emailDesignUrl(mapHref(node.attribs.href ?? "")); if (href) attrs += ` href="${escapeEmailHtml(href)}"`; }
    if (name === "img") { const src = emailDesignUrl(node.attribs.src ?? "", true); if (!src) return ""; attrs += ` src="${escapeEmailHtml(src)}" alt="${escapeEmailHtml(node.attribs.alt ?? "")}"`; }
    for (const key of ["width", "height", "colspan", "rowspan"]) if (/^\d{1,4}%?$/.test(node.attribs[key] ?? "")) attrs += ` ${key}="${node.attribs[key]}"`;
    return ["br", "img", "hr"].includes(name) ? `<${name}${attrs}>` : `<${name}${attrs}>${inner}</${name}>`;
  }
  return document.children.map(render).join("");
}

function htmlText(html: string) {
  const root = parseDocument(html);
  function text(node: HtmlNode): string { if (node.type === "text") return node.data; if (!("children" in node)) return ""; return node.children.map(text).join("") + ("name" in node && ["p", "div", "br", "tr", "li", "h1", "h2", "h3"].includes(node.name) ? "\n" : ""); }
  return root.children.map(text).join("").trim();
}

export function emailDesignText(design: EmailDesign): string {
  function collect(parentId: string | null): string[] {
    return design.blocks.filter(block => block.parentId === parentId).flatMap(block => {
      if (["columns", "section"].includes(block.type)) return collect(block.id);
      if (["spacer", "divider"].includes(block.type)) return [];
      if (block.type === "html") return [htmlText(sanitizeEmailDesignHtml(block.html))];
      if (block.type === "table") return block.rows.map(row => row.join(" · "));
      if (block.type === "social" || block.type === "header") return [block.text, ...block.links.filter(link => link.href).map(link => `${link.label}: ${link.href}`)];
      return [block.heading, block.text, block.type === "image" ? block.alt || "Image" : "", block.href].filter(Boolean);
    });
  }
  return collect(null).filter(Boolean).join("\n\n").trim();
}

export type EmailRenderOptions = { personalize?: (value: string) => string; utmCampaign?: string; preheader?: string };
export function renderEmailBlockContent(block: EmailBlock, options: EmailRenderOptions = {}): string {
  const value = (text: string) => options.personalize?.(text) ?? text;
  const escape = (text: string) => escapeEmailHtml(value(text));
  const link = (href: string) => { const safe = emailDesignUrl(value(href)); if (!safe || !options.utmCampaign || !/^https?:/i.test(safe)) return safe; const url = new URL(safe); url.searchParams.set("utm_source", "filazoo"); url.searchParams.set("utm_medium", "email"); url.searchParams.set("utm_campaign", options.utmCampaign); return url.toString(); };
  const image = (src: string, alt: string) => { const safe = emailDesignUrl(value(src), true); return safe ? `<img src="${escapeEmailHtml(safe)}" alt="${escape(alt)}" width="${block.width}" style="display:block;max-width:100%;height:auto;border-radius:${block.radius}px;margin:0 ${block.align === "center" ? "auto" : "0"};">` : ""; };
  const anchor = (href: string, label: string) => { const url = link(href); return url ? `<a href="${escapeEmailHtml(url)}" style="color:inherit;text-decoration:underline;">${escape(label)}</a>` : escape(label); };
  const text = escape(block.text).replace(/\n/g, "<br>");
  switch (block.type) {
    case "text": return `<div style="white-space:normal;">${text}</div>`;
    case "header": return `${block.src ? image(block.src, block.alt || block.text) : `<div>${text}</div>`}${block.links.length ? `<div style="font-size:13px;font-weight:normal;margin-top:16px;">${block.links.map(item => anchor(item.href, item.label)).join(" &nbsp; ")}</div>` : ""}`;
    case "image": return block.href && link(block.href) ? `<a href="${escapeEmailHtml(link(block.href))}">${image(block.src, block.alt)}</a>` : image(block.src, block.alt);
    case "button": { const url = link(block.href); return `<a${url ? ` href="${escapeEmailHtml(url)}"` : ""} style="display:inline-block;padding:12px 24px;background:${block.background === "transparent" ? "#0b494c" : block.background};color:${block.color};border-radius:${block.radius}px;text-decoration:none;font-weight:600;">${text}</a>`; }
    case "divider": return `<div style="height:${block.height}px;background:${block.color};font-size:1px;line-height:1px;">&nbsp;</div>`;
    case "spacer": return `<div style="height:${block.height}px;font-size:1px;line-height:${block.height}px;">&nbsp;</div>`;
    case "social": return block.links.map(item => anchor(item.href, item.label)).join(" &nbsp; · &nbsp; ");
    case "product": return `${image(block.src, block.alt || block.heading)}<h3 style="font-size:${block.fontSize}px;margin:16px 0 8px;">${escape(block.heading)}</h3><div>${text}</div>${block.href ? `<p>${anchor(block.href, "View product")}</p>` : ""}`;
    case "coupon": return `<div style="font-size:14px;font-weight:normal;margin-bottom:12px;">${escape(block.heading)}</div><div style="border:1px dashed ${block.color};padding:16px;letter-spacing:2px;">${text}</div>`;
    case "table": return `<table width="100%" style="border-collapse:collapse;">${block.rows.map((row, index) => `<tr>${row.map(cell => `<${index === 0 ? "th" : "td"} style="padding:10px;border-bottom:1px solid #e5e5e5;text-align:left;">${escape(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>`;
    case "quote": return `<blockquote style="margin:0;"><div>${text}</div><p style="font-size:13px;font-style:normal;margin-top:12px;">${escape(block.heading)}</p></blockquote>`;
    case "video": return `${block.src ? `<a${link(block.href) ? ` href="${escapeEmailHtml(link(block.href))}"` : ""}>${image(block.src, block.alt || "Watch video")}</a>` : ""}<p>${anchor(block.href, block.text || "Watch video")}</p>`;
    case "html": return sanitizeEmailDesignHtml(block.html.replace(/\{\{[^}]+\}\}/g, token => escapeEmailHtml(value(token))), href => link(href));
    default: return "";
  }
}

export function renderEmailDesign(design: EmailDesign, options: EmailRenderOptions = {}) {
  const theme = design.theme;
  function rows(parentId: string | null, column = 0): string {
    return design.blocks.filter(block => block.parentId === parentId && block.column === column).map(block => {
      const content = block.type === "columns" ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${Array.from({ length: block.columnCount }, (_, index) => `<td class="email-column" width="${Math.floor(100 / block.columnCount)}%" valign="top"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows(block.id, index)}</table></td>`).join("")}</tr></table>` : block.type === "section" ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows(block.id)}</table>` : renderEmailBlockContent(block, options);
      const style = `padding:${block.padding}px;background:${block.background};color:${block.color};font-family:'${block.fontFamily}',sans-serif;font-size:${block.fontSize}px;font-weight:${block.bold ? "bold" : "normal"};font-style:${block.italic ? "italic" : "normal"};text-decoration:${block.underline ? "underline" : "none"};text-align:${block.align};line-height:1.6;border-radius:${block.radius}px;${block.shadow ? "box-shadow:0 2px 8px #00000018;" : ""}`;
      return `<tr><td style="${style}">${content}</td></tr>`;
    }).join("");
  }
  const bg = emailDesignUrl(theme.backgroundImage, true);
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@media(max-width:600px){.email-column{display:block!important;width:100%!important}.email-content{width:100%!important}}</style></head><body style="margin:0;padding:0;background:${theme.background};">${options.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${escapeEmailHtml(options.personalize?.(options.preheader) ?? options.preheader)}</div>` : ""}<table role="presentation" width="100%" cellspacing="0" cellpadding="0"${bg && !bg.startsWith("data:") ? ` background="${escapeEmailHtml(bg)}"` : ""} style="background-color:${theme.background};"><tr><td align="center" style="padding:${theme.marginTop}px 12px;"><table role="presentation" class="email-content" width="${theme.width}" cellspacing="0" cellpadding="0" style="width:100%;max-width:${theme.width}px;border-radius:${theme.radius}px;background:${theme.contentBackground};color:${theme.textColor};font-family:'${theme.fontFamily}',sans-serif;font-size:${theme.fontSize}px;"><tr><td style="padding:${theme.padding}px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows(null)}</table></td></tr></table></td></tr></table></body></html>`;
  const plain = emailDesignText(design);
  return { html, text: options.personalize?.(plain) ?? plain };
}
