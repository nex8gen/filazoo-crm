"use client";

import Link from "next/link";
import { Check, ExternalLink, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, invoiceTotals } from "@/lib/invoices";
import { invoiceBankFields } from "@/lib/invoice-banks";
import { paymentMethodDetails, paymentMethodTitle } from "@/lib/invoice-payment-methods";
import { formatTrigger, stepLabels, type JsonConfig } from "@/lib/flows";
import type { AgentActionResult, AgentProposal } from "@/lib/ai/agent-actions";
import { AgentWorkIcon } from "@/components/agent-work-icon";
import { actionWorkProgress, type AgentWorkProgress } from "@/lib/ai/agent-progress";
import { crmOperationLabels } from "@/lib/ai/crm-tools";

const crmFieldLabels: Record<string, string> = { dueAt: "Follow-up time", unitPriceMinor: "Unit price", totalMinor: "Total", paidMinor: "Already paid", amountMinor: "Payment amount", taxBps: "Tax rate", paymentPolicy: "Payment terms", preShipmentPercent: "Payment before shipment (%)" };
const crmHiddenFields = new Set(["op", "version", "revision", "id", "companyId", "flowId", "orderId", "messageId", "mailboxId", "userId", "ownerId"]);
function CrmDetails({ value, currency = "USD" }: { value: unknown; currency?: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">(empty)</span>;
  if (typeof value !== "object") return <span data-no-translate={typeof value === "boolean" ? undefined : true} className="whitespace-pre-wrap break-words">{typeof value === "boolean" ? value ? "Yes" : "No" : String(value)}</span>;
  if (Array.isArray(value)) return <ol className="space-y-2">{value.map((item, index) => <li key={index} className="rounded-md border bg-background p-2"><CrmDetails value={item} currency={currency} /></li>)}</ol>;
  const fields = value as Record<string, unknown>;
  const unit = typeof fields.currency === "string" && fields.currency ? fields.currency : currency;
  return <dl className="space-y-2">{Object.entries(fields).filter(([key]) => !crmHiddenFields.has(key)).map(([key, item]) => <div key={key}><dt className="font-medium capitalize">{crmFieldLabels[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}</dt><dd className="mt-0.5 min-w-0">{typeof item === "number" && key.endsWith("Minor") ? formatMoney(item, unit) : key === "taxBps" && typeof item === "number" ? `${item / 100}%` : <CrmDetails value={item} currency={unit} />}</dd></div>)}</dl>;
}

function FlowSettings({ config }: { config: JsonConfig }) {
  return <dl className="mt-1 space-y-1 text-muted-foreground">{Object.entries(config).filter(([, value]) => value !== null && value !== "").map(([key, value]) => <div key={key} className="whitespace-pre-wrap break-words"><dt className="inline capitalize">{key.replace(/([a-z])([A-Z])/g, "$1 $2")}: </dt><dd className="inline">{typeof value === "boolean" ? value ? "Yes" : "No" : String(value).replaceAll("_", " ")}</dd></div>)}</dl>;
}

export function AgentActionCard({ proposal, result, executing, progress, disabled, onApprove, onDecline }: {
  proposal: AgentProposal; result?: AgentActionResult; executing: boolean; disabled: boolean;
  onApprove: () => void; onDecline: () => void;
  progress?: AgentWorkProgress;
}) {
  const { action } = proposal;
  const company = action.type === "create_company" ? action.company : null;
  const document = "document" in action ? action.document : null;
  const email = "email" in action ? action.email : null;
  const profile = action.type === "update_company" || action.type === "add_company_note" ? action : null;
  const flow = action.type === "create_flow" ? action.flow : null;
  const title = flow ? flow.status === "live" ? "Create live flow" : "Create draft flow" : company ? "Create company" : profile ? action.type === "update_company" ? "Update customer profile" : "Add customer note" : action.type === "create_invoice" ? "Create draft invoice" : action.type === "update_invoice" ? "Update draft invoice" : email?.delivery === "draft" ? "Prepare email draft" : "Send email";
  const finished = Boolean(result?.status || result?.success || result?.error);
  const crmAction = action.type === "crm_action" ? action : null;
  return <div className="rounded-xl border bg-muted/30 p-3.5">
    <div className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary"><AgentWorkIcon area={actionWorkProgress(action).area} className="size-4" /></span>
      <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{crmAction ? crmOperationLabels[crmAction.operation.op] : title}</p><p className="mt-1 break-words text-sm font-semibold">{crmAction?.target || flow?.name || company?.name || profile?.companyName || document?.customerName || email?.to}</p>
        {company ? <><p className="mt-1 text-xs leading-5 text-muted-foreground">{company.country} · {company.city} · {company.segment}</p>{company.website ? <p className="break-all text-xs">{company.website}</p> : null}{company.contactEmail ? <p className="break-all text-xs">{company.contactName} · {company.contactRole} · {company.contactEmail}</p> : null}</> : null}
      </div>
    </div>
    {flow ? <div className="mt-3 space-y-3 text-xs"><p className="font-medium">{formatTrigger(flow.triggerType, flow.triggerConfig)}</p><FlowSettings config={flow.triggerConfig} /><ol className="space-y-2">{flow.steps.map((step, index) => <li key={index} className="rounded-lg border bg-background p-2.5"><p className="font-medium">{index + 1}. {stepLabels[step.type]}</p><FlowSettings config={step.config} /></li>)}</ol><p className="text-muted-foreground">{flow.status === "live" ? "This flow will run automatically when its trigger matches, including any configured email sends." : "Saved as a draft. Activate it in Flows when ready."}</p></div> : null}
    {profile ? <div className="mt-3 space-y-2 whitespace-pre-wrap break-words text-xs">{profile.type === "add_company_note" ? <p>{profile.note}</p> : Object.entries(profile.changes).flatMap(([key, value]) => key === "commerce" ? Object.entries(value).map(([field, text]) => <p key={`commerce.${field}`}><span className="font-medium">{field}: </span>{String(text) || "(clear)"}</p>) : [<p key={key}><span className="font-medium">{key}: </span>{String(value) || "(clear)"}</p>])}</div> : null}
    {crmAction ? <div className="mt-3 max-h-80 space-y-3 overflow-y-auto rounded-lg border bg-background p-3 text-xs"><CrmDetails value={crmAction.preview} />{proposal.approvalMode === "ask" ? <p className="text-muted-foreground">Review this change before applying it.</p> : null}</div> : null}
    {document ? <div className="mt-3 space-y-3 text-xs">
      <p className="text-muted-foreground">{document.currency} · {document.issueDate} · Due {document.dueDate}</p>
      <div className="divide-y rounded-lg border bg-background px-3">{document.items.map((item, index) => <div key={index} className="py-2.5"><p className="font-medium">{item.description}</p><p className="mt-1 text-muted-foreground">{item.variantSku || item.productSku}</p><p className="mt-1">{item.quantity} × {formatMoney(item.unitPriceMinor, document.currency)} = {formatMoney(item.quantity * item.unitPriceMinor, document.currency)}{item.taxBps ? ` · ${item.taxBps / 100}% tax` : ""}</p></div>)}</div>
      <div className="space-y-1">{document.discountMinor ? <p>Discount: {formatMoney(document.discountMinor, document.currency)}</p> : null}{document.shippingMinor ? <p>Shipping: {formatMoney(document.shippingMinor, document.currency)}</p> : null}<p>Tax: {formatMoney(invoiceTotals(document).tax, document.currency)}</p><p className="font-semibold">Total: {formatMoney(invoiceTotals(document).total, document.currency)}</p></div>
      {document.bankAccount ? <div className="space-y-1 rounded-lg border p-2.5"><p className="font-medium">{document.bankAccount.label}</p>{invoiceBankFields(document.bankAccount).map(([label, value]) => <p key={label} className="break-words"><span className="text-muted-foreground">{label}: </span>{value}</p>)}</div> : null}
      {document.paymentMethods?.map((method) => <div key={method.id} className="space-y-1 rounded-lg border p-2.5"><p className="font-medium">{paymentMethodTitle(method)}</p><p className="whitespace-pre-wrap break-words">{paymentMethodDetails(method)}</p>{method.paymentUrl ? <p className="break-all">{method.paymentUrl}</p> : null}</div>)}
      <details><summary className="cursor-pointer text-muted-foreground">Invoice details</summary><div className="mt-2 space-y-2 whitespace-pre-wrap break-words"><p>{document.sellerName}{"\n"}{document.sellerAddress}{"\n"}{document.sellerTaxId}</p><p>{document.customerName}{"\n"}{document.customerEmail}{"\n"}{document.customerAddress}{"\n"}{document.customerTaxId}</p>{document.shippingAddress ? <p>{document.shippingRecipient}{"\n"}{document.shippingAddress}{"\n"}{document.shippingPhone}</p> : null}<p>{document.reference}</p><p>{document.paymentInstructions}</p><p>{document.notes}</p></div></details>
    </div> : null}
    {email ? <div className="mt-3 space-y-2 rounded-lg border bg-background p-3 text-xs"><p className="font-medium">{email.delivery === "draft" ? "Email draft" : "Send email"}{document ? " with invoice PDF" : ""}</p><p className="break-all">To: {email.to}</p><p>Subject: {email.subject}</p><p className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words leading-5">{email.text}</p></div> : null}
    {executing ? <p className="mt-3 flex items-center gap-2 text-xs"><LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" /><AgentWorkIcon area={(progress ?? actionWorkProgress(action)).area} />{(progress ?? actionWorkProgress(action)).label}</p> : null}
    {result?.success ? <p className="mt-3 flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-300"><Check className="mt-0.5 size-3.5 shrink-0" />{result.success}</p> : null}
    {result?.error ? <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{result.error}</p> : null}
    {result?.href ? <Link href={result.href} onClick={(event) => {
      const draftId = new URL(result.href!, window.location.origin).searchParams.get("agentDraft");
      if (draftId && window.document.querySelector(".email-workspace")) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("filazoo:agent-action", { detail: { draftId, reopen: true } }));
      }
    }} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-4">Open result<ExternalLink className="size-3" /></Link> : null}
    {!finished && !executing ? <div className="mt-3 flex gap-2"><Button type="button" size="sm" className="min-w-0 flex-1" disabled={disabled} onClick={onApprove}><Check />{email && email.delivery !== "draft" ? "Approve and send" : "Approve and apply"}</Button><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onDecline}><X />Decline</Button></div> : null}
    {!finished && !executing ? <p className="mt-2 text-[10px] leading-4 text-muted-foreground">Review the details above. Approval expires after 30 minutes.</p> : null}
  </div>;
}
