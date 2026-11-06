"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { InvoicePaper } from "@/components/invoice-paper";
import { invoiceRequest } from "@/lib/invoice-client";
import type { Invoice } from "@/lib/invoices";
import "@/app/invoices/invoices.css";

export function OrderInvoicePreview({ invoiceId }: { invoiceId: string }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    invoiceRequest(`/api/invoices/${invoiceId}`, undefined, undefined, controller.signal).then(data => {
      if (!controller.signal.aborted) setInvoice(data.invoice);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load invoice preview."); });
    return () => controller.abort();
  }, [invoiceId]);
  if (error) return <p role="alert" className="p-4 text-sm text-destructive">{error}</p>;
  if (!invoice) return <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading invoice preview…</p>;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  return <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-muted/20 p-2 sm:p-5"><InvoicePaper invoice={invoice} today={today} /></div>;
}
