"use client";

import { useActionState, type ReactNode } from "react";
import { toast } from "sonner";
import { createCompany, type CrmActionState } from "@/app/crm-actions";
import { CompanyLocationFields, CompanySegmentField, ContactRoleField } from "@/components/company-form-fields";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Load the searchable location and contact controls only after opening Add company. */
export function AddCompanyForm({ existingSegments, onCreated, onClose, onPendingChange }: {
  existingSegments?: string[];
  onCreated?: (id: string) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [state, action, pending] = useActionState(async (previousState: CrmActionState, formData: FormData) => {
    onPendingChange(true);
    try {
      const result = await createCompany(previousState, formData);
      if (result?.success) {
        window.dispatchEvent(new Event("flow-activity-updated"));
        toast.success(result.success);
        onClose();
        if (result.companyId) onCreated?.(result.companyId);
      }
      return result;
    } catch {
      return { error: "Unable to save this change. Please retry." };
    } finally {
      onPendingChange(false);
    }
  }, undefined);

  return <form action={action} className="grid gap-4 sm:grid-cols-2">
    <Field label="Company name" id="company-name"><Input id="company-name" name="name" autoComplete="organization" required autoFocus /></Field>
    <Field label="Website" id="company-website"><Input id="company-website" name="website" inputMode="url" autoComplete="url" placeholder="https://example.com" /></Field>
    <CompanyLocationFields disabled={pending} />
    <div className="sm:col-span-2"><CompanySegmentField disabled={pending} existingSegments={existingSegments} /></div>
    <div className="sm:col-span-2 border-t pt-4"><p className="text-sm font-medium">Primary contact <span className="font-normal text-muted-foreground">(optional)</span></p></div>
    <Field label="Contact name" id="contact-name"><Input id="contact-name" name="contactName" autoComplete="name" /></Field>
    <ContactRoleField disabled={pending} />
    <div className="sm:col-span-2"><Field label="Business email" id="contact-email"><Input id="contact-email" name="contactEmail" type="email" autoComplete="email" /></Field></div>
    {state?.error ? <p role="alert" className="text-xs text-destructive sm:col-span-2">{state.error}</p> : null}
    <DialogFooter className="sm:col-span-2">
      <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add company"}</Button>
    </DialogFooter>
  </form>;
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
