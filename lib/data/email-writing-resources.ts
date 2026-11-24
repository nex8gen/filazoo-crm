import "server-only";
import type { WorkspaceViewer } from "../auth";
import { restrictedAiContext, type AiPolicy } from "../ai-policy";
import { createSupabaseAdmin } from "../supabase/admin";
import { readEmailCustomerContext } from "./email-customer-context";
import { loadSummaryCatalog, summaryProductContext } from "../ai/email-summary-products";

/** Only read resources allowed for this user and this authorized correspondent. */
export async function loadEmailWritingResources(viewer: WorkspaceViewer, mailboxId: string, recipient: string, policy: AiPolicy) {
  const db = createSupabaseAdmin();
  const restricted = restrictedAiContext(policy);
  const [customer, catalog, knowledge] = await Promise.all([
    policy.data.customers ? readEmailCustomerContext(viewer, mailboxId, recipient) : null,
    loadSummaryCatalog(policy.data.products, async () => {
      const { listProducts } = await import("./crm");
      return listProducts(undefined, { requireComplete: true });
    }),
    policy.data.knowledge ? db.from("email_reply_knowledge").select("title,content").order("created_at").limit(101).throwOnError() : { data: [] },
  ]);
  if ((knowledge.data?.length ?? 0) > 100) throw new Error("Business knowledge is too large for a reliable follow-up. Review this conversation manually.");
  const profile = customer?.customerProfile;
  const companyId = customer?.companyId;
  // Notes can refer to other data categories. Withhold free text under a restricted policy.
  const { data: tasks } = policy.data.tasks && companyId && !restricted
    ? await db.from("crm_tasks").select("title,notes,status,due_at").eq("company_id", companyId).eq("status", "open")
      .eq("assigned_to", viewer.id).order("created_at", { ascending: false }).limit(51).throwOnError()
    : { data: [] };
  if ((tasks?.length ?? 0) > 50) throw new Error("This customer has too many open tasks for a reliable follow-up. Review their agenda manually.");
  return {
    customerProfile: profile ? { companyName: profile.companyName, contactName: profile.contactName, country: profile.country,
      ...(!restricted ? { summary: profile.summary, interests: profile.interests } : {}) } : null,
    productCatalog: summaryProductContext(catalog),
    approvedBusinessFacts: { status: policy.data.knowledge ? "available" : "disabled", records: knowledge.data ?? [] },
    openCustomerTasks: { status: !policy.data.tasks || !policy.data.customers || restricted ? "disabled" : companyId ? "available" : "no_linked_customer", scope: "assigned_to_current_user", records: tasks ?? [] },
  };
}
