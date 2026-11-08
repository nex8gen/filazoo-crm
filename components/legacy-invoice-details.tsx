"use client";

import Link from "next/link";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { PageActions } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { InvoicePaper } from "@/components/invoice-paper";
import { invoiceLabel, type Invoice } from "@/lib/invoices";
import "@/app/invoices/invoices.css";

/** Preserve saved invoice links without reintroducing independent billing creation. */
export function LegacyInvoiceDetails({ invoice, today }: { invoice: Invoice; today: string }) {
  const returnHref = invoice.company_id ? `/companies/${invoice.company_id}?tab=purchase-orders` : "/purchase-orders";
  return <div className="invoice-workspace space-y-4 pb-6">
    <PageActions><Button type="button" variant="outline" size="sm" onClick={() => window.print()}><Printer className="size-4" />Print</Button><a href={`/api/invoices/${invoice.id}/pdf`} className={buttonVariants({ variant: "outline", size: "sm" })}><Download className="size-4" />Download PDF</a></PageActions>
    <Link href={returnHref} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{invoice.company_id ? "Customer orders" : "Purchase orders"}</Link>
    <div><h2 className="text-lg font-semibold">{invoiceLabel(invoice)}</h2><p className="mt-1 text-sm text-muted-foreground">Historical invoice · read-only. New invoices are managed from purchase orders.</p></div>
    <InvoicePaper invoice={invoice} today={today} />
  </div>;
}
