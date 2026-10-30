"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCheck, ChevronDown, Download, Eye, FileText, LoaderCircle, Mail, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { invoiceLabel, invoiceTotals, formatMoney } from "@/lib/invoices";
import { workflowLabels, workflowSendBlockers, type TaskWorkflowSummary, type TaskWorkflowDetail, type TaskWorkAction } from "@/lib/task-workflows";

function InvoicePdfPreview({ invoiceId, revision, label }: { invoiceId: string; revision: number; label: string }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    async function load() {
      try {
        const response = await fetch(`/api/invoices/${invoiceId}/pdf?inline=1`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Unable to load the PDF. Try downloading it or refresh the task.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load the PDF."); }
    }
    void load();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [invoiceId, revision]);
  return error ? <p role="alert" className="rounded-lg border p-3 text-xs">{error}</p> : url ? <iframe title={`${label} PDF preview`} src={`${url}#toolbar=0`} className="h-[460px] w-full rounded-lg border bg-muted" /> : <p role="status" className="flex items-center gap-2 rounded-lg border p-6 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading PDF…</p>;
}

export function TaskWorkPanel({ taskId, summary, selected = false, compact = false }: { taskId: string; summary: TaskWorkflowSummary; selected?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(selected);
  const [detail, setDetail] = useState<TaskWorkflowDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let reading = false;
    async function read() {
      if (reading || mutation.current) return;
      reading = true; setLoading(true);
      try {
        const response = await fetch(`/api/tasks/${taskId}/work`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to load the prepared work.");
        if (!controller.signal.aborted && !mutation.current) { setDetail(result); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load the task."); }
      finally { reading = false; if (!controller.signal.aborted) setLoading(false); }
    }
    void read();
    return () => controller.abort();
  }, [open, taskId, retry]);
  async function act(input: TaskWorkAction) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/work`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "The task action could not be confirmed.");
      setDetail(result);
      window.dispatchEvent(new Event("flow-activity-updated"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The task action could not be confirmed."); }
    finally { mutation.current = false; setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <DialogTrigger className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring ${compact ? "" : "mt-3"}`}><FileText className="size-3.5" />{workflowLabels[summary.kind]}{summary.status === "preparing" ? <LoaderCircle className="size-3 animate-spin" /> : <ChevronDown className="size-3" />}</DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{workflowLabels[summary.kind]}</DialogTitle><DialogDescription>Review the prepared work, make any needed changes, and finish it here.</DialogDescription></DialogHeader>
      {error ? <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}<button type="button" disabled={busy} className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Refresh task</button></div> : null}
      {!detail && loading ? <p role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading prepared work…</p> : detail ? <TaskWorkContent key={`${detail.workflow.task_id}:${detail.workflow.revision}`} detail={detail} busy={busy} onAction={act} onRefresh={() => setRetry(value => value + 1)} /> : null}
    </DialogContent>
  </Dialog>;
}

function TaskWorkContent({ detail, busy, onAction, onRefresh }: { detail: TaskWorkflowDetail; busy: boolean; onAction: (input: TaskWorkAction) => Promise<void>; onRefresh: () => void }) {
  const { workflow: work, invoice, canAct } = detail;
  const [preview, setPreview] = useState(false);
  const [subject, setSubject] = useState(work.payload.subject ?? "");
  const [text, setText] = useState(work.payload.text ?? "");
  const [shipping, setShipping] = useState(invoice ? (invoice.document.shippingMinor / 100).toFixed(2) : "");
  const [issue, setIssue] = useState(false);
  const [changes, setChanges] = useState(work.payload.changes && Object.keys(work.payload.changes).length ? work.payload.changes : work.kind === "customer_details" && !work.payload.detailsApplied ? { shippingAddress: "", shippingRecipient: "", shippingPhone: "", address: "", taxId: "" } : {});
  const closed = detail.taskStatus !== "open" || work.status === "done";
  const sending = work.status === "sending" || work.status === "uncertain";
  const disabled = busy || !canAct || closed || sending;
  const dirty = subject !== (work.payload.subject ?? "") || text !== (work.payload.text ?? "");
  const blockers = workflowSendBlockers(work, invoice);
  const action = (input: Omit<TaskWorkAction, "revision">) => void onAction({ ...input, revision: work.revision } as TaskWorkAction);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-md px-2 py-1 text-xs font-medium ${closed ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : work.status === "blocked" || sending ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{closed ? "Completed" : sending ? "Check delivery" : work.status === "preparing" ? "Preparation queued" : work.status === "blocked" ? "Needs input" : "Ready for review"}</span><Button type="button" size="xs" variant="ghost" disabled={busy} onClick={onRefresh}><RefreshCw className="size-3" />Refresh</Button></div>
    {work.payload.summary ? <p data-no-translate className="text-sm leading-6 text-muted-foreground">{work.payload.summary}</p> : null}
    {closed && work.payload.deliveryResult ? <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm"><CheckCheck className="size-4 text-emerald-600" />Email accepted by the sending mailbox. The task is complete.</p> : null}
    {!closed && work.blockers.length ? <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm"><p className="font-medium">Needs your input</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5">{work.blockers.map(message => <li key={message}>{message}</li>)}</ul></div> : null}
    {work.payload.error ? <p role="alert" className="rounded-lg border p-3 text-xs leading-5 text-muted-foreground">{work.payload.error}</p> : null}
    {invoice ? <section className="space-y-3 rounded-xl border p-4" aria-label="Prepared invoice">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{invoiceLabel(invoice)} <span className="ml-1 text-xs font-normal text-muted-foreground">{invoice.status}</span></p><p data-no-translate className="mt-1 text-xs text-muted-foreground">{invoice.document.customerName}</p></div><p className="text-base font-semibold tabular-nums">{formatMoney(invoiceTotals(invoice.document).total, invoice.document.currency)}</p></div>
      <ul className="divide-y text-xs">{invoice.document.items.map((item, index) => <li key={index} className="flex justify-between gap-3 py-2"><span data-no-translate>{item.description} × {item.quantity}</span><span className="shrink-0 tabular-nums">{formatMoney(item.unitPriceMinor * item.quantity, invoice.document.currency)}</span></li>)}</ul>
      <p data-no-translate className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{invoice.document.shippingAddress || "Shipping address is missing"}</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="xs" variant="outline" onClick={() => setPreview(value => !value)}><Eye className="size-3.5" />{preview ? "Hide PDF" : "Preview PDF"}</Button><a href={`/api/invoices/${invoice.id}/pdf`} className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs hover:bg-muted"><Download className="size-3" />Download PDF</a><Link href={`/invoices/${invoice.id}`} className="inline-flex h-7 items-center rounded-md border px-2 text-xs hover:bg-muted">Edit invoice</Link></div>
      {preview ? <><InvoicePdfPreview key={`${invoice.id}:${invoice.revision}`} invoiceId={invoice.id} revision={invoice.revision} label={invoiceLabel(invoice)} /><a href={`/api/invoices/${invoice.id}/pdf?inline=1`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Open PDF in a new tab</a></> : null}
      {work.kind === "invoice_review" && !closed ? <form className="space-y-2 border-t pt-3" onSubmit={event => { event.preventDefault(); const amount = Number(shipping); if (/^\d+(?:\.\d{1,2})?$/.test(shipping) && Number.isFinite(amount)) void onAction({ action: "save_shipping", revision: work.revision, invoiceRevision: invoice.revision, shippingMinor: Math.round(amount * 100) }); }}>
        <label className="grid gap-1.5 text-xs font-medium">Confirmed shipping cost ({invoice.document.currency})<input aria-label="Confirmed shipping cost" required pattern="[0-9]+(\.[0-9]{1,2})?" inputMode="decimal" value={shipping} onChange={event => setShipping(event.target.value)} disabled={disabled || !detail.canEditInvoice} className="h-9 max-w-48 rounded-md border bg-background px-2 text-sm" /></label><p className="text-xs text-muted-foreground">Enter 0 only for agreed free shipping. Saving this amount does not send an email.</p><Button type="submit" size="xs" variant="outline" disabled={disabled || !detail.canEditInvoice}>{work.payload.shippingConfirmed ? "Update shipping cost" : "Confirm shipping cost"}</Button>
      </form> : null}
    </section> : null}
    {Object.keys(changes).length ? <section aria-label="Customer details from reply" className="space-y-3 rounded-xl border p-4"><h3 className="text-sm font-semibold">Customer details to review</h3><p className="text-xs text-muted-foreground">Review before saving these changes to the company profile.</p>{Object.entries(changes).map(([key, value]) => <label key={key} className="grid gap-1.5 text-xs font-medium">{({ shippingAddress: "Shipping address", shippingRecipient: "Recipient", shippingPhone: "Delivery phone", address: "Billing address", taxId: "Tax / VAT number" } as Record<string, string>)[key]}<textarea rows={key.toLowerCase().includes("address") ? 3 : 1} disabled={disabled} value={value} onChange={event => setChanges(previous => ({ ...previous, [key]: event.target.value }))} className="rounded-md border bg-background px-2 py-2 text-sm font-normal" /></label>)}<Button type="button" size="sm" variant="outline" disabled={disabled || !Object.values(changes).some(value => value?.trim())} onClick={() => void onAction({ action: "apply_details", revision: work.revision, changes: Object.fromEntries(Object.entries(changes).filter(([,value]) => value?.trim())) })}>Save customer details</Button></section> : work.payload.detailsApplied ? <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCheck className="size-3.5" />Customer details saved</p> : null}
    {work.payload.text ? <section className="space-y-3" aria-label="Prepared email"><h3 className="flex items-center gap-2 text-sm font-semibold"><Mail className="size-4" />Prepared email</h3><p className="text-xs text-muted-foreground">To: <span data-no-translate>{work.payload.recipient}</span></p><label className="grid gap-1.5 text-xs font-medium">Subject<input value={subject} disabled={disabled} onChange={event => setSubject(event.target.value)} maxLength={300} className="h-9 rounded-md border bg-background px-3 text-sm font-normal" /></label><label className="grid gap-1.5 text-xs font-medium">Message<textarea rows={7} value={text} disabled={disabled} onChange={event => setText(event.target.value)} maxLength={10000} className="rounded-md border bg-background px-3 py-2 text-sm font-normal leading-6" /></label>{dirty ? <Button type="button" size="sm" variant="outline" disabled={disabled || !subject.trim() || !text.trim()} onClick={() => void onAction({ action: "save_draft", revision: work.revision, subject, text })}>Save email draft</Button> : null}</section> : null}
    {work.payload.evidence ? <details className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer font-medium">Original customer reply</summary><p data-no-translate className="mt-3 whitespace-pre-wrap break-words leading-5 text-muted-foreground">{work.payload.evidence.text}</p></details> : null}
    {!closed ? <div className="space-y-3 border-t pt-4">
      {sending ? <Button type="button" disabled={busy || !canAct} onClick={() => action({ action: "check_delivery" })}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}Check delivery status</Button> : <>
        {invoice?.status === "draft" && detail.canIssue && work.kind === "invoice_review" ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={issue} onChange={event => setIssue(event.target.checked)} disabled={disabled} />Issue the invoice before sending</label> : null}
        {blockers.length ? <p className="text-xs leading-5 text-muted-foreground">{blockers.join(" ")}</p> : null}
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled || dirty || blockers.length > 0} onClick={() => void onAction({ action: "send", revision: work.revision, ...(invoice ? { invoiceRevision: invoice.revision } : {}), issue })}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}{work.kind === "payment_follow_up" ? "Send payment reminder" : invoice ? issue ? "Issue and send invoice" : invoice.status === "draft" ? "Send draft PDF" : "Send invoice PDF" : "Send reply"}</Button>
          {["reply_review", "customer_details"].includes(work.kind) ? <Button type="button" variant="outline" disabled={disabled || (work.kind === "customer_details" && !work.payload.detailsApplied)} onClick={() => action({ action: "complete" })}><CheckCheck className="size-4" />Finish review</Button> : null}
          <Button type="button" variant="outline" disabled={disabled} onClick={() => action({ action: "prepare" })}><RefreshCw className="size-4" />{work.status === "preparing" ? "Prepare now" : "Prepare again"}</Button>
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => void onAction({ action: "snooze", revision: work.revision, dueAt: new Date(Date.now() + 86400000).toISOString() })}>Remind me tomorrow</Button>
        </div>
      </>}
    </div> : null}
  </div>;
}
