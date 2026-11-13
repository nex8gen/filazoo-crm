"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { EmptyState } from "@/components/data-state";
import { PackageSearch } from "lucide-react";
import dynamic from "next/dynamic";
import { useActionState, useState } from "react";
import { Download, FileText, MailPlus, Plus } from "lucide-react";
import { toast } from "sonner";
import { createCatalog, createEmailDraft, type CrmActionState } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type Company, type ContactOption, type Product } from "@/lib/types";
import { companyExportCsv } from "@/lib/company-export";

const AddCompanyForm = dynamic(() => import("@/components/add-company-form").then(module => module.AddCompanyForm), {
  loading: () => <p role="status" className="py-8 text-sm text-muted-foreground">Loading company form…</p>,
});

function ActionMessage({ state }: { state: CrmActionState }) {
  if (state?.error) return <NotificationToast>{state.error}</NotificationToast>;
  if (state?.success) return <NotificationToast tone="success">{state.success}</NotificationToast>;
  return null;
}

function useActionDialog(actionHandler: (state: CrmActionState, formData: FormData) => Promise<CrmActionState>, onSuccess?: (state: CrmActionState) => void) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previousState: CrmActionState, formData: FormData) => {
    try {
      const result = await actionHandler(previousState, formData);
      if (result?.success) {
        window.dispatchEvent(new Event("flow-activity-updated"));
        toast.success(result.success);
        setOpen(false);
        onSuccess?.(result);
      }
      return result;
    } catch {
      return { error: "Unable to save this change. Please retry." };
    }
  }, undefined);
  return { open, setOpen, state, action, pending };
}

export function AddCompanyButton({ canWrite, compact = false, existingSegments, label, onCreated }: { canWrite: boolean; compact?: boolean; existingSegments?: string[]; label?: string; onCreated?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button size="sm" disabled={!canWrite} title={canWrite ? "Add a company" : "Viewer access is read-only"} onClick={() => setOpen(true)}><Plus />{label ?? (compact ? "Add" : "Add company")}</Button>
      <Dialog open={open} onOpenChange={next => { if (!pending) setOpen(next); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Add company</DialogTitle><DialogDescription>Create a company profile, optional contact, and audit event.</DialogDescription></DialogHeader>
          {open ? <AddCompanyForm existingSegments={existingSegments} onCreated={onCreated} onPendingChange={setPending} onClose={() => { setOpen(false); setPending(false); }} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ExportCompaniesButton({ companies }: { companies: Company[] }) {
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([companyExportCsv(companies)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `filazoo-companies-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${companies.length} companies exported.`);
  };
  return <Button size="sm" variant="outline" disabled={!companies.length} onClick={exportCsv}><Download />Export</Button>;
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

export function NewCatalogButton({ companies, products, canWrite, label = "New quotation" }: { companies: Pick<Company, "id" | "name">[]; products: Product[]; canWrite: boolean; label?: string }) {
  const dialog = useActionDialog(createCatalog);
  const enabled = canWrite && companies.length > 0;
  return (
    <>
      <Button size="sm" disabled={!enabled} title={!canWrite ? "Viewer access is read-only" : companies.length ? "Create a catalog selection" : "Add a company first"} onClick={() => dialog.setOpen(true)}><FileText />{label}</Button>
      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Create quotation selection</DialogTitle><DialogDescription>Save a private product snapshot. Open the quotation afterward to set quantities, shipping and payment terms.</DialogDescription></DialogHeader>
          <form action={dialog.action} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" id="catalog-company"><Select name="companyId" required><SelectTrigger id="catalog-company" className="w-full"><SelectValue placeholder="Choose a company" /></SelectTrigger><SelectContent>{companies.map((company) => <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Currency" id="catalog-currency"><Select name="currency" defaultValue="USD"><SelectTrigger id="catalog-currency" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["USD", "EUR", "GBP", "CNY"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
            </div>
            <div className="space-y-2"><Label>Products</Label>{products.length ? <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">{products.map((product) => <label key={product.sku} className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-muted"><input className="mt-0.5 accent-current" type="checkbox" name="productSkus" value={product.sku} /><span><span className="block text-sm font-medium">{product.name}</span><span className="block text-xs text-muted-foreground">{product.sku} · {product.price}</span></span></label>)}</div> : <EmptyState compact icon={PackageSearch} title="No products synced" description="No active products are available yet. You can save an empty catalog shell and populate it after product sync." />}</div>
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
