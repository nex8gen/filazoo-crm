"use client";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TablePagination } from "@/components/ui/table-pagination";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { InvoiceEditor } from "@/components/invoice-editor";
import { invoiceRequest as api, invoiceContextUrl } from "@/lib/invoice-client";
import { InvoicePaper } from "@/components/invoice-paper";
import { InvoicePortalShortcut } from "@/components/invoice-portal-shortcut";
import { InvoiceCreator } from "@/components/invoice-creator";
import { canEditInvoice, canManageBilling } from "@/lib/invoice-permissions";
import {
  formatMoney,
  invoiceLabel,
  invoiceStatus,
  type Invoice,
  type InvoiceDocument,
  type InvoiceReceivable,
} from "@/lib/invoices";
import "@/app/invoices/invoices.css";

type Listing = {
  invoices: Invoice[];
  count: number;
  summary?: InvoiceReceivable[];
};

export function InvoiceWorkspace({
  initial,
  initialSelected = null,
  initialEditor = null,
  companyId,
  initialError,
  canWrite,
  invoiceViewer,
  today,
}: {
  initial: Listing;
  initialSelected?: Invoice | null;
  initialEditor?: InvoiceDocument | null;
  companyId?: string;
  initialError: string;
  canWrite: boolean;
  invoiceViewer: { id: string; role: string };
  today: string;
}) {
  const router = useRouter();
  const [listing, setListing] = useState(initial);
  const [selected, setSelected] = useState<Invoice | null>(initialSelected);
  const [editor, setEditor] = useState<InvoiceDocument | null>(initialEditor);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ search: "", status: "" });
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      void api(`/api/invoices?page=${page}&search=${encodeURIComponent(appliedFilters.search)}&status=${appliedFilters.status}${companyId ? `&companyId=${companyId}` : ""}`, undefined, "GET", controller.signal).then(setListing).catch(() => {});
      if (selected?.id) void api(`/api/invoices/${selected.id}`, undefined, "GET", controller.signal).then((result) => setSelected(result.invoice)).catch(() => {});
    };
    window.addEventListener("filazoo:agent-action", refresh);
    return () => { controller.abort(); window.removeEventListener("filazoo:agent-action", refresh); };
  }, [page, appliedFilters, companyId, selected?.id]);
  const [confirm, setConfirm] = useState<"issue" | "void" | "delete" | null>(
    null,
  );
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  async function load(nextPage = page, filters = appliedFilters) {
    const result = await api(
      `/api/invoices?page=${nextPage}&search=${encodeURIComponent(filters.search)}&status=${filters.status}${companyId ? `&companyId=${companyId}` : ""}`,
    );
    setListing(result);
    setPage(nextPage);
    setAppliedFilters(filters);
  }
  async function open(id: string) {
    const result = await api(`/api/invoices/${id}`);
    setSelected(result.invoice);
    setEditor(null);
    setConfirm(null);
  }
  async function save(document: InvoiceDocument) {
    await run(async () => {
      const result = selected
        ? await api(`/api/invoices/${selected.id}`, {
            action: "save",
            revision: selected.revision,
            document,
          })
        : await api("/api/invoices", document, "POST");
      setSelected(result.invoice);
      setEditor(null);
      setNotice("Draft saved.");
      if (initialEditor) router.replace(`/invoices/${result.invoice.id}`);
    });
  }
  async function transition(action: "issue" | "void" | "delete") {
    if (!selected) return;
    await run(async () => {
      const result = await api(`/api/invoices/${selected.id}`, {
        action,
        revision: selected.revision,
      });
      setConfirm(null);
      setSelected(result.invoice);
      setNotice(
        action === "issue"
          ? "Invoice issued. Download the PDF to share it with your customer."
          : action === "void"
            ? "Invoice voided."
            : "Draft deleted.",
      );
      if (action === "delete") {
        if (initialSelected) router.push("/invoices");
        else await load(0);
      }
    });
  }
  const selectedStatus = selected ? invoiceStatus(selected, today) : "";
  const canEditSelected = Boolean(selected && canEditInvoice(invoiceViewer, selected));
  const canManage = canWrite && canManageBilling(invoiceViewer.role);
  const summary = listing.summary ?? [];
  function cancelEditor() {
    if (initialEditor && !selected)
      router.push(companyId ? `/invoices?companyId=${companyId}` : "/invoices");
    else setEditor(null);
  }
  return (
    <div data-ai-invoice-id={selected?.id} data-ai-company-id={selected?.document.companyId || editor?.companyId || companyId} className="invoice-workspace mx-auto w-full max-w-7xl space-y-6 p-5 pb-12 sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Billing
          </p>
          <h1 className="text-2xl font-semibold">
            {editor
              ? selected
                ? `Edit ${invoiceLabel(selected)}`
                : "New invoice"
              : selected
                ? invoiceLabel(selected)
                : "Invoices"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {editor
              ? "Save a draft, review it, then issue when ready."
              : selected
                ? "Invoice details, balance and payment history."
                : "Create invoices and keep track of what you’re owed."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected || editor ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (editor) {
                  cancelEditor();
                  if (!selected) void run(() => load());
                } else {
                  if (initialSelected) {
                    router.push("/invoices");
                    return;
                  }
                  setSelected(null);
                  setConfirm(null);
                  void run(() => load());
                }
              }}
            >
              <ArrowLeft />
              Back
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => load())}
              >
                <RefreshCw className={busy ? "animate-spin" : ""} />
                Refresh
              </Button>
              {canWrite ? (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setSelected(null);
                      const seed = await api(invoiceContextUrl({ companyId }));
                      setEditor(seed.document);
                    })
                  }
                >
                  <Plus />
                  New invoice
                </Button>
              ) : null}
            </>
          )}
        </div>
      </header>
      {(selected?.document.purchaseOrderId || editor?.purchaseOrderId) && <div className="rounded-lg border bg-muted/30 p-4 text-sm">Linked customer order: <Link className="font-medium text-primary underline" href={`/companies/${(editor ?? selected?.document)?.companyId}?tab=purchase-orders`}>{(editor ?? selected?.document)?.reference || "View order"}</Link>. Invoice quantities and payments are tracked against this order.</div>}
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border bg-muted/40 p-4 text-sm">
          {notice}
        </p>
      ) : null}
      {editor ? (
        <InvoiceEditor
          initial={editor}
          busy={busy}
          onSave={save}
          onCancel={cancelEditor}
        />
      ) : selected ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
            <span className="font-medium">
              {selected.document.customerName}
            </span>
            {selected.company_id ? (
              <>
                <Link
                  href={`/companies/${selected.company_id}`}
                  className="text-primary underline"
                >
                  Customer profile
                </Link>
                <Link
                  href={`/invoices?companyId=${selected.company_id}`}
                  className="text-primary underline"
                >
                  Customer invoice history
                </Link>
              </>
            ) : null}
            {selected.source_thread_id ? (
              <Link
                href={`/emails?thread=${encodeURIComponent(selected.source_thread_id)}`}
                className="text-primary underline"
              >
                Email conversation
              </Link>
            ) : null}
            <Link
              href={`/invoices/${selected.id}`}
              className="ml-auto text-primary underline"
            >
              Permanent invoice link
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Status value={selectedStatus} />
            <span className="mr-auto text-sm text-muted-foreground">
              {formatMoney(
                selected.status === "void"
                  ? 0
                  : selected.total_minor - selected.paid_minor,
                selected.document.currency,
              )}{" "}
              outstanding
            </span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => open(selected.id))}
            >
              Reload
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer />
              Print / Save PDF
            </Button>
            {canWrite && canEditSelected ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setEditor(selected.document)}
              >
                Edit draft
              </Button>
            ) : null}
            {canManage && selected.status === "draft" ? (
              <>
                <Button disabled={busy} onClick={() => setConfirm("issue")}>
                  Issue invoice
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() => setConfirm("delete")}
                >
                  Delete draft
                </Button>
              </>
            ) : null}
            {canManage &&
            selected.status === "issued" &&
            selected.paid_minor === 0 ? (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirm("void")}
              >
                Void invoice
              </Button>
            ) : null}
          </div>
          {confirm ? (
            <section
              role="alertdialog"
              aria-labelledby="invoice-confirm-title"
              aria-describedby="invoice-confirm-description"
              className="space-y-3 rounded-xl border border-amber-400/50 bg-amber-400/5 p-5"
            >
              <h2 id="invoice-confirm-title" className="font-semibold">
                {confirm === "issue"
                  ? "Issue this invoice?"
                  : confirm === "void"
                    ? "Void this invoice?"
                    : "Delete this draft?"}
              </h2>
              <p
                id="invoice-confirm-description"
                className="text-sm text-muted-foreground"
              >
                {confirm === "issue"
                  ? "The invoice details will be locked. This records the invoice as issued; it does not send an email."
                  : confirm === "void"
                    ? "This invoice will remain in your records but no longer count as receivable."
                    : "The draft will be permanently removed. Its invoice number will not be reused."}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void transition(confirm)}
                >
                  {busy ? "Working…" : "Confirm"}
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => setConfirm(null)}
                >
                  Cancel
                </Button>
              </div>
            </section>
          ) : null}
          <InvoicePaper invoice={selected} today={today} />
          {selected.status !== "draft" && <InvoicePortalShortcut key={selected.id} id={selected.id} companyId={selected.company_id} customerName={selected.document.customerName} canWrite={canWrite && invoiceViewer.role !== "viewer"} />}
          <section className="rounded-xl border p-5">
            <h2 className="font-semibold">Payments</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Record money received outside the CRM. Currency:{" "}
              {selected.document.currency}.
            </p>
            {selected.invoice_payments?.length ? (
              <ul className="mt-4 divide-y">
                {[...selected.invoice_payments]
                  .sort((a, b) => b.paid_on.localeCompare(a.paid_on))
                  .map((payment) => (
                    <li
                      key={payment.id}
                      className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                    >
                      <div>
                        <p>
                          {payment.paid_on} ·{" "}
                          {payment.method.replaceAll("_", " ")}
                        </p>
                        <p className="text-muted-foreground">
                          {payment.reference || "No reference"}
                        </p>
                      </div>
                      <strong>
                        {formatMoney(
                          payment.amount_minor,
                          selected.document.currency,
                        )}
                      </strong>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="my-4 text-sm text-muted-foreground">
                No payments recorded.
              </p>
            )}
            {canManage &&
            selected.status === "issued" &&
            selected.paid_minor < selected.total_minor ? (
              <PaymentForm
                key={`${selected.id}-${selected.revision}`}
                invoice={selected}
                busy={busy}
                today={today}
                onSubmit={(payment) =>
                  run(async () => {
                    await api(`/api/invoices/${selected.id}`, {
                      action: "payment",
                      payment,
                    });
                    await open(selected.id);
                    setNotice("Payment recorded.");
                  })
                }
              />
            ) : null}
          </section>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Invoices"
              value={String(listing.count)}
              detail="Matching current search & status"
            />
            <Metric
              label="Outstanding"
              value={
                summary
                  .map((row) =>
                    formatMoney(row.outstanding_minor, row.currency),
                  )
                  .join(" · ") || "—"
              }
              detail="All matching invoices, grouped by currency"
            />
            <Metric
              label="Overdue balance"
              value={
                summary
                  .map((row) => formatMoney(row.overdue_minor, row.currency))
                  .join(" · ") || "—"
              }
              detail="All matching unpaid invoices past their due date"
            />
          </div>
          <TableFilters disabled={busy} onApply={() => void run(() => load(0, { search, status }))}>
            <TableFilter label="Search customer" search><input value={search} maxLength={200} placeholder="Customer or company name" onChange={(event) => setSearch(event.target.value)} /></TableFilter>
            <TableFilter label="Status"><Select value={status} onValueChange={(value) => { if (value !== null) setStatus(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">All invoices</SelectItem><SelectItem value="draft">Drafts</SelectItem><SelectItem value="issued">Issued / partial / overdue / paid</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent></Select></TableFilter>
          </TableFilters>
          <div className="crm-table-frame overflow-x-auto">
            <table className="crm-table min-w-[840px]">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {[
                    "Invoice",
                    "Customer",
                    "Created by",
                    "Due date",
                    "Status",
                    "Total",
                    "Balance",
                  ].map((label) => (
                    <th key={label} className="p-4">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listing.invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="p-4">
                      <Link
                        className="font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50"
                        href={`/invoices/${invoice.id}`}
                      >
                        {invoiceLabel(invoice)}
                      </Link>
                    </td>
                    <td className="max-w-64 break-words p-4">
                      {invoice.document.customerName}
                    </td>
                    <td className="p-4">
                      <InvoiceCreator invoice={invoice} />
                    </td>
                    <td className="whitespace-nowrap p-4">
                      {invoice.document.dueDate}
                    </td>
                    <td className="p-4">
                      <Status value={invoiceStatus(invoice, today)} />
                    </td>
                    <td className="whitespace-nowrap p-4">
                      {formatMoney(
                        invoice.total_minor,
                        invoice.document.currency,
                      )}
                    </td>
                    <td className="whitespace-nowrap p-4">
                      {formatMoney(
                        invoice.status === "void"
                          ? 0
                          : invoice.total_minor - invoice.paid_minor,
                        invoice.document.currency,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!listing.invoices.length ? (
              <div className="p-12 text-center">
                <h2 className="font-semibold">
                  {search || status
                    ? "No matching invoices"
                    : "Your invoices will appear here"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {canWrite
                    ? "Create a draft to start billing your customers."
                    : "Invoices created by your team will appear here."}
                </p>
              </div>
            ) : null}
          </div>
          <TablePagination page={page + 1} pageCount={Math.ceil(listing.count / 25)} total={listing.count} itemLabel="invoices" disabled={busy} onPrevious={() => void run(() => load(page - 1))} onNext={() => void run(() => load(page + 1))} />
        </>
      )}
    </div>
  );
}

function Status({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${value === "overdue" ? "border-red-400/30 bg-red-400/10 text-red-600 dark:text-red-300" : value === "paid" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300" : "bg-muted/50 text-muted-foreground"}`}
    >
      {value}
    </span>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="rounded-xl border p-5">
      <h2 className="text-sm text-muted-foreground">{label}</h2>
      <p className="my-2 break-words text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </section>
  );
}

type Payment = {
  id: string;
  amountMinor: number;
  paidOn: string;
  method: string;
  reference: string;
};
function PaymentForm({
  invoice,
  busy,
  today,
  onSubmit,
}: {
  invoice: Invoice;
  busy: boolean;
  today: string;
  onSubmit: (payment: Payment) => Promise<void>;
}) {
  // Retain this key after a failed response so a retry cannot duplicate a payment.
  const [id] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  return (
    <form
      className="mt-5 grid items-end gap-3 border-t pt-5 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          id,
          amountMinor: Math.round(Number(amount) * 100),
          paidOn,
          method,
          reference,
        });
      }}
    >
      <label className="grid gap-2 text-sm">
        Amount ({invoice.document.currency})
        <input
          required
          type="number"
          min="0.01"
          max={Math.min(
            1000000,
            (invoice.total_minor - invoice.paid_minor) / 100,
          )}
          step="0.01"
          value={amount}
          disabled={busy}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-sm">
        Payment date
        <input
          required
          type="date"
          max={today}
          value={paidOn}
          disabled={busy}
          onChange={(event) => setPaidOn(event.target.value)}
        />
      </label>
      <label className="grid gap-2 text-sm">
        Method
        <Select value={method} disabled={busy} onValueChange={(value) => { if (value === null) return; return setMethod(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="bank_transfer">Bank transfer</SelectItem>
          <SelectItem value="cash">Cash</SelectItem>
          <SelectItem value="card">Card</SelectItem>
          <SelectItem value="other">Other</SelectItem>
        </SelectContent></Select>
      </label>
      <label className="grid gap-2 text-sm">
        Reference
        <input
          value={reference}
          disabled={busy}
          maxLength={200}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>
      <Button type="submit" disabled={busy}>
        {busy ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}
