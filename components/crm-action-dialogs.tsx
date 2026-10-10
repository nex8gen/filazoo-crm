"use client";

import { useActionState, useState } from "react";
import { Download, FileText, MailPlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { createCatalog, createCompany, createEmailDraft, createOpportunity, type CrmActionState } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Company, ContactOption, Product } from "@/lib/types";

function ActionMessage({ state }: { state: CrmActionState }) {
  if (state?.error) return <p role="alert" className="text-xs text-destructive">{state.error}</p>;
  if (state?.success) return <p role="status" className="text-xs text-primary">{state.success}</p>;
  return null;
}

function useActionDialog(actionHandler: (state: CrmActionState, formData: FormData) => Promise<CrmActionState>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previousState: CrmActionState, formData: FormData) => {
    const result = await actionHandler(previousState, formData);
    if (result?.success) {
      toast.success(result.success);
      setOpen(false);
    }
    return result;
  }, undefined);
  return { open, setOpen, state, action, pending };
}

export function AddCompanyButton({ canWrite, compact = false }: { canWrite: boolean; compact?: boolean }) {
  const dialog = useActionDialog(createCompany);
  return (
    <>
      <Button size="sm" disabled={!canWrite} title={canWrite ? "Add a company" : "Viewer access is read-only"} onClick={() => dialog.setOpen(true)}><Plus />{compact ? "Add" : "Add company"}</Button>
      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Add company</DialogTitle><DialogDescription>Create a prospect, pipeline entry, optional contact, and audit event.</DialogDescription></DialogHeader>
          <form action={dialog.action} className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" id="company-name"><Input id="company-name" name="name" required autoFocus /></Field>
            <Field label="Website" id="company-website"><Input id="company-website" name="website" inputMode="url" placeholder="https://example.com" /></Field>
            <Field label="Country" id="company-country"><Input id="company-country" name="country" required /></Field>
            <Field label="City" id="company-city"><Input id="company-city" name="city" /></Field>
            <Field label="Segment" id="company-segment"><Input id="company-segment" name="segment" placeholder="3D printing service bureau" required /></Field>
            <div />
            <div className="sm:col-span-2 border-t pt-4"><p className="text-sm font-medium">Primary contact <span className="font-normal text-muted-foreground">(optional)</span></p></div>
            <Field label="Contact name" id="contact-name"><Input id="contact-name" name="contactName" /></Field>
            <Field label="Role" id="contact-role"><Input id="contact-role" name="contactRole" /></Field>
            <div className="sm:col-span-2"><Field label="Business email" id="contact-email"><Input id="contact-email" name="contactEmail" type="email" /></Field></div>
            <div className="sm:col-span-2"><ActionMessage state={dialog.state} /></div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => dialog.setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={dialog.pending}>{dialog.pending ? "Adding…" : "Add company"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExportCompaniesButton({ companies }: { companies: Company[] }) {
  const exportCsv = () => {
    const fields = ["Name", "Domain", "Country", "Segment", "Stage", "Fit score", "Contact", "Role", "Email", "Next action"];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = companies.map((company) => [company.name, company.domain, company.country, company.segment, company.stage, company.fitScore, company.contact, company.contactRole, company.email, company.nextAction]);
    const csv = [fields, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `filazoo-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${companies.length} companies exported.`);
  };
  return <Button size="sm" variant="outline" disabled={!companies.length} onClick={exportCsv}><Download />Export</Button>;
}

export function AddOpportunityButton({ companies, canWrite }: { companies: Company[]; canWrite: boolean }) {
  const dialog = useActionDialog(createOpportunity);
  const enabled = canWrite && companies.length > 0;
  return (
    <>
      <Button size="sm" disabled={!enabled} title={!canWrite ? "Viewer access is read-only" : companies.length ? "Add an opportunity" : "Add a company first"} onClick={() => dialog.setOpen(true)}><Plus />Add opportunity</Button>
      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Add opportunity</DialogTitle><DialogDescription>Set the pipeline stage, value, owner, and next follow-up.</DialogDescription></DialogHeader>
          <form action={dialog.action} className="space-y-4">
            <Field label="Company" id="opportunity-company"><Select name="companyId" required><SelectTrigger id="opportunity-company" className="w-full"><SelectValue placeholder="Choose a company" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent></Select></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Stage" id="opportunity-stage"><Select name="stage" defaultValue="new"><SelectTrigger id="opportunity-stage" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New</SelectItem><SelectItem value="contacted">Contacted</SelectItem><SelectItem value="replied">Replied</SelectItem><SelectItem value="interested">Interested</SelectItem><SelectItem value="big_order">Big order</SelectItem><SelectItem value="won">Won</SelectItem><SelectItem value="lost">Lost</SelectItem></SelectContent></Select></Field>
              <Field label="Next follow-up" id="opportunity-followup"><Input id="opportunity-followup" name="nextFollowupAt" type="datetime-local" /></Field>
              <Field label="Estimated value" id="opportunity-value"><Input id="opportunity-value" name="estimatedValue" type="number" min="0" step="0.01" /></Field>
              <Field label="Currency" id="opportunity-currency"><Select name="currency" defaultValue="USD"><SelectTrigger id="opportunity-currency" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["USD", "EUR", "GBP", "CNY"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
            </div>
            <Field label="Notes" id="opportunity-notes"><Textarea id="opportunity-notes" name="notes" /></Field>
            <ActionMessage state={dialog.state} />
            <DialogFooter><Button type="button" variant="outline" onClick={() => dialog.setOpen(false)}>Cancel</Button><Button type="submit" disabled={dialog.pending}>{dialog.pending ? "Saving…" : "Save opportunity"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewEmailDraftButton({ contacts, canWrite, label = "New sequence" }: { contacts: ContactOption[]; canWrite: boolean; label?: string }) {
  const dialog = useActionDialog(createEmailDraft);
  const enabled = canWrite && contacts.length > 0;
  return (
    <>
      <Button size="sm" disabled={!enabled} title={!canWrite ? "Viewer access is read-only" : contacts.length ? "Create a draft" : "Add a contact first"} onClick={() => dialog.setOpen(true)}><MailPlus />{label}</Button>
      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Create email draft</DialogTitle><DialogDescription>Creates step one as a draft. Dry-run safeguards remain active and nothing is sent.</DialogDescription></DialogHeader>
          <form action={dialog.action} className="space-y-4">
            <Field label="Contact" id="draft-contact"><Select name="contactId" required><SelectTrigger id="draft-contact" className="w-full"><SelectValue placeholder="Choose a contact" /></SelectTrigger><SelectContent>{contacts.map((contact) => <SelectItem key={contact.id} value={contact.id}>{contact.company} — {contact.name} ({contact.email})</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Subject" id="draft-subject"><Input id="draft-subject" name="subject" required /></Field>
            <Field label="Message" id="draft-body"><Textarea id="draft-body" name="body" className="min-h-48" required /></Field>
            <ActionMessage state={dialog.state} />
            <DialogFooter><Button type="button" variant="outline" onClick={() => dialog.setOpen(false)}>Cancel</Button><Button type="submit" disabled={dialog.pending}>{dialog.pending ? "Saving…" : "Save draft"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function NewCatalogButton({ companies, products, canWrite, label = "New catalog" }: { companies: Company[]; products: Product[]; canWrite: boolean; label?: string }) {
  const dialog = useActionDialog(createCatalog);
  const enabled = canWrite && companies.length > 0;
  return (
    <>
      <Button size="sm" disabled={!enabled} title={!canWrite ? "Viewer access is read-only" : companies.length ? "Create a catalog selection" : "Add a company first"} onClick={() => dialog.setOpen(true)}><FileText />{label}</Button>
      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Create catalog selection</DialogTitle><DialogDescription>Save the company, currency, and focused product set. PDF rendering remains unavailable until the catalog renderer is connected.</DialogDescription></DialogHeader>
          <form action={dialog.action} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" id="catalog-company"><Select name="companyId" required><SelectTrigger id="catalog-company" className="w-full"><SelectValue placeholder="Choose a company" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Currency" id="catalog-currency"><Select name="currency" defaultValue="USD"><SelectTrigger id="catalog-currency" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["USD", "EUR", "GBP", "CNY"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
            </div>
            <div className="space-y-2"><Label>Products</Label>{products.length ? <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{products.map((product) => <label key={product.sku} className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted"><input className="mt-0.5 accent-current" type="checkbox" name="productSkus" value={product.sku} /><span><span className="block text-sm font-medium">{product.name}</span><span className="block text-xs text-muted-foreground">{product.sku} · {product.price}</span></span></label>)}</div> : <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">No active products are available yet. You can save an empty catalog shell and populate it after product sync.</p>}</div>
            <ActionMessage state={dialog.state} />
            <DialogFooter><Button type="button" variant="outline" onClick={() => dialog.setOpen(false)}>Cancel</Button><Button type="submit" disabled={dialog.pending}>{dialog.pending ? "Saving…" : "Create catalog"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
