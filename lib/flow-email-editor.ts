import { emailDesignText, type EmailDesign } from "./email-design.ts";
import { emailTemplates } from "./flow-templates.ts";
import type { JsonConfig } from "./flows.ts";

export const flowEmailTemplateNames: Record<string, string> = {
  helpful_reminder: "Helpful reminder", send_catalog: "Send product catalog (PDF)", quote_follow_up: "Quote follow-up",
  welcome_intro: "Welcome introduction", last_chance: "Last-chance follow-up",
};

export function flowEmailContent(config: JsonConfig) {
  const template = emailTemplates[String(config.templateId)];
  return { subject: String(config.subject || template?.subject || ""), body: String(config.body || template?.body || "") };
}

/** Copy content into the action so later library edits cannot change a saved workflow. */
export function applyFlowEmailTemplate(config: JsonConfig, template: { id?: string; name: string; subject?: string; body?: string; design?: EmailDesign | null }): JsonConfig {
  const next = { ...config, templateId: "custom", contentMode: template.design ? "design" : "text", templateName: template.name, subject: String(config.subject || template.subject || ""), body: template.design ? emailDesignText(template.design) : template.body || "" };
  const result: JsonConfig = next;
  delete result.emailDesign; delete result.sourceTemplateId;
  if (template.design) result.emailDesign = structuredClone(template.design) as unknown as JsonConfig[string];
  if (template.id) result.sourceTemplateId = template.id;
  return result;
}
