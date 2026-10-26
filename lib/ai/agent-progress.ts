import type { PreparedAgentAction } from "./agent-actions.ts";

export type AgentWorkArea = "invoice" | "email" | "message" | "company" | "product" | "workspace";
export type AgentWorkProgress = { area: AgentWorkArea; label: string; detail: string; relatedAreas?: AgentWorkArea[] };

export const agentWorkAreaLabels: Record<AgentWorkArea, string> = {
  invoice: "Invoices", email: "Email", message: "Messenger", company: "Companies", product: "Products", workspace: "Workspace",
};

export function pageWorkArea(page: string): AgentWorkArea {
  if (/invoice/i.test(page)) return "invoice";
  if (/email/i.test(page)) return "email";
  if (/messenger/i.test(page)) return "message";
  if (/compan/i.test(page)) return "company";
  if (/product|catalog/i.test(page)) return "product";
  return "workspace";
}

// Before a proposal exists these describe preparation, never completed actions.
export function requestedWorkProgress(request: string, page: string): AgentWorkProgress {
  const areas: AgentWorkArea[] = [];
  if (/\binvoic(?:e|es|ing)\b|发票/iu.test(request)) areas.push("invoice");
  if (/\be-?mail\b|邮件/iu.test(request)) areas.push("email");
  if (/\b(?:message|messenger|whatsapp|sms)\b|消息|短信/iu.test(request)) areas.push("message");
  const area = areas[0] ?? pageWorkArea(page);
  const labels: Record<AgentWorkArea, string> = {
    invoice: "Preparing invoice actions…", email: "Preparing email actions…", message: "Preparing message actions…",
    company: "Preparing company actions…", product: "Reviewing product details…", workspace: "Preparing your task…",
  };
  return { area, label: labels[area], detail: request.length > 180 ? `${request.slice(0, 177)}…` : request, relatedAreas: areas.slice(1) };
}

export function actionWorkProgress(action: PreparedAgentAction): AgentWorkProgress {
  if (action.type === "create_company") return { area: "company", label: "Creating company…", detail: action.company.name };
  const detail = `${action.document.customerName}${action.email ? ` · ${action.email.to}` : ""}`;
  if (action.type === "send_invoice") return { area: "email", label: "Preparing invoice email…", detail, relatedAreas: ["invoice"] };
  return { area: "invoice", label: action.type === "create_invoice" ? "Creating draft invoice…" : "Updating draft invoice…", detail, relatedAreas: action.email ? ["email"] : [] };
}
