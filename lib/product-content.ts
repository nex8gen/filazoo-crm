import { parseDocument } from "htmlparser2";
import { emailSafeStyle, escapeEmailHtml } from "./email-markup.ts";
import { validProductImage } from "./product-images.ts";

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
const allowed = new Set(["p", "div", "span", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "blockquote", "a", "hr", "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "img", "font"]);
const discard = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "button", "textarea", "select", "link", "meta", "template"]);

/** A product description contains formatted content, never executable page markup. */
export function sanitizeProductDescription(source: string) {
  if (!source.trim()) return "";
  if (!/<\/?[a-z][^>]*>/i.test(source)) return `<p>${escapeEmailHtml(source).replace(/\n/g, "<br>")}</p>`;
  function render(node: HtmlNode): string {
    if (node.type === "text") return escapeEmailHtml(node.data);
    if (!("name" in node) || !("attribs" in node) || !("children" in node)) return "";
    const name = node.name.toLowerCase();
    if (discard.has(name)) return "";
    const inner = node.children.map(render).join("");
    if (!allowed.has(name)) return inner;
    let attributes = "";
    const style = emailSafeStyle(`${node.attribs.style ?? ""}${name === "font" ? `;color:${node.attribs.color ?? ""}` : ""}`);
    if (style) attributes += ` style="${escapeEmailHtml(style)}"`;
    if (name === "a" && /^(?:https?:\/\/|mailto:)/i.test(node.attribs.href ?? "")) attributes += ` href="${escapeEmailHtml(node.attribs.href)}" rel="noopener noreferrer"`;
    if (name === "img") {
      if (!node.attribs.src || !validProductImage(node.attribs.src)) return "";
      attributes += ` src="${escapeEmailHtml(node.attribs.src)}" alt="${escapeEmailHtml(node.attribs.alt ?? "")}"`;
    }
    for (const key of ["colspan", "rowspan"]) if (/^[1-9]\d?$/.test(node.attribs[key] ?? "")) attributes += ` ${key}="${node.attribs[key]}"`;
    const tag = name === "font" ? "span" : name;
    return ["br", "hr", "img"].includes(tag) ? `<${tag}${attributes}>` : `<${tag}${attributes}>${inner}</${tag}>`;
  }
  return parseDocument(source).children.map(render).join("");
}

export function productDescriptionImages(source: string) {
  const images: string[] = [];
  function visit(node: HtmlNode) {
    if ("name" in node && node.name === "img" && "attribs" in node && node.attribs.src) images.push(node.attribs.src);
    if ("children" in node) node.children.forEach(visit);
  }
  parseDocument(source).children.forEach(visit);
  return images;
}
