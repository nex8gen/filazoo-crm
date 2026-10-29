// Same-origin is needed for authenticated inline attachments. Never add
// allow-scripts: email HTML is untrusted, including event handlers and SVG.
export const emailContentSandbox = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export function emailDocument(html: string) {
  const safeHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(iframe|object|embed)\b[^>]*\/?\s*>/gi, "");
  const additions = '<base target="_blank"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;padding:0;background:transparent}img{max-width:100%;height:auto}</style>';
  return /<head[\s>]/i.test(safeHtml)
    ? safeHtml.replace(/<head([^>]*)>/i, `<head$1>${additions}`)
    : `<!doctype html><html><head>${additions}</head><body>${safeHtml}</body></html>`;
}

/** Match whole Content-IDs, including URI-encoded IDs used by mail clients. */
export function resolveEmailContentIds(html: string, attachments: ReadonlyArray<{ cid?: string; url?: string }>) {
  const urls = new Map(attachments.filter((item) => item.cid && item.url).map((item) => [item.cid!.replace(/^<|>$/g, ""), item.url!]));
  return html.replace(/\bcid:([^\s"'<>()]+)/gi, (original, value: string) => {
    let cid = value;
    try { cid = decodeURIComponent(value); } catch { /* Keep malformed IDs unchanged. */ }
    const url = urls.get(cid.replace(/^<|>$/g, ""));
    return url ? url.replaceAll("&", "&amp;") : original;
  });
}

/** Split recognizable quoted history without discarding the original body. */
export function splitQuotedEmail(body: string) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const boundary = lines.findIndex((line, index) => index > 0 && (
    /^\s*On\s.+wrote:\s*$/i.test(line)
    || /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)
    || (/^\s*>/.test(line) && lines.slice(0, index).some((value) => value.trim()))
  ));
  if (boundary < 0) return { current: body, quoted: null };
  const current = lines.slice(0, boundary).join("\n").trim();
  if (!current) return { current: body, quoted: null };
  return { current, quoted: lines.slice(boundary).join("\n") };
}
