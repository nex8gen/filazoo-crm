import { Parser } from "htmlparser2";
import { emailTextHtml, emailSafeStyle, escapeEmailHtml } from "./email-markup.ts";
import { footerAssetPattern } from "./email-footer.ts";

/** Rebuild saved footer markup from parsed tokens, never from raw attributes. */
export function cleanEmailFooter(input: string) {
  const allowed = new Set(["div", "p", "br", "b", "strong", "i", "em", "u", "s", "span", "a", "ul", "ol", "li", "table", "tbody", "thead", "tr", "td", "th", "blockquote", "img"]);
  const discard = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form", "template"]);
  const blocks = new Set(["div", "p", "li", "tr", "blockquote"]);
  const stack: Array<{ name: string; omit: boolean; emit: boolean }> = [];
  let html = "", text = "";
  const parser = new Parser({
    onopentag(name, attrs) {
      const omit = Boolean(stack.at(-1)?.omit) || discard.has(name);
      const emit = !omit && allowed.has(name);
      stack.push({ name, omit, emit });
      if (!emit) return;
      if (name === "img") {
        const src = attrs.src || "";
        if (!footerAssetPattern.test(src) && !/^https?:\/\/[^\s]+$/i.test(src) && !/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(src)) return;
        const width = Number(attrs.width || attrs.style?.match(/(?:^|;)\s*width:\s*(\d+)px/i)?.[1]);
        html += `<img src="${emailTextHtml(src)}" alt="${emailTextHtml(attrs.alt || "Image")}"${width > 0 ? ` width="${Math.min(1200, Math.round(width))}"` : ""} style="max-width:100%;height:auto">`;
        return;
      }
      const href = attrs.href || "";
      const link = name === "a" && /^(https?:\/\/|mailto:|tel:)/i.test(href) && !/[\x00-\x20]/.test(href) ? ` href="${emailTextHtml(href)}"` : "";
      const style = emailSafeStyle(attrs.style || "");
      const spans = ["colspan", "rowspan"].flatMap((key) => { const count = Number(attrs[key]); return count > 0 && count <= 20 ? [` ${key}="${Math.round(count)}"`] : []; }).join("");
      html += `<${name}${link}${style ? ` style="${emailTextHtml(style)}"` : ""}${spans}>`;
      if (name === "br" || blocks.has(name)) text += "\n";
    },
    ontext(value) {
      if (stack.at(-1)?.omit) return;
      html += escapeEmailHtml(value);
      text += value;
    },
    onclosetag(name) {
      const entry = stack.pop();
      if (!entry?.emit) return;
      if (name !== "br" && name !== "img") html += `</${name}>`;
      if (blocks.has(name)) text += "\n";
    },
  }, { decodeEntities: true });
  parser.end(input);
  text = text.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text && !/<img\b/.test(html)) html = "";
  return { html, text };
}

export function footerImageSources(html: string) {
  const sources = new Set<string>();
  new Parser({ onopentag(name, attrs) { if (name === "img" && attrs.src) sources.add(attrs.src); } }, { decodeEntities: true }).end(html);
  return [...sources];
}
