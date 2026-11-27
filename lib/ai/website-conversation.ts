import "server-only";
import { z } from "zod";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin";
import { requireAiData } from "../data/ai-settings";
import { assertAiCustomerAccess, AiCustomerAccessError } from "./customer-access.ts";

export async function loadWebsiteConversationForAi(conversationId: string, viewer?: WorkspaceViewer) {
  if (!viewer) throw new AiCustomerAccessError("Sign in to access this customer conversation.");
  await requireAiData("customers", "emails");
  const id = conversationId.slice(4);
  if (!z.uuid().safeParse(id).success) throw new Error("The selected conversation is unavailable.");
  const db = createSupabaseAdmin();
  const { data: invoice, error: invoiceError } = await db.from("invoices").select("id,status,company_id").eq("id", id).maybeSingle();
  if (invoiceError || !invoice || invoice.status === "draft") throw new Error("The selected conversation is unavailable.");
  if (viewer.role !== "admin") {
    if (!invoice.company_id) throw new AiCustomerAccessError("This conversation has no verified customer assignment.");
    await assertAiCustomerAccess(viewer, invoice.company_id, db);
  }
  const [customer, messages] = await Promise.all([
    db.from("invoices").select("customer_name:document->>customerName").eq("id", id).maybeSingle(),
    db.from("customer_portal_messages").select("id,sender,body,created_at").eq("invoice_id", id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25),
  ]);
  if (customer.error || messages.error) throw new Error("Unable to read the selected conversation.");
  return { id: conversationId, customer: String(customer.data?.customer_name || "Customer"), channel: "web" as const, replyWindowOpen: true,
    messages: [...(messages.data ?? [])].reverse().map((message) => ({ id: message.id, direction: message.sender === "customer" ? "inbound" : "outbound", text: message.body, truncated: false, timestamp: message.created_at })),
    coverage: "up to 25 recent saved customer portal messages" };
}

