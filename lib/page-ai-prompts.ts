import type { HomePrompt } from "./home-prompts.ts";

export type PageAiPrompt = { id: string; label: string; mode: "chat" | "agent"; icon: HomePrompt["icon"]; prompt: string };
type PromptSet = { page: string; prompts: PageAiPrompt[] };

const pageIcons: Record<string, HomePrompt["icon"][]> = {
  Email: ["mail", "calendar", "mail", "calendar"],
  "Marketing campaigns": ["receipt", "calendar", "mail", "megaphone"],
  "Company profile": ["file", "boxes", "mail", "list"],
  Companies: ["calendar", "boxes", "mail", "list"],
  Products: ["package", "file", "megaphone", "boxes"],
  "Company Quotations": ["file", "receipt", "mail", "file"],
  "Purchase Order": ["package", "file", "mail", "list"],
  Invoices: ["receipt", "file", "mail", "receipt"],
  Workflow: ["list", "file", "calendar", "mail"],
  Messenger: ["mail", "calendar", "mail", "list"],
  "Files & templates": ["file", "list", "mail", "package"],
  Analytics: ["receipt", "boxes", "file", "list"],
  "Tasks and notifications": ["list", "calendar", "list", "calendar"],
  Segments: ["boxes", "megaphone", "list", "mail"],
  "AI Leads": ["boxes", "file", "mail", "calendar"],
  Pipeline: ["receipt", "calendar", "list", "mail"],
  Settings: ["file", "list", "list", "calendar"],
};

function promptSet(page: string, items: [string, string][]): PromptSet {
  return { page, prompts: items.map(([label, request], index) => {
    const mode = index < 2 ? "chat" : "agent";
    const boundary = mode === "chat"
      ? "Use only accessible saved records, distinguish missing data from zero, and explain any coverage limits. Keep this read-only."
      : "Prepare drafts or proposed changes for review. Ask for any missing recipient, record, or required details. Do not send messages, publish, delete, or apply changes.";
    return { id: `${mode}-${index}`, label, mode, icon: (pageIcons[page] ?? ["file", "list", "mail", "calendar"])[index]!, prompt: `${request} ${boundary}` };
  }) };
}

const prompts = {
  email: promptSet("Email", [
    ["Summarize my inbox", "Summarize the accessible inbox for the mailbox on this page. Highlight customer requests, unanswered conversations, and urgent items, with links."],
    ["Find emails needing a reply", "Identify customer conversations that still need our reply in the current mailbox. Check the latest sender and follow-up status before recommending action."],
    ["Draft a customer reply", "Draft a reply using the selected customer email and its conversation history. If no email is selected, ask which conversation to use. Use saved product facts and avoid unverified pricing or delivery promises."],
    ["Prepare email follow-ups", "Review customer conversations needing follow-up in this mailbox and prepare concise follow-up drafts for the ones needing attention. Show the recipient and reason for each draft."],
  ]),
  campaigns: promptSet("Marketing campaigns", [
    ["Review campaign performance", "Review the saved email campaigns on this page. Compare available delivery and engagement results and identify the campaigns needing attention. Do not invent metrics that are not tracked."],
    ["Check campaign readiness", "Review the selected campaign, or ask which campaign to use. Check its draft, audience, saved product facts, timing, and missing information before launch."],
    ["Draft campaign copy", "Prepare an email campaign draft using our saved products and customer segments. Ask for the campaign goal if missing, then propose subject lines, copy, and a suitable audience."],
    ["Plan the next campaign", "Propose the next email campaign using saved campaign history, products, and customer segments. Explain the audience, offer, and timing without assuming unavailable discounts or stock."],
  ]),
  company: promptSet("Company profile", [
    ["Summarize this customer", "Summarize the selected company using its saved profile, messages, quotations, orders, and follow-ups. Highlight the relationship status and next useful step."],
    ["Find customer opportunities", "Analyze the selected company's saved business details and conversation history for relevant product needs and sales opportunities. Separate verified facts from estimates."],
    ["Draft a customer follow-up", "Draft a personalized follow-up for the selected company using its latest conversation, quotation, and order context. Ask which contact to address if unclear."],
    ["Plan customer next steps", "Propose a prioritized follow-up plan for the selected company using saved commitments, due dates, and customer requests. Explain the reason for each proposed task."],
  ]),
  companies: promptSet("Companies", [
    ["Prioritize customer follow-ups", "Review accessible companies and identify overdue or upcoming customer follow-ups. Use saved dates, activity, and assigned tasks to explain the priorities."],
    ["Find sales opportunities", "Review accessible customer profiles, messages, and orders for supported sales opportunities. Show the evidence, customer links, and suggested next steps."],
    ["Prepare customer outreach", "Prepare personalized outreach drafts for customers shown on this page. Ask for the target customers and outreach goal if they are not clear."],
    ["Plan account follow-ups", "Propose follow-up tasks for the customer accounts that need attention. Use saved owners, commitments, and due dates; do not invent deadlines."],
  ]),
  products: promptSet("Products", [
    ["Check product availability", "Review the selected product, or accessible products on this page, for saved stock status, quantities, variants, and inventory freshness. Distinguish product labels from verified inventory snapshots."],
    ["Find missing product details", "Review saved product specifications, pricing, variants, and sales material for missing details or inconsistencies. Link to the affected products."],
    ["Draft a product introduction", "Draft a concise customer-facing introduction for the selected product using its saved specifications and sales materials. Ask which product to use if none is selected."],
    ["Prepare a product comparison", "Prepare a customer-facing comparison of relevant saved products, including material, specifications, and supported use cases. Ask which products or customer requirements to use if unclear."],
  ]),
  quotations: promptSet("Company Quotations", [
    ["Review open quotations", "Review accessible saved quotations and identify shared quotations needing follow-up. Separate drafts, accepted, expired, and declined versions, and check customer messages before claiming there was no reply."],
    ["Check quotation details", "Review the selected quotation for saved products, quantities, prices, currency, validity, and missing customer details. Ask which quotation to review if none is selected."],
    ["Draft a quotation follow-up", "Draft a concise follow-up for the selected shared quotation using its customer conversation and saved terms. Ask which quotation to use if needed."],
    ["Prepare a quotation draft", "Prepare a quotation proposal using saved products, prices, and the customer's actual requirements. Ask for the customer, quantities, currency, and any missing terms."],
  ]),
  orders: promptSet("Purchase Order", [
    ["Review orders needing attention", "Review accessible purchase orders or the selected order. Identify missing information and next steps using saved status, customer requests, and delivery details. Separate confirmed orders from drafts and cancellations."],
    ["Summarize order status", "Summarize the selected order, or the orders on this page, including customer, items, saved status, value with currency, and outstanding steps."],
    ["Draft an order update", "Prepare a customer update for the selected order using saved delivery and fulfillment details. Ask which order to use if none is selected. Do not promise unverified shipment dates."],
    ["Prepare an order checklist", "Prepare a practical fulfillment checklist for the selected purchase order, covering saved products, quantities, customer details, and outstanding requirements."],
  ]),
  invoices: promptSet("Invoices", [
    ["Find overdue balances", "Review accessible invoices or the selected invoice for overdue unpaid balances as of today in Asia/Shanghai. Exclude draft, void, and paid invoices, and distinguish missing due dates from overdue balances."],
    ["Check invoice details", "Check the selected invoice for missing billing information, line-item issues, currency, due date, and saved payment balance. Ask which invoice to use if none is selected."],
    ["Draft a payment reminder", "Draft a polite payment reminder for the selected overdue invoice using its actual remaining balance, currency, and due date. Ask which invoice to use if needed."],
    ["Prepare an invoice draft", "Prepare an invoice proposal from a saved confirmed order. Ask which order and billing details to use, and verify saved quantities, amounts, and currency."],
  ]),
  workflow: promptSet("Workflow", [
    ["Review this workflow", "Review the selected workflow, including any visible unsaved draft, for trigger, conditions, waits, actions, and exit rules. Explain its behavior and flag missing configuration."],
    ["Find workflow gaps", "Audit the selected workflow for duplicate outreach, missing stop conditions, incorrect branches, and incomplete message settings. Ask which workflow to review if none is selected."],
    ["Draft a follow-up sequence", "Propose an email follow-up workflow for the customer scenario on this page. Include entry criteria, delays, message drafts, and stop conditions. Ask for the goal if missing."],
    ["Improve workflow messages", "Prepare improved email drafts for the selected workflow using its purpose, timing, and saved product facts. Preserve relevant customer context and identify missing information."],
  ]),
  messenger: promptSet("Messenger", [
    ["Summarize this conversation", "Summarize the selected Messenger conversation, the customer's requests, commitments, and unresolved questions. Ask which conversation to use if none is selected."],
    ["Find unanswered messages", "Identify accessible Messenger conversations needing a response or follow-up. Check the latest message and saved status, and explain the priorities."],
    ["Draft a Messenger reply", "Prepare a concise reply to the selected Messenger conversation using its history and saved product facts. Ask which conversation to use if needed."],
    ["Prepare conversation follow-ups", "Prepare follow-up drafts and suggested tasks for the Messenger conversations needing attention. Base them on actual customer requests and commitments."],
  ]),
  documents: promptSet("Files & templates", [
    ["Find relevant sales material", "Find saved files and templates relevant to the product or customer task on this page. Ask for the product, customer, or purpose if unclear, and return links to useful material."],
    ["Review template gaps", "Review the selected saved template or accessible text templates for outdated product claims, missing placeholders, and unclear customer messaging."],
    ["Draft a reusable template", "Draft a reusable customer-message template for the task on this page using saved product facts. Ask for its purpose and audience if unclear, and mark editable placeholders."],
    ["Prepare a product summary", "Prepare a concise customer-facing summary from a selected saved product document. Ask which file or product to use if none is selected, and preserve important technical qualifications."],
  ]),
  analytics: promptSet("Analytics", [
    ["Explain these results", "Explain the metrics and trends shown on this analytics page using the selected period, filters, and available saved records. Highlight the most useful takeaways."],
    ["Find performance drivers", "Investigate the strongest changes in the analytics shown on this page. Compare equivalent periods where available and separate supported drivers from hypotheses."],
    ["Draft a performance recap", "Prepare a concise business performance recap from this analytics page, including the selected period, verified results, important limits, and recommended next steps."],
    ["Plan performance improvements", "Propose a prioritized action plan based on the analytics shown on this page. Tie each recommendation to evidence and an outcome that can be measured."],
  ]),
  tasks: promptSet("Tasks and notifications", [
    ["Prioritize my tasks", "Review my accessible assigned tasks and identify overdue and due-today work in Asia/Shanghai. Prioritize using saved due dates and priority, excluding completed or cancelled tasks."],
    ["Review overdue work", "Summarize overdue assigned tasks and their related customer records. Explain what needs attention and distinguish tasks with no due date."],
    ["Plan my day", "Prepare a practical plan for today in Asia/Shanghai using my saved assigned tasks, customer commitments, and follow-up dates. Link to each task and explain the suggested order."],
    ["Prepare follow-up tasks", "Propose follow-up tasks based on accessible customer commitments and unanswered requests. Include suggested owners and due dates only where supported by saved records."],
  ]),
  segments: promptSet("Segments", [
    ["Review segment criteria", "Review the selected customer segment's saved criteria and explain which customers qualify. Identify missing filters and potential audience overlap."],
    ["Find audience opportunities", "Review accessible customer segments for relevant sales outreach opportunities. Explain the saved criteria and evidence supporting each recommendation."],
    ["Plan a customer segment", "Propose a customer segment for the business goal on this page using supported saved customer attributes. Ask for the target audience or goal if missing."],
    ["Draft segment outreach", "Prepare a relevant outreach draft for the selected customer segment using its saved criteria and product facts. Ask which segment and campaign goal to use if unclear."],
  ]),
  leads: promptSet("AI Leads", [
    ["Review lead fit", "Review the leads shown on this page for relevant business and product fit. Separate verified company facts from estimates and explain which leads deserve attention."],
    ["Check lead completeness", "Review the saved leads on this page for missing company, source, and contact details. Distinguish verified public contact information from unavailable details."],
    ["Draft a lead introduction", "Prepare a personalized introduction for a selected lead using verified public business facts and our saved products. Ask which lead and contact to use if unclear."],
    ["Plan lead follow-ups", "Propose a follow-up plan for selected saved leads using their business fit, prior contact, and saved requests. Ask which leads to include if none are selected."],
  ]),
  pipeline: promptSet("Pipeline", [
    ["Review pipeline health", "Review the accessible customer pipeline for stage distribution, inactive opportunities, and missing next steps. Use saved activity and do not assume historical stage dates are available."],
    ["Find stalled opportunities", "Identify accessible sales opportunities that may be stalled based on saved customer messages, follow-up dates, and activity. Explain the evidence and uncertainty."],
    ["Plan pipeline follow-ups", "Propose a prioritized follow-up plan for pipeline opportunities needing attention. Link each proposed task to saved customer context."],
    ["Draft opportunity outreach", "Prepare a personalized follow-up for a selected pipeline opportunity using its latest customer request and saved quotation or order context."],
  ]),
  settings: promptSet("Settings", [
    ["Explain these settings", "Explain the settings visible on this page, what they affect, and any missing setup information. Do not reveal credentials or claim to inspect hidden configuration."],
    ["Review setup readiness", "Review the visible workspace or connection setup on this page. Identify incomplete steps and distinguish confirmed status from information needing verification."],
    ["Prepare a setup checklist", "Prepare a step-by-step setup checklist for the settings page currently open. Explain which details are needed and which steps require the workspace owner."],
    ["Plan connection troubleshooting", "Prepare a troubleshooting plan for the connection or configuration shown on this page, using visible status and errors. Ask for the affected connection and symptoms if unclear."],
  ]),
  workspace: promptSet("Workspace", [
    ["Summarize this page", "Summarize the current page's saved information, outstanding items, and most important next steps."],
    ["Find items needing attention", "Review the current page for missing information, inconsistencies, and work needing attention. Explain the evidence behind each finding."],
    ["Draft a next-step plan", "Prepare a short prioritized work plan based on the current page and its accessible saved records. Ask for the goal if unclear."],
    ["Prepare a customer message", "Prepare a professional customer message using the current page's context and saved facts. Ask for the recipient and purpose if unclear."],
  ]),
} satisfies Record<string, PromptSet>;

/** Match specific sections before their parent route; never retain prompts from the previous page. */
export function getPageAiPrompts(pathname: string): PromptSet {
  const path = pathname.split(/[?#]/, 1)[0];
  const at = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (at("/email/campaigns")) return prompts.campaigns;
  if (at("/email/workflows") || at("/workflow") || at("/automation")) return prompts.workflow;
  if (at("/email")) return prompts.email;
  if (at("/companies")) return path === "/companies" || path === "/companies/" ? prompts.companies : prompts.company;
  if (at("/company-quotations")) return prompts.quotations;
  if (at("/products")) return prompts.products;
  if (at("/purchase-orders")) return prompts.orders;
  if (at("/invoices")) return prompts.invoices;
  if (at("/messenger")) return prompts.messenger;
  if (at("/documents")) return prompts.documents;
  if (at("/analytics")) return prompts.analytics;
  if (at("/tasks")) return prompts.tasks;
  if (at("/segments")) return prompts.segments;
  if (at("/lead-channel")) return prompts.leads;
  if (at("/pipeline")) return prompts.pipeline;
  if (at("/settings")) return prompts.settings;
  return prompts.workspace;
}
