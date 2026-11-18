import { blankStep, type FlowInput, type FlowStepType, type JsonConfig } from "./flows.ts";

const action = (type: FlowStepType, config: JsonConfig = {}) => { const step = blankStep(type); return { ...step, config: { ...step.config, ...config } }; };
const wait = (days: number) => action("wait", { amount: days, unit: "days", businessDays: true, resumeAt: "09:00" });
const email = (templateId: string) => action("send_email", { templateId });
const updateCompany = (config: JsonConfig) => ({ ...blankStep("update_company"), config });
function split(name: string, condition: JsonConfig, yes: FlowInput["steps"], no: FlowInput["steps"]) {
  const step = action("split", { name });
  step.config.paths = [{ id: `${step.id}-match`, name: "Matches", condition, steps: yes }, { id: `${step.id}-else`, name: "Everyone else", condition: null, steps: no }] as unknown as JsonConfig["paths"];
  return step;
}
export const flowRecipeOptions = [
  { id: "lead_intake", title: "New lead auto-response", description: "Send an introduction or ask for missing requirements, attach the catalog, and hand over next business morning at 09:00 China time.", trigger: "New lead" },
  { id: "lead_ai_handoff", title: "AI lead reply and personal handoff", description: "Wait one minute, send an AI reply, then check after 24 hours. Assign replies to you or send one AI reminder.", trigger: "New lead" },
  { id: "dormant", title: "Reactivate inactive customers", description: "Find inactive customers and follow up at months 1, 3, 6 and 12. Stop on replies, orders or manual takeover.", trigger: "Customer becomes inactive" },
  { id: "inbound", title: "Respond to an inquiry", description: "AI answers a received email, then checks for a reply before assigning follow-up work.", trigger: "Email received" },
  { id: "qualification", title: "Qualify and route leads", description: "Route by fit score, then by market. Update the company, assign a task and notify its owner.", trigger: "New lead" },
  { id: "followup", title: "Follow up without a reply", description: "Send a reminder after two days without a reply, wait, then hand off to a teammate.", trigger: "No reply after" },
  { id: "shopify", title: "Welcome Shopify leads", description: "Send the catalog to new Shopify B2B leads and follow up according to engagement.", trigger: "Lead added to list" },
  { id: "meta", title: "Welcome Meta leads", description: "Introduce the business, wait for engagement, and create a task for interested leads.", trigger: "Lead added to list" },
  { id: "segment", title: "Nurture a customer segment", description: "Send a tailored introduction when a company enters your chosen segment.", trigger: "Company enters segment" },
  { id: "category", title: "Respond to buying interest", description: "Create an urgent task and an internal alert when an email is marked Interested.", trigger: "Category changed to" },
] as const;

/** New independent identities on every use. Recipes are always drafts. */
export function createFlowRecipe(id: string, options: { assigneeId?: string } = {}): FlowInput {
  const base: FlowInput = { name: flowRecipeOptions.find((item) => item.id === id)?.title || "Untitled workflow", triggerType: "new_lead", triggerConfig: {}, status: "draft", steps: [] };
  const replyExit = () => split("Has the customer replied?", { field: "customer_replied" }, [action("stop", { reason: "Customer replied" })], [action("create_task")]);
  if (id === "lead_intake") return { ...base, triggerConfig: { reentryMode: "no_reentry" }, steps: [
    action("wait", { amount: 1, unit: "minutes", businessDays: false }),
    action("ai_auto_reply", { leadIntake: true, attachCatalog: true, useProducts: true, usePrices: false, sendWindow: "anytime", instructions: "For a specific inquiry, acknowledge the supplied requirements and ask only for missing material, specifications, color, quantity or use. Keep the response concise. Sales will review the conversation the next business morning." }),
    action("wait", { amount: 1, unit: "days", businessDays: true, resumeAt: "01:00" }),
    action("create_task", { assigneeType: options.assigneeId ? "user" : "owner", assigneeId: options.assigneeId || null, title: "Review new lead and take over", notes: "Review the original inquiry, initial response, customer requirements and open questions. Continue this conversation personally; the initial-response automation ends here.", dueInDays: 0, priority: "high" }),
    action("internal_alert", { userId: options.assigneeId || "owner", message: "A new lead is ready for your review and personal follow-up.", includeThreadLink: true, channel: "in_app" }),
    action("stop", { reason: "New-lead response completed; handed over to sales" }),
  ] };
  if (id === "dormant") return { ...base, triggerType: "dormant_customer", triggerConfig: { inactivityMonths: 1, reentryMode: "every_event" }, steps: [
    ...[1, 3, 6, 12].flatMap(month => [
      action("wait", { amount: month, unit: "months", anchor: "trigger", businessDays: true, resumeAt: "09:00" }),
      action("ai_auto_reply", { nurture: true, stopOnReply: true, usePrices: false, attachCatalog: false, sendWindow: "business_hours", instructions: "Re-engage this inactive customer using the actual conversation and saved customer history. For an unanswered quotation, ask about purchasing plans or unresolved requirements. For a past buyer, ask about their experience and replenishment needs. Ask one useful question. Do not repeat fulfilled requests, invent offers, automatically discount, or pretend this is a new incoming inquiry." }),
    ]),
    action("create_task", { title: "Review inactive customer after nurture", priority: "normal", notes: "The automatic follow-up sequence has finished. Review the customer before contacting them again." }),
    action("stop", { reason: "Inactive customer follow-up sequence finished" }),
  ] };
  if (id === "lead_ai_handoff") {
    const handoff = () => [
      action("create_task", { assigneeType: options.assigneeId ? "user" : "owner", assigneeId: options.assigneeId || null, dueInDays: 0, priority: "high", title: "Reply to this customer's email", notes: "Read the latest customer reply and continue the conversation personally. Open the linked customer context from the accompanying notification and review their email conversation. Automated reminders end on this branch." }),
      action("internal_alert", { userId: options.assigneeId || "owner", message: "A lead replied. A task has been assigned to you to continue this email conversation.", includeThreadLink: true, channel: "in_app" }),
      action("stop", { reason: "Customer replied; task created and automated reminders ended" }),
    ];
    const replyCheck = (noReply: FlowInput["steps"]) => split("Has the customer replied?", { field: "customer_replied", lookbackDays: 365 }, handoff(), noReply);
    const replyWait = () => ({ ...blankStep("wait"), config: { amount: 24, unit: "hours", businessDays: false } });
    const ai = (instructions: string, reminder = false) => action("ai_auto_reply", {
      usePrices: false, attachCatalog: false, sendWindow: "anytime", smartSendingHours: 0,
      instructions,
      ...(reminder ? { filters: { field: "customer_replied", negate: true, lookbackDays: 365 } } : {}),
    });
    return { ...base, triggerConfig: { reentryMode: "no_reentry" }, steps: [
      { ...blankStep("wait"), config: { amount: 1, unit: "minutes", businessDays: false } },
      replyCheck([
        ai("Write a short, friendly first response to this new Filazoo lead. Use the latest authorized conversation and active product information. Ask only for missing requirements, such as materials, order quantity and delivery destination. Do not claim to have read form answers absent from the supplied context. Do not invent prices, freight, availability, delivery dates, credit terms, order confirmation or attachments."),
        replyWait(),
        replyCheck([
          ai("Write one short, polite reminder about the unanswered Filazoo inquiry. Read the conversation, refer to the previous message naturally and ask whether help with material selection, quantities or delivery requirements would be useful. Do not repeat already answered questions, invent urgency, promise prices or shipping, claim an attachment, or say that an order was confirmed.", true),
          replyWait(),
          replyCheck([action("stop", { reason: "One AI reminder sent; no reply at the final check" })]),
        ]),
      ]),
    ] };
  }
  if (id === "inbound") return { ...base, triggerType: "email_received", steps: [action("ai_auto_reply"), wait(2), replyExit()] };
  if (id === "qualification") return { ...base, steps: [split("Lead qualification", { field: "fit_score_at_least", fitScore: 7 }, [updateCompany({ companyStatus: "qualified" }), split("Priority market", { field: "country_is", value: "US" }, [action("create_task", { priority: "high", title: "Contact priority buyer" }), action("internal_alert", { message: "A priority buyer is ready for follow-up." })], [action("create_task", { title: "Review qualified buyer" })])], [email("welcome_intro"), wait(2), replyExit()])] };
  if (id === "followup") return { ...base, triggerType: "no_reply", triggerConfig: { amount: 2, unit: "days", businessDays: true }, steps: [email("helpful_reminder"), wait(3), replyExit()] };
  if (id === "shopify" || id === "meta") return { ...base, triggerType: "lead_added_to_list", triggerConfig: { listId: id === "shopify" ? "Shopify B2B leads" : "Meta ad leads", reentryMode: "no_reentry" }, steps: [email(id === "shopify" ? "send_catalog" : "welcome_intro"), wait(2), split("Customer engagement", { match: "any", rules: [{ field: "customer_replied" }, { field: "clicked_link" }] }, [action("create_task", { priority: "high" })], [email("helpful_reminder")])] };
  if (id === "segment") return { ...base, triggerType: "company_segment_changed", triggerConfig: { segment: "", reentryMode: "no_reentry" }, steps: [email("welcome_intro"), wait(3), replyExit()] };
  if (id === "category") return { ...base, triggerType: "category_changed", triggerConfig: { category: "Interested", reentryMode: "after_period", reentryAfterAmount: 1, reentryAfterUnit: "days" }, steps: [action("create_task", { title: "Respond to interested customer", priority: "high", dueInDays: 0 }), action("internal_alert", { message: "A customer email has been marked Interested." })] };
  return base;
}
