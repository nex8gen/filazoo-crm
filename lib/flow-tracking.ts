import { createHmac, timingSafeEqual } from "node:crypto";
import type { JsonConfig } from "./flows.ts";

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
    if (!/^[\da-f-]{36}$/i.test(payload.runId) || !/^[\da-f-]{36}$/i.test(payload.stepId)) return null;
    if (!["open", "click"].includes(payload.kind) || !Number.isFinite(payload.expires) || payload.expires <= Date.now()) return null;
    if (payload.kind === "click" && (!payload.target || !/^https?:\/\//i.test(payload.target))) return null;
    return payload;
  } catch { return null; }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildFlowEmail({ body, config, runId, stepId, flowId, appUrl, secret }: { body: string; config: JsonConfig; runId: string; stepId: string; flowId: string; appUrl: string; secret: string }) {
  const expires = Date.now() + 366 * 86400000;
  const trackingUrl = (kind: "open" | "click", target?: string) => `${appUrl.replace(/\/$/, "")}/api/flows/track?token=${signTracking({ runId, stepId, kind, target, expires }, secret)}`;
  let text = "";
  let html = "";
  let offset = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>]+/g)) {
    const prefix = body.slice(offset, match.index);
    text += prefix;
    html += escapeHtml(prefix);
    const url = new URL(match[0]);
    if (config.utmTracking !== false) {
      url.searchParams.set("utm_source", "filazoo");
      url.searchParams.set("utm_medium", "email");
      url.searchParams.set("utm_campaign", flowId);
    }
    const target = url.toString();
    const href = config.trackClicks !== false ? trackingUrl("click", target) : target;
    text += href;
    html += `<a href="${escapeHtml(href)}">${escapeHtml(match[0])}</a>`;
    offset = match.index + match[0].length;
  }
  text += body.slice(offset);
  html += escapeHtml(body.slice(offset));
  html = `<div style="white-space:pre-wrap">${html}</div>`;
  if (config.preheader) html = `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(String(config.preheader))}</div>${html}`;
  if (config.trackOpens !== false) html += `<img src="${escapeHtml(trackingUrl("open"))}" width="1" height="1" alt="" />`;
  return { text, html };
}
