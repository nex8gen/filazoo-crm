"use server";

import { z } from "zod";
import { requireWorkspaceMember } from "@/lib/auth";
import { getPurchaseOrderProfile } from "@/app/purchase-order-actions";
import { getInvoiceDefaults } from "@/lib/data/invoice-defaults";
import { invoiceDocumentWithDefaults } from "@/lib/invoice-defaults";
import { orderBillingFromInvoice } from "@/lib/purchase-order-billing";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

/** Fetch fresh customer details only when staff open the company order panel. */
export async function loadCompanyPurchaseOrderDraft(companyId: string) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  z.uuid().parse(companyId);
  const query = createSupabaseAdmin().from("companies")
    .select(viewer.role === "bd_manager" ? "id,pipeline!inner(owner_id)" : "id")
    .eq("id", companyId).or("source.is.null,source.neq.sample_seed");
  if (viewer.role === "bd_manager") query.eq("pipeline.owner_id", viewer.id);
  const { data: company, error } = await query.maybeSingle();
  if (error || !company) throw new Error("This company is unavailable for order creation.");
  const [profile, settings] = await Promise.all([getPurchaseOrderProfile(companyId), getInvoiceDefaults()]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const billing = orderBillingFromInvoice(invoiceDocumentWithDefaults(today, { ...settings.seller, defaults: settings.defaults }));
  return { profile, billing, today };
}
