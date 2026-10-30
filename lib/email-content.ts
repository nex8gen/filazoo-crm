import { parseDocument, DomUtils } from "htmlparser2";
import type { ParentNode } from "domhandler";
import { emailTextHtml, escapeEmailHtml } from "./email-markup.ts";

// Same-origin is needed for authenticated inline attachments. Never add
// allow-scripts: email HTML is untrusted, including event handlers and SVG.
export const emailContentSandbox = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";
type DisplayAttachment = { inline?: boolean; cid?: string; contentLocation?: string; contentType?: string; filename?: string; url?: string };
export function isInlineEmailAttachment(attachment: DisplayAttachment, html?: string | null) {
  if (attachment.inline === false || !attachment.cid && !attachment.contentLocation) return false;
  if (attachment.contentType && !/^(?:image\/|application\/octet-stream$)/i.test(attachment.contentType)) return false;
  if (html !== undefined) {
    const content = html || "";
    return Boolean(attachment.url && (content.includes(attachment.url) || content.includes(escapeEmailHtml(attachment.url)))
      || attachment.cid && content.includes(`cid:${attachment.cid}`)
      || attachment.contentLocation && content.includes(escapeEmailHtml(attachment.contentLocation)));
  }
  return attachment.inline ?? Boolean(attachment.cid && attachment.contentType?.toLowerCase().startsWith("image/"));
}

export function emailDocument(html: string, allowRemoteImages = true) {
  const safeHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?\s*>/gi, "");
  const policy = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:${allowRemoteImages ? " https: http:" : ""}; form-action 'none'; base-uri 'none'`;
  const additions = `<base target="_blank"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;padding:0;background:transparent;font:14px/1.6 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`;
  return /<head[\s>]/i.test(safeHtml)
    ? safeHtml.replace(/<head([^>]*)>/i, `<head$1>${additions}`)
    : `<!doctype html><html><head>${additions}</head><body>${safeHtml}</body></html>`;
}

/** Remove known quoted-history containers while retaining the original for expansion. */
export function splitQuotedEmailHtml(html: string) {
  const document = parseDocument(html);
  const elements = DomUtils.findAll((element) => element.name === "blockquote" && element.attribs.type === "cite"
    || /(?:^|\s)(?:gmail_quote|gmail_quote_container|yahoo_quoted|moz-cite-prefix)(?:\s|$)/.test(element.attribs.class || "")
    || element.attribs.id === "divRplyFwdMsg", document.children);
  const first = elements[0];
  if (!first) return { current: html, quoted: false };
  // A quote-only email must remain visible.
  let preceding = "";
  function textBefore(node: (typeof document.children)[number]): boolean {
    if (node === first) return true;
    if ("name" in node && ["head", "style", "script"].includes(node.name)) return false;
    if ("data" in node && node.type === "text") preceding += node.data;
    if ("children" in node) for (const child of node.children) if (textBefore(child)) return true;
    return false;
  }
  for (const node of document.children) if (textBefore(node)) break;
  if (!preceding.trim()) return { current: html, quoted: false };
  let boundary: (typeof document.children)[number] = first;
  while (boundary.parent) {
    const parent: ParentNode = boundary.parent;
    for (const sibling of [...parent.children].slice(parent.children.indexOf(boundary))) DomUtils.removeElement(sibling);
    if (parent === document || ("name" in parent && parent.name === "body")) break;
    boundary = parent;
  }
  return { current: DomUtils.getOuterHTML(document), quoted: true };
}

export function normalizeEmailContentId(value: string) {
  let cid = value.trim().replace(/^cid:/i, "");
  try { cid = decodeURIComponent(cid); } catch { /* Keep malformed IDs unchanged. */ }
  return cid.replace(/^<|>$/g, "");
}
function contentIdLookup(attachments: ReadonlyArray<DisplayAttachment>) {
  const urls = new Map(attachments.filter((item) => item.cid && item.url).map((item) => [normalizeEmailContentId(item.cid!), item.url!]));
  return (value: string) => {
    const key = normalizeEmailContentId(value);
    if (urls.has(key)) return urls.get(key);
    const matches = [...urls].filter(([id]) => id.toLowerCase() === key.toLowerCase());
    return matches.length === 1 ? matches[0][1] : undefined;
  };
}

/** Resolve CID and Content-Location only in markup/CSS, preserving ordinary text. */
export function resolveEmailContentIds(html: string, attachments: ReadonlyArray<DisplayAttachment>) {
  const lookup = contentIdLookup(attachments);
  const locations = new Map(attachments.filter((item) => item.contentLocation && item.url).map((item) => [item.contentLocation!, item.url!]));
  const replaceCid = (value: string) => value.replace(/\bcid:(?:<([^>]+)>|([^\s"'<>()\[\]]+))/gi, (original, bracketed: string, plain: string) => lookup(bracketed || plain) || original);
  const document = parseDocument(html);
  for (const element of DomUtils.findAll(() => true, document.children)) {
    for (const name of ["src", "href", "background", "poster", "xlink:href"]) {
      const value = element.attribs[name];
      if (value) element.attribs[name] = locations.get(value) || replaceCid(value);
    }
    for (const name of ["style", "srcset"]) if (element.attribs[name]) element.attribs[name] = replaceCid(element.attribs[name]);
    if (element.name === "style") for (const child of element.children) if (child.type === "text") child.data = replaceCid(child.data);
  }
  return DomUtils.getOuterHTML(document);
}

/** Old plain-text caches and text-only forwards can contain literal [cid:...] markers. */
export function plainEmailContentHtml(body: string, attachments: ReadonlyArray<DisplayAttachment>) {
  if (!/\[cid:[^\]\r\n]+\]/i.test(body)) return null;
  const lookup = contentIdLookup(attachments);
  const fragments = body.split(/(\[cid:[^\]\r\n]+\])/gi).map((part) => {
    const match = /^\[cid:([^\]\r\n]+)\]$/i.exec(part);
    if (match) {
      const url = lookup(match[1]);
      const file = attachments.find((item) => item.cid && normalizeEmailContentId(item.cid) === normalizeEmailContentId(match[1]));
      return url ? `<img src="${escapeEmailHtml(url)}" alt="${escapeEmailHtml(file?.filename || "Embedded image")}">` : '<span role="img" aria-label="Embedded image unavailable">[Image unavailable]</span>';
    }
    return part.split(/(https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g).map((text) => /^https?:\/\//i.test(text) || /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)
      ? `<a href="${escapeEmailHtml(text.includes("://") ? text : `mailto:${text}`)}">${escapeEmailHtml(text)}</a>` : emailTextHtml(text)).join("");
  });
  return `<div>${fragments.join("")}</div>`;
}

/** Split recognizable quoted history without discarding the original body. */
export function splitQuotedEmail(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const boundary = lines.findIndex((line, index) => index > 0 && (
    /^\s*On\s.+wrote:\s*$/i.test(line)
    || /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)
    || (/^\s*>/.test(line) && lines.slice(0, index).some((value) => value.trim()))
    || (/^\s*(?:From|发件人|寄件者)\s*[:：]/i.test(line) && /(?:Sent|Date|发送时间|寄件日期)\s*[:：]/i.test(lines.slice(index, index + 7).join("\n")))
  ));
  if (boundary < 0) return { current: body, quoted: null };
  const current = lines.slice(0, boundary).join("\n").trim();
  if (!current) return { current: body, quoted: null };
  return { current, quoted: lines.slice(boundary).join("\n") };
}
