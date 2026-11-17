import { emailDesignText, emailDesignUrl, newEmailDesign, renderEmailBlockContent, type EmailDesign } from "./email-design.ts";
import { sanitizeFullEmailHtml } from "./email-html-document.ts";
import { emailTextHtml } from "./email-markup.ts";
import { applyFlowEmailTemplate, flowEmailContent } from "./flow-email-editor.ts";
import type { JsonConfig } from "./flows.ts";

export const textEmailFonts = ["Arial", "Helvetica", "Verdana", "Georgia", "Times New Roman", "Courier New"] as const;
export function isFlowTextEmail(config: JsonConfig): boolean {
  if (config.contentMode) return config.contentMode === "text";
  const design = config.emailDesign as EmailDesign | undefined;
  return !design || design.blocks.every(block => block.type === "text" && !block.parentId);
}
export function flowTextEmailHtml(config: JsonConfig): string {
  const clean = (html: string) => sanitizeFullEmailHtml(html, { imageUrl: value => emailDesignUrl(value, true, true), link: value => emailDesignUrl(value) });
  const design = config.emailDesign as EmailDesign | undefined;
  if (config.contentMode === "text" && design?.blocks.length === 1 && design.blocks[0].type === "html") {
    const html = design.blocks[0].html;
    return clean(/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html);
  }
  if (design?.blocks.every(block => block.type === "text" && !block.parentId)) return design.blocks.map(block => renderEmailBlockContent(block, { preview: true })).join("");
  return emailTextHtml(flowEmailContent(config).body);
}
export type FlowTextEmailDraft = { body: string; html: string; preheader: string; noPreview: boolean; font: string; fontSize: number };
export function flowTextEmailDraft(config: JsonConfig): FlowTextEmailDraft {
  return { body: flowEmailContent(config).body, html: flowTextEmailHtml(config), preheader: String(config.preheader || ""), noPreview: config.hidePreviewText === true, font: String(config.textFont || "Arial"), fontSize: Number(config.textFontSize) || 14 };
}
export function applyFlowTextEmail(config: JsonConfig, draft: FlowTextEmailDraft): JsonConfig {
  const font = (textEmailFonts as readonly string[]).includes(draft.font) ? draft.font : "Arial";
  const fontSize = Math.max(10, Math.min(72, Math.round(draft.fontSize) || 14));
  const design = newEmailDesign(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:8px;font-family:'${font}',sans-serif;font-size:${fontSize}px;line-height:1.5;background:white;color:#202124;">${draft.html || emailTextHtml(draft.body)}</body></html>`, "html");
  const next = applyFlowEmailTemplate(config, { name: "Text only email", body: draft.body || emailDesignText(design) });
  return { ...next, contentMode: "text", body: draft.body.trim(), emailDesign: design as unknown as JsonConfig[string], preheader: draft.noPreview ? "" : draft.preheader, hidePreviewText: draft.noPreview, textFont: font, textFontSize: fontSize };
}
