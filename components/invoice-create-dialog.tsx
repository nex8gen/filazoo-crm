"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InvoiceEditor } from "@/components/invoice-editor";
import { Button } from "@/components/ui/button";
import { invoiceContextUrl, invoiceRequest } from "@/lib/invoice-client";
import { formatMoney, invoiceLabel, invoiceStatus, type Invoice, type InvoiceDocument } from "@/lib/invoices";
import "@/app/invoices/invoices.css";

export type InvoiceEmailContext = {
  companyId?: string | null;
  email: string;
  threadId?: string;
  customerName?: string;
  target?: "reply" | "compose";
};

export function InvoiceCreateDialog({ context, onClose, onAttach }: {
  context: InvoiceEmailContext;
  onClose: () => void;
  onAttach: (invoiceId: string) => Promise<void>;
}) {
  const [seed, setSeed] = useState<InvoiceDocument | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [saved, setSaved] = useState<Invoice | null>(null);
  const [view, setView] = useState<"list" | "create" | "edit" | "saved">("list");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    invoiceRequest(invoiceContextUrl(context), undefined, "GET", controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const doc = result.document as InvoiceDocument;
        if (!doc.customerName && context.customerName && context.customerName !== "Direct email")
          doc.customerName = context.customerName;
        setSeed(doc);
        setInvoices(result.invoices ?? []);
        setView(result.invoices?.length ? "list" : "create");
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [context, attempt]);

  async function editInvoice(id: string) {
    setBusy(true);
    setError("");
    try {
      // Read the current status and revision before allowing an edit.
      const { invoice } = await invoiceRequest(`/api/invoices/${id}`) as { invoice: Invoice };
      setInvoices((old) => old.map((item) => item.id === id ? invoice : item));
      if (invoice.status !== "draft") {
        setError("This invoice has been issued or voided. Only drafts can be edited.");
        setView("list");
        return;
      }
      setEditing(invoice);
      setView("edit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load this invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(doc: InvoiceDocument) {
    setBusy(true);
    setError("");
    try {
      const { invoice } = editing && view === "edit"
        ? await invoiceRequest(`/api/invoices/${editing.id}`, { action: "save", revision: editing.revision, document: doc })
        : await invoiceRequest("/api/invoices", doc, "POST");
      setInvoices((old) => [invoice, ...old.filter((item) => item.id !== invoice.id)]);
      setSaved(invoice);
      setEditing(null);
      setView("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the draft. Reload it if another user changed it.");
    } finally {
      setBusy(false);
    }
  }

  async function attachPdf(id: string) {
    setBusy(true);
    setAttachingId(id);
    setError("");
    try {
      await onAttach(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to attach the invoice PDF.");
    } finally {
      setBusy(false);
      setAttachingId(null);
    }
  }

  const today = seed?.issueDate ?? "";
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="!max-h-[92dvh] !w-[calc(100vw-2rem)] !max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {view === "edit" && editing ? `Edit ${invoiceLabel(editing)}` :
              view === "saved" && saved ? `${invoiceLabel(saved)} saved` :
                view === "create" ? "Create invoice for this customer" : "Customer invoices"}
          </DialogTitle>
          <DialogDescription>
            {view === "list" ? "Invoices from this conversation appear first, followed by recent customer invoices. Edit drafts or create a new invoice." :
              view === "edit" ? "Update the existing draft. Issued invoices cannot be edited. Your email draft stays in place." :
                view === "saved" ? "The draft is saved. You can continue editing until it is issued." :
                  "Use CRM billing details and live product pricing. Your email draft stays in place."}
          </DialogDescription>
        </DialogHeader>
        <div className="invoice-workspace min-w-0 space-y-4">
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {!seed ? error ? <Button type="button" onClick={() => { setError(""); setAttempt((old) => old + 1); }}>Retry loading invoices</Button> :
            <p role="status" className="p-6 text-sm text-muted-foreground">Loading customer invoices…</p> : null}

          {seed && view === "list" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm"><p className="font-semibold">{seed.customerName || context.email}</p><p className="text-muted-foreground">{context.email}</p></div>
                <Button type="button" disabled={busy} onClick={() => { setError(""); setEditing(null); setView("create"); }}>Create new invoice</Button>
              </div>
              {invoices.length ? <ul className="space-y-3" aria-label="Existing customer invoices">
                {invoices.map((invoice) => (
                  <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{invoiceLabel(invoice)}</span><span className="rounded border px-2 py-0.5 text-xs capitalize">{invoiceStatus(invoice, today)}</span>
                        {context.threadId && (invoice.source_thread_id === context.threadId || invoice.document.sourceThreadId === context.threadId) ? <span className="text-xs font-medium text-primary">This conversation</span> : null}
                      </div>
                      <p className="text-sm">{invoice.document.customerName} · {formatMoney(invoice.total_minor, invoice.document.currency)}</p>
                      <p className="text-xs text-muted-foreground">Invoice date {invoice.document.issueDate} · Due {invoice.document.dueDate}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" disabled={busy} onClick={() => void attachPdf(invoice.id)} aria-label={`Attach PDF ${invoiceLabel(invoice)}`}>{attachingId === invoice.id ? "Preparing PDF…" : "Attach PDF"}</Button>
                      <Link href={`/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-lg border px-3 text-sm font-medium hover:bg-muted">View invoice</Link>
                      {invoice.status === "draft" ? <Button type="button" variant="outline" disabled={busy} onClick={() => void editInvoice(invoice.id)} aria-label={`Edit draft ${invoiceLabel(invoice)}`}>Edit draft</Button> : null}
                    </div>
                  </li>
                ))}
              </ul> : <p className="rounded-lg border p-6 text-sm text-muted-foreground">No invoices found for this customer yet.</p>}
              {seed.companyId ? <Link href={`/invoices?companyId=${seed.companyId}`} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium underline">View all customer invoices</Link> : null}
            </>
          ) : null}

          {seed && (view === "create" || (view === "edit" && editing)) ? (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setEditing(null); setView("list"); }}>Back to customer invoices</Button>
              <InvoiceEditor key={view === "edit" ? editing!.id : "new-invoice"} initial={view === "edit" ? editing!.document : seed} busy={busy}
                onCancel={() => { setError(""); setEditing(null); setView("list"); }} onSave={saveDraft} />
            </>
          ) : null}

          {view === "saved" && saved ? (
            <div className="space-y-4 rounded-lg border p-5">
              <p className="text-sm">Draft saved for <strong>{saved.document.customerName}</strong>.</p>
              <div className="flex flex-wrap gap-3">
                <Button type="button" disabled={busy} onClick={() => void attachPdf(saved.id)}>{attachingId === saved.id ? "Preparing PDF…" : "Attach PDF to email"}</Button>
                <Button type="button" disabled={busy} onClick={() => void editInvoice(saved.id)}>Continue editing draft</Button>
                <Link href={`/invoices/${saved.id}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium">Review invoice in new tab</Link>
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setError(""); setView("list"); }}>Customer invoices</Button>
                <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Return to email</Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
