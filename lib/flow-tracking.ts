import { createHmac, timingSafeEqual } from "node:crypto";
import type { JsonConfig } from "./flows.ts";
import { emailDesignSchema, emailDesignUrl, renderEmailDesign } from "./email-design.ts";
import { sanitizeFullEmailHtml } from "./email-html-document.ts";
import { renderFlowTemplate } from "./flow-templates.ts";
import { applyFlowUtm } from "./flow-email-utm.ts";

type TrackingPayload = { runId: string; stepId: string; kind: "open" | "click"; target?: string; expires: number };

export function signTracking(payload: TrackingPayload, secret: string) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
}

export function verifyTracking(token: string, secret: string): TrackingPayload | null {
  try {
    const [data, signature, extra] = token.split(".");
    if (!data || !signature || extra || token.length > 12000) return null;
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", secret).update(data).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as TrackingPayload;
    if (!/^[\da-f-]{36}$/i.test(payload.runId) || typeof payload.stepId !== "string" || !payload.stepId.trim() || payload.stepId.length > 100) return null;
    if (!["open", "click"].includes(payload.kind) || !Number.isFinite(payload.expires) || payload.expires <= Date.now()) return null;
    if (payload.kind === "click" && (!payload.target || !/^https?:\/\//i.test(payload.target))) return null;
    return payload;
  } catch { return null; }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildFlowEmail({ body, config, runId, stepId, flowId, appUrl, secret, contact }: { body: string; config: JsonConfig; runId: string; stepId: string; flowId: string; appUrl: string; secret: string; contact?: { name: string | null; email: string } }) {
  const expires = Date.now() + 366 * 86400000;
  const trackingUrl = (kind: "open" | "click", target?: string) => `${appUrl.replace(/\/$/, "")}/api/flows/track?token=${signTracking({ runId, stepId, kind, target, expires }, secret)}`;
  let text = "";
  let html = "";
  let offset = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>]+/g)) {
    const prefix = body.slice(offset, match.index);
    text += prefix;
    html += escapeHtml(prefix);
    let url: URL;
    try { url = new URL(match[0]); }
    catch {
      // Customer-authored text can contain incomplete links. Preserve it
      // without failing the entire message before submission.
      text += match[0];
      html += escapeHtml(match[0]);
      offset = match.index + match[0].length;
      continue;
    }
    applyFlowUtm(url, config, flowId);
    const target = url.toString();
    const href = config.trackClicks !== false ? trackingUrl("click", target) : target;
    text += href;
    html += `<a href="${escapeHtml(href)}">${escapeHtml(match[0])}</a>`;
    offset = match.index + match[0].length;
  }
  text += body.slice(offset);
  html += escapeHtml(body.slice(offset));
  html = `<div style="white-space:pre-wrap">${html}</div>`;
  if (config.emailDesign) {
    const design = emailDesignSchema.parse(config.emailDesign);
    const rendered = renderEmailDesign(design, { personalize: contact ? value => renderFlowTemplate(value, contact) : undefined });
    html = sanitizeFullEmailHtml(rendered.html, { imageUrl: src => emailDesignUrl(src, true), link: href => {
      const safe = emailDesignUrl(href);
      if (!/^https?:\/\//i.test(safe)) return safe;
      const url = new URL(safe);
      applyFlowUtm(url, config, flowId);
      return config.trackClicks !== false ? trackingUrl("click", url.toString()) : url.toString();
    } });
  }
  const preheader = config.hidePreviewText ? "\u200c\u00a0".repeat(100) : String(config.preheader || "");
  if (preheader) html = `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>${html}`;
  if (config.trackOpens !== false) html += `<img src="${escapeHtml(trackingUrl("open"))}" width="1" height="1" alt="" />`;
  return { text, html };
}
