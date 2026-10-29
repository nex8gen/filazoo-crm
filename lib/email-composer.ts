import { withEmailSignature } from "./user-preferences.ts";
import { appendEmailFooter, type EmailFooter } from "./email-footer.ts";
import { emailTextHtml, emailSafeStyle, escapeEmailHtml } from "./email-markup.ts";
export { emailTextHtml } from "./email-markup.ts";

export const inlineImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const maxInlineImageBytes = 7_500_000;

export function initialComposerHtml(text: string, signature: string) {
  const signed = withEmailSignature(text, signature);
  return signed ? `<div>${emailTextHtml(signed)}</div>` : "";
}

/** Use a small allowlist before placing clipboard HTML in the editable document. */
export function sanitizeComposerHtml(html: string, document: Document, preserveImagePlaceholders = false) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set(["DIV", "P", "BR", "B", "STRONG", "I", "EM", "U", "S", "SPAN", "A", "UL", "OL", "LI", "BLOCKQUOTE", "TABLE", "TBODY", "THEAD", "TR", "TD", "TH", "IMG"]);
  const discard = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "INPUT", "BUTTON", "META", "LINK"]);
  function clean(node: Node): string {
    if (node.nodeType === 3) return escapeEmailHtml(node.textContent || "");
    if (node.nodeType !== 1) return "";
    const element = node as HTMLElement;
    if (discard.has(element.tagName)) return "";
    const children = Array.from(element.childNodes).map(clean).join("");
    if (!allowed.has(element.tagName)) return children;
    const tag = element.tagName.toLowerCase();
    if (tag === "img") {
      const src = element.getAttribute("src") || "";
      const supported = /^https?:\/\/[^\s]+$/i.test(src) || /^\/api\/email\/footer\/assets\/[a-f0-9-]{36}$/i.test(src) || /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/]+=*$/i.test(src);
      if (!supported && !preserveImagePlaceholders) return "";
      if (src.startsWith("data:") && src.length > 10_000_050) throw new Error("Each inline image must be 7.5 MB or smaller.");
      const width = Number(element.getAttribute("width") || element.style.width.replace(/px$/, ""));
      return `<img ${supported ? 'src' : 'data-email-image-source'}="${emailTextHtml(src)}" alt="${emailTextHtml(element.getAttribute("alt") || "Image")}"${width > 0 ? ` width="${Math.min(1200, Math.round(width))}"` : ""} style="max-width:100%;height:auto">`;
    }
    if (tag === "br") return "<br>";
    const href = element.getAttribute("href") || "";
    const style = emailSafeStyle(element.getAttribute("style") || "");
    const spans = ["colspan", "rowspan"].flatMap((name) => { const count = Number(element.getAttribute(name)); return count > 0 && count <= 20 ? [` ${name}="${Math.round(count)}"`] : []; }).join("");
    const attrs = (tag === "a" && /^(https?:\/\/|mailto:|tel:)/i.test(href) ? ` href="${emailTextHtml(href)}"` : "") + (style ? ` style="${emailTextHtml(style)}"` : "") + spans;
    return `<${tag}${attrs}>${children}</${tag}>`;
  }
  return Array.from(template.content.childNodes).map(clean).join("");
}

export type InlineEmailAttachment = { filename: string; content: string; contentType: string; cid: string };

/** Keep GIF bytes untouched; only replace the data URL with a MIME Content-ID. */
export function prepareComposerMessage(text: string, html: string, signature: string, footer?: EmailFooter | null) {
  const attachments: InlineEmailAttachment[] = [];
  const content = html ? { text: text.trim(), html } : footer ? appendEmailFooter(text, undefined, footer) : { text: withEmailSignature(text, signature), html: initialComposerHtml(text, signature) };
  const signedText = content.text;
  const contentIds = new Map<string, string>();
  const body = (content.html || "").replace(/src="data:(image\/(?:png|jpeg|gif|webp));base64,([a-z\d+/]+=*)"/gi, (_match, contentType: string, content: string) => {
    const key = `${contentType}:${content}`;
    let cid = contentIds.get(key);
    if (!cid) {
      if (content.length * 3 / 4 - (content.match(/=*$/)?.[0].length || 0) > maxInlineImageBytes) throw new Error("Each inline image must be 7.5 MB or smaller.");
      cid = `image-${crypto.randomUUID()}@filazoo.com`;
      contentIds.set(key, cid);
      attachments.push({ filename: `image-${attachments.length + 1}.${contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1]}`, content, contentType, cid });
    }
    return `src="cid:${cid}"`;
  }).replace(/<img\b[^>]*>/gi, (tag) => tag.replace(/\sstyle="[^"]*"/gi, "").replace(/\s*\/?>$/, ' style="max-width:100%;height:auto">'));
  return { text: signedText, html: body, attachments };
}
