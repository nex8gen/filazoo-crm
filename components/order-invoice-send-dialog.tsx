"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mail } from "lucide-react";
import { invoiceRequest } from "@/lib/invoice-client";
import { formatMoney, invoiceLabel, type Invoice } from "@/lib/invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type SendContext = { invoice: Invoice; canIssue: boolean; mailboxes: { id: string; email: string }[] };

export function OrderInvoiceSendDialog({ invoiceId, orderStatus, onClose, onSent }: {
  invoiceId: string;
  orderStatus: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [context, setContext] = useState<SendContext | null>(null);
  const [to, setTo] = useState("");
  const [mailboxId, setMailboxId] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const submitted = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    invoiceRequest(`/api/invoices/${invoiceId}/send`, undefined, undefined, controller.signal).then((data: SendContext) => {
      if (controller.signal.aborted) return;
      setContext(data);
      setTo(data.invoice.document.customerEmail);
      setMailboxId(data.mailboxes[0]?.id || "");
      setSubject(`Invoice ${invoiceLabel(data.invoice)}`);
      setText(`Hello ${data.invoice.document.customerName},\n\nPlease find attached invoice ${invoiceLabel(data.invoice)} for your order.\n\nTotal: ${formatMoney(data.invoice.total_minor, data.invoice.document.currency)}\n\nThank you.`);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load invoice email details."); });
    return () => controller.abort();
  }, [invoiceId]);
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError("");
    try {
      let invoice = context.invoice;
      if (invoice.status === "draft") {
        const result = await invoiceRequest(`/api/invoices/${invoiceId}`, { action: "issue", revision: invoice.revision });
        invoice = result.invoice;
        setContext({ ...context, invoice });
      }
      requestId.current ??= crypto.randomUUID();
      const result = await invoiceRequest(`/api/invoices/${invoiceId}/send`, { requestId: requestId.current, revision: invoice.revision, mailboxId, to, subject, text }, "POST");
      onSent(`Invoice sent to ${to}.${result.providerWarning ? ` ${result.providerWarning}` : ""}${result.trackingWarning ? ` ${result.trackingWarning}` : ""}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to send invoice. Check Sent before trying again.");
    } finally { setBusy(false); submitted.current = false; }
  }
  const draft = context?.invoice.status === "draft";
  const blocked = !context || context.invoice.status === "void" || !context.mailboxes.length || (draft && (!context.canIssue || ["draft", "cancelled"].includes(orderStatus)));
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="sm:max-w-xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Send invoice</DialogTitle><DialogDescription>Review the email below. The invoice PDF will be attached.</DialogDescription></DialogHeader>
      {!context && !error ? <p role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading invoice email…</p> : null}
      <form onSubmit={event => void send(event)} className="space-y-4">
        <fieldset disabled={busy || !context} className="space-y-4 disabled:opacity-60">
          <label className="block space-y-1.5 text-xs font-medium"><span>From</span><select required value={mailboxId} onChange={event => { setMailboxId(event.target.value); requestId.current = null; }} className="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="" disabled>Choose a sending mailbox</option>{context?.mailboxes.map(mailbox => <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>)}</select></label>
          <label className="block space-y-1.5 text-xs font-medium"><span>To</span><Input type="email" required value={to} onChange={event => { setTo(event.target.value); requestId.current = null; }} /></label>
          <label className="block space-y-1.5 text-xs font-medium"><span>Subject</span><Input required maxLength={300} value={subject} onChange={event => { setSubject(event.target.value); requestId.current = null; }} /></label>
          <label className="block space-y-1.5 text-xs font-medium"><span>Message</span><Textarea required maxLength={20000} rows={7} value={text} onChange={event => { setText(event.target.value); requestId.current = null; }} /></label>
        </fieldset>
        {context ? <p className="text-xs text-muted-foreground"><span>Attachment:</span> <span data-no-translate>{invoiceLabel(context.invoice)}.pdf</span> · {formatMoney(context.invoice.total_minor, context.invoice.document.currency)}</p> : null}
        {context && !context.mailboxes.length ? <p className="text-sm text-muted-foreground">Add an active sending mailbox in Settings before sending.</p> : null}
        {draft ? <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5">{!context?.canIssue ? "An admin or operator must issue this draft before it can be sent." : ["draft", "cancelled"].includes(orderStatus) ? "Confirm the purchase order before issuing and sending its invoice." : "Sending will issue this draft and lock the order’s products, prices, customer details, and currency. Review the PDF before continuing."}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || blocked}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Mail className="size-4" />}{busy ? "Sending…" : draft ? "Issue & send invoice" : "Send invoice"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
