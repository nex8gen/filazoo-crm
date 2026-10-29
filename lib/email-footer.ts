import { emailTextHtml } from "./email-markup.ts";

export type EmailFooter = { text: string; html: string };
export const footerAssetPattern = /^\/api\/email\/footer\/assets\/([a-f0-9-]{36})$/i;

export function removeStandardSignoff(text: string) {
  return text.trim().replace(/\n(?:best regards|kind regards|warm regards|regards|sincerely),?\s*\n[\s\S]*$/i, "").trim();
}

export function footerSection(footer: EmailFooter) {
  return footer.html ? `<section data-email-footer="true">${footer.html}</section>` : "";
}

export function withoutComposerFooter(html: string) {
  return html.replace(/<section\b[^>]*data-email-footer="true"[^>]*>[\s\S]*?<\/section>/gi, "");
}

export function appendEmailFooter(text: string, html: string | undefined, footer: EmailFooter | null) {
  if (!footer?.html || /data-email-footer="true"/.test(html || "")) return { text, html };
  const body = removeStandardSignoff(text);
  // Generated sign-offs are replaced by the user's footer. Preserve authored HTML
  // when it has no generated sign-off to replace (including flow tracking).
  const bodyHtml = body === text.trim() && html ? html : `<div>${emailTextHtml(body)}</div>`;
  return { text: [body, footer.text].filter(Boolean).join("\n\n"), html: `${bodyHtml}<br>${footerSection(footer)}` };
}
