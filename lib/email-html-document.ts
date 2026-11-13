import { DomUtils, parseDocument } from "htmlparser2";

export function isFullEmailHtml(html: string) { return /<html(?:\s|>)/i.test(html) && /<body(?:\s|>)/i.test(html); }
type Options = { imageUrl: (src: string) => string; link: (href: string) => string; personalize?: (value: string) => string };

/** Keep original email CSS, media queries and table layout inside sandboxed previews.
 * All imported or edited HTML still loses executable content and unsafe URLs.
 */
export function sanitizeFullEmailHtml(html: string, options: Options) {
  const root = parseDocument(html);
  type Node = typeof root.children[number];
  const allowed = new Set(["html", "head", "body", "title", "meta", "style", "link", "div", "p", "span", "br", "b", "strong", "i", "em", "u", "s", "small", "sup", "sub", "a", "ul", "ol", "li", "blockquote", "table", "tbody", "thead", "tfoot", "tr", "td", "th", "img", "h1", "h2", "h3", "h4", "hr", "center"]);
  const unsafeCss = /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:|\\|<\/?(?:script|iframe|style)/i;
  function css(value: string) {
    if (unsafeCss.test(value)) return "";
    return value.replace(/@import\s+url\(([^)]+)\)\s*;?/gi, (match, url: string) => /^['"]?https:\/\/fonts\.googleapis\.com\//i.test(url.trim()) ? match : "")
      .replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, (match, _quote: string, src: string) => {
        const safe = options.imageUrl(src); return safe === src ? match : safe ? `url('${safe.replace(/['"()]/g, character => encodeURIComponent(character))}')` : "none";
      });
  }
  function visit(node: Node, inCss = false) {
    if (node.type === "text") { node.data = inCss ? css(node.data) : options.personalize?.(node.data) ?? node.data; return; }
    if (node.type === "comment") {
      // Keep Outlook's structural conditional comments; never retain active content.
      if (!/^\[if\s[\s\S]*<!\[endif\]$/i.test(node.data.trim()) || /<\/?(?:script|iframe|object|embed|form)|\bon\w+\s*=|javascript\s*:|vbscript\s*:|expression\s*\(/i.test(node.data)) DomUtils.removeElement(node);
      else node.data = node.data.replace(/\b(src|background)\s*=\s*(["'])([^"']+)\2/gi, (_match, key: string, quote: string, src: string) => {
        const safe = options.imageUrl(src); return safe ? `${key}=${quote}${safe}${quote}` : "";
      }).replace(/\bstyle\s*=\s*"([^"]*)"/gi, (_match, value: string) => `style="${css(value)}"`);
      return;
    }
    if (!("name" in node) || !("attribs" in node) || !("children" in node)) return;
    const name = node.name.toLowerCase();
    if (!allowed.has(name) || name === "meta" && /refresh/i.test(node.attribs["http-equiv"] ?? "")) { DomUtils.removeElement(node); return; }
    if (name === "link" && !(node.attribs.rel === "stylesheet" && /^https:\/\/fonts\.googleapis\.com\//i.test(node.attribs.href ?? ""))) { DomUtils.removeElement(node); return; }
    for (const [key, value] of Object.entries(node.attribs)) {
      if (/^on/i.test(key) || ["srcdoc", "action", "formaction", "ping"].includes(key)) { delete node.attribs[key]; continue; }
      if (key === "style") node.attribs[key] = css(value);
      if (["src", "background"].includes(key)) { const safe = options.imageUrl(value); if (safe) node.attribs[key] = safe; else delete node.attribs[key]; }
      if (key === "srcset") delete node.attribs[key];
      if (key === "href" && name !== "link") { const safe = value.startsWith("#") ? value : options.link(options.personalize?.(value) ?? value); if (safe) node.attribs[key] = safe; else delete node.attribs[key]; }
      if (["title", "alt"].includes(key)) node.attribs[key] = options.personalize?.(value) ?? value;
    }
    for (const child of [...node.children]) visit(child, name === "style");
  }
  for (const node of [...root.children]) visit(node);
  return DomUtils.getOuterHTML(root, { encodeEntities: "utf8" });
}
