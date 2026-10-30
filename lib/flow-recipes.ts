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
  { id: "inbound", title: "Respond to an inquiry", description: "AI answers a received email, then checks for a reply before assigning follow-up work.", trigger: "Email received" },
  { id: "qualification", title: "Qualify and route leads", description: "Route by fit score, then by market. Update the company, assign a task and notify its owner.", trigger: "New lead" },
  { id: "followup", title: "Follow up without a reply", description: "Send a reminder after two days without a reply, wait, then hand off to a teammate.", trigger: "No reply after" },
  { id: "shopify", title: "Welcome Shopify leads", description: "Send the catalog to new Shopify B2B leads and follow up according to engagement.", trigger: "Lead added to list" },
  { id: "meta", title: "Welcome Meta leads", description: "Introduce the business, wait for engagement, and create a task for interested leads.", trigger: "Lead added to list" },
  { id: "segment", title: "Nurture a customer segment", description: "Send a tailored introduction when a company enters your chosen segment.", trigger: "Company enters segment" },
  { id: "category", title: "Respond to buying interest", description: "Create an urgent task and an internal alert when an email is marked Interested.", trigger: "Category changed to" },
] as const;

/** New independent identities on every use. Recipes are always drafts. */
export function createFlowRecipe(id: string): FlowInput {
  const base: FlowInput = { name: flowRecipeOptions.find((item) => item.id === id)?.title || "Untitled flow", triggerType: "new_lead", triggerConfig: {}, status: "draft", steps: [] };
  const replyExit = () => split("Has the customer replied?", { field: "customer_replied" }, [action("stop", { reason: "Customer replied" })], [action("create_task")]);
  if (id === "inbound") return { ...base, triggerType: "email_received", steps: [action("ai_auto_reply"), wait(2), replyExit()] };
  if (id === "qualification") return { ...base, steps: [split("Lead qualification", { field: "fit_score_at_least", fitScore: 7 }, [updateCompany({ companyStatus: "qualified" }), split("Priority market", { field: "country_is", value: "US" }, [action("create_task", { priority: "high", title: "Contact priority buyer" }), action("internal_alert", { message: "A priority buyer is ready for follow-up." })], [action("create_task", { title: "Review qualified buyer" })])], [email("welcome_intro"), wait(2), replyExit()])] };
  if (id === "followup") return { ...base, triggerType: "no_reply", triggerConfig: { amount: 2, unit: "days", businessDays: true }, steps: [email("helpful_reminder"), wait(3), replyExit()] };
  if (id === "shopify" || id === "meta") return { ...base, triggerType: "lead_added_to_list", triggerConfig: { listId: id === "shopify" ? "Shopify B2B leads" : "Meta ad leads", reentryMode: "no_reentry" }, steps: [email(id === "shopify" ? "send_catalog" : "welcome_intro"), wait(2), split("Customer engagement", { match: "any", rules: [{ field: "customer_replied" }, { field: "clicked_link" }] }, [action("create_task", { priority: "high" })], [email("helpful_reminder")])] };
  if (id === "segment") return { ...base, triggerType: "company_segment_changed", triggerConfig: { segment: "", reentryMode: "no_reentry" }, steps: [email("welcome_intro"), wait(3), replyExit()] };
  if (id === "category") return { ...base, triggerType: "category_changed", triggerConfig: { category: "Interested", reentryMode: "after_period", reentryAfterAmount: 1, reentryAfterUnit: "days" }, steps: [action("create_task", { title: "Respond to interested customer", priority: "high", dueInDays: 0 }), action("internal_alert", { message: "A customer email has been marked Interested." })] };
  return base;
}
