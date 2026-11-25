import { parseDocument } from "htmlparser2";
import { escapeEmailHtml } from "./email-markup.ts";

export type PortalWebsite = { html: string; css: string };
const tags = new Set("section article header footer main nav div span p h1 h2 h3 h4 h5 h6 a img br hr strong b em i u s ul ol li blockquote figure figcaption table thead tbody tr th td code pre details summary".split(" "));
const discard = new Set("script style iframe object embed svg math form input button textarea select link meta template base noscript".split(" "));
type HtmlNode = ReturnType<typeof parseDocument>["children"][number];

/** Website content is presentation only. Scripts, forms and remote CSS never enter the portal. */
export function portalWebsiteCss(source: string) {
  if (/[<>\\\u0000-\u0008]/.test(source) || /(?:url\s*\(|expression\s*\(|@import|@font-face|behavior\s*:|-moz-binding)/i.test(source)) return "";
  return source;
}
export function sanitizePortalWebsite(source: PortalWebsite): PortalWebsite {
  function render(node: HtmlNode, depth = 0): string {
    if (depth > 48) return "";
    if (node.type === "text") return escapeEmailHtml(node.data);
    if (!("name" in node) || !("attribs" in node) || !("children" in node)) return "";
    const tag = node.name.toLowerCase();
    if (discard.has(tag)) return "";
    const inner = node.children.map(child => render(child, depth + 1)).join("");
    if (!tags.has(tag)) return inner;
    const attrs: string[] = [];
    for (const key of ["id", "class", "title", "alt", "aria-label"]) {
      if (node.attribs[key]) attrs.push(`${key}="${escapeEmailHtml(node.attribs[key].slice(0, 1000))}"`);
    }
    const style = portalWebsiteCss(node.attribs.style ?? "");
    if (style) attrs.push(`style="${escapeEmailHtml(style)}"`);
    if (tag === "a" && /^(https:\/\/|mailto:|tel:|#[a-zA-Z0-9_-]+$)/i.test(node.attribs.href ?? "")) attrs.push(`href="${escapeEmailHtml(node.attribs.href)}" target="_blank" rel="noopener noreferrer"`);
    if (tag === "img") {
      if (!/^https:\/\//i.test(node.attribs.src ?? "")) return "";
      attrs.push(`src="${escapeEmailHtml(node.attribs.src)}" loading="lazy" referrerpolicy="no-referrer"`);
    }
    for (const key of ["colspan", "rowspan", "width", "height"]) if (/^[1-9]\d{0,3}$/.test(node.attribs[key] ?? "")) attrs.push(`${key}="${node.attribs[key]}"`);
    return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>${["img", "hr", "br"].includes(tag) ? "" : inner + `</${tag}>`}`;
  }
  return { html: parseDocument(source.html).children.map(node => render(node)).join(""), css: portalWebsiteCss(source.css) };
}

export const portalWebsiteBaseCss = `*{box-sizing:border-box}body{margin:0;background:#fff;color:#202824;font:15px/1.65 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}h1,h2,h3{line-height:1.15;letter-spacing:-.03em}a{color:inherit}section{max-width:100%}.fz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:24px}`;

/** Sandboxed document: no scripts, forms, frames, fetches or CSS imports. */
export function portalWebsiteDocument(source: PortalWebsite, accent = "#25865b") {
  const clean = sanitizePortalWebsite(source);
  const color = /^#[a-f\d]{6}$/i.test(accent) ? accent : "#25865b";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>${portalWebsiteBaseCss}:root{--brand:${color}}${clean.css}</style></head><body>${clean.html}</body></html>`;
}
