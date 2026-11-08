import { writeFileSync } from "node:fs";
import { agentCapabilities, guidedAgentFeatures, AGENT_CONTRACT_VERSION } from "../lib/ai/capabilities.ts";
import { crmMutationSurfaces } from "../lib/ai/surface-audit.ts";

const actions: Record<string, string[]> = {
  addCompanyComment: ["add_company_note"], createCompany: ["create_company"], updateCompanyFields: ["update_company"], updateCompany: ["update_company"], bulkUpdateCompanies: ["delete_company"], assignPipelineOwner: ["assign_owner"], scheduleCompanyFollowup: ["schedule_followup"], createEmailDraft: ["write_email"], createCatalog: ["create_quotation"], createProduct: ["create_product"], updateProduct: ["update_product"], syncInventory: ["sync_inventory"], createSegment: ["create_segment"], updateSegment: ["update_segment"], savePurchaseOrder: ["save_order"], createOrderInvoice: ["invoice_order"], manageMailbox: ["manage_mailbox"], updateProfile: ["update_profile"], inviteMember: ["invite_member"], updateMemberRole: ["update_member"], updateMember: ["update_member"], deleteMember: ["delete_member"], saveUserPreferences: ["save_preferences"], updateAiSettings: ["update_ai_settings"],
};
const routes: Record<string, string[]> = {
  "app/api/invoices/[id]/send/route.ts": ["send_invoice"],
  "app/api/catalogs/[id]/quotation/route.ts": ["update_quotation", "quotation_lifecycle"], "app/api/tasks/[id]/work/route.ts": ["task_workflow_action"], "app/api/email/state/route.ts": ["set_email_state"], "app/api/email/auto-reply/route.ts": ["conversation_auto_reply", "approve_auto_reply_shipping"], "app/api/email/auto-reply/knowledge/route.ts": ["add_business_fact", "delete_business_fact"], "app/api/email/footer/route.ts": ["update_email_footer"], "app/api/invoices/[id]/portal/route.ts": ["portal_reply", "update_shipment"], "app/api/invoices/billing/route.ts": ["invoice_defaults", "payment_methods"], "app/api/invoices/[id]/route.ts": ["update_invoice", "invoice_lifecycle"], "app/api/invoices/route.ts": ["create_invoice"], "app/api/meta/send/route.ts": ["send_message"], "app/api/flows/route.ts": ["create_flow"], "app/api/flows/[id]/route.ts": ["update_flow", "delete_flow"], "app/api/flows/bulk/route.ts": ["flow_status", "duplicate_flow", "delete_flow"], "app/api/flows/activity/route.ts": ["complete_activity"], "app/api/ai/reply-requests/route.ts": ["cancel_reply_request"],
};
const internal = /app\/api\/(?:ai\/(?:assistant|history|usage)|companies\/\[id\]\/chat|email\/(?:assist|reply)|agent\/demo|automation\/diagnose|cron\/|shopify\/|meta\/(?:webhook|lead-bridge)|twilio\/|customer\/|invoices\/\[id\]\/customer|flows\/(?:process|track))/;
const surfaces = crmMutationSurfaces(process.cwd()).map(surface => {
  const [file, action] = surface.split("#");
  let tools = actions[action] ?? routes[file];
  if (file === "app/api/email/scheduled/route.ts" && action === "DELETE") tools = ["cancel_scheduled_email"];
  if (file === "app/api/email/drafts/route.ts" && action === "DELETE") tools = ["discard_email_draft"];
  if (file === "app/api/email/drafts/route.ts" && action === "PUT") tools = ["write_email"];
  if (file === "app/api/flows/check/route.ts") return { surface, mode: "read", tools: [], explanation: "Authenticated, read-only workflow connection and resource checks. Uses live dependencies without generating content, sending messages or changing CRM records." };
  if (tools) return { surface, mode: "direct", tools, explanation: "Typed proposals use the same validated business service; role/policy and review still apply." };
  if (action === "updateAiUsageSettings") return { surface, mode: "internal", tools: [], explanation: "Retained legacy budget settings helper. Application usage limits and their Settings controls have been removed." };
  if (internal.test(file)) return { surface, mode: "internal", tools: [], explanation: "Agent/history infrastructure, inbound integration, customer-only identity or background worker; not an employee feature to invoke arbitrarily." };
  if (/^(?:get|load|search|list)/.test(action)) return { surface, mode: "read", tools: [], explanation: "Read-only UI helper; agent uses permission-scoped read_records/search_customer_emails instead." };
  return { surface, mode: "guided", tools: [], explanation: /auth|login|signup|password|invitation|join|workspaces|team-actions|signOut/.test(file + action) ? "Identity, workspace or ownership flow uses the authenticated account controls." : /image|avatar|Mailbox|Connection|erp/i.test(file + action) ? "Connection credentials, uploads or connection testing use the relevant settings/file form." : "Specialized UI test, composition or analysis flow; use its page controls. The agent must provide a handoff and must not claim it executed this feature." };
});
const capabilities = agentCapabilities().map(({ name, domain, description }) => ({ name, domain, description }));
writeFileSync("docs/agent-capability-audit.json", JSON.stringify({ contractVersion: AGENT_CONTRACT_VERSION, generatedOn: "2026-11-08", capabilities, guidedFeatures: guidedAgentFeatures, surfaces }, null, 2) + "\n");
console.log(JSON.stringify({ capabilities: capabilities.length, surfaces: surfaces.length, modes: Object.fromEntries(["direct", "guided", "read", "internal"].map(mode => [mode, surfaces.filter(surface => surface.mode === mode).length])) }));
