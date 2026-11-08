import type { WorkspaceAction } from "./workspace-assistant.ts";

/** A compound commerce request must not be declared ready after only its first step. */
export function assertWorkflowCoverage(actions: WorkspaceAction[], context?: { messages?: ReadonlyArray<{ role: string; content: string }> }) {
  if (actions.some(action => action.type === "run_workflow")) {
    if (actions.length !== 1) throw new Error("Put every requested action inside one workflow; do not stage separate actions alongside it.");
    return;
  }
  const text = context?.messages?.filter(message => message.role === "user").at(-1)?.content ?? "";
  // Saved-order workflows may already have a real invoice ID. Never force a
  // second order merely because the user also requests its invoice email.
  if (/\b(?:from|using|against)\s+(?:(?:the|this|an?|existing|saved)\s+){0,4}(?:(?:purchase|sales)\s+)?order\b|\bfor\s+(?:(?:the|this|existing|saved)\s+){0,3}(?:PO\s*#|order\s*#|order\s+number)/i.test(text)) return;
  if (!/\b(?:create|make|place)\b[\s\S]{0,100}\b(?:order|invoice|invioce)\b|\bprepare\s+(?:(?:a|an|new|draft)\s+){0,3}(?:order|invoice)\b/i.test(text)
    || !/\binvoic(?:e|es)\b/i.test(text)
    || !/\b(?:email|emial|e-mail|mail)\b/i.test(text)
    || !/\b(?:send|draft|write|attach|email|mail)\b[\s\S]{0,100}\b(?:invoice|email|emial|pdf)\b/i.test(text)
    || /\b(?:no|without)\s+(?:an?\s+)?(?:email|mail)\b/i.test(text)) return;
  const workflow = actions.find(action => action.type === "create_order" || action.type === "create_invoice");
  if (!workflow || !("email" in workflow && workflow.email)) throw new Error("This request includes a new order/invoice AND its invoice email. Prepare one create_order or create_invoice action containing the requested email. The server saves the order, resolves its generated invoice ID and attaches its PDF; do not stop after saving only the order or invent future IDs.");
  if (actions.some(action => action.type === "crm_action" && ["save_order", "invoice_order"].includes(action.operation.op)) || actions.some(action => action.type === "write_email" || action.type === "send_invoice")) throw new Error("Use the email inside the new order/invoice workflow. Remove the separate order/invoice/email actions to avoid creating or sending duplicates.");
}
