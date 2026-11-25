"use client";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { Building2, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { createCompany, type CrmActionState } from "@/app/crm-actions";
import { CompanyLocationFields, CompanySegmentField, ContactRoleField } from "@/components/company-form-fields";
import { Button } from "@/components/ui/button";
import { SheetFooter } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Load the searchable location and contact controls only after opening Add company. */
export function AddCompanyForm({ existingSegments, submitLabel = "Add company", onCreated, onClose, onPendingChange }: {
  existingSegments?: string[];
  submitLabel?: string;
  onCreated?: (id: string) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const hasContactDetails = Boolean(contactName.trim() || contactRole.trim());
  const [state, action, pending] = useActionState(async (previousState: CrmActionState, formData: FormData) => {
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
    }
  }, undefined);

  // Action updates run in a transition; notify the sheet from the committed
  // pending state so Escape and the close button lock while the save is in flight.
  useEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);

  return <form action={action} className="company-create-form" aria-busy={pending}>
    <div className="company-create-scroll">
      <p className="company-create-required"><span aria-hidden="true">*</span> Required fields</p>
      <section className="company-create-section" aria-labelledby="company-create-details">
        <div className="company-create-section-heading"><Building2 aria-hidden="true" /><h3 id="company-create-details">Company details</h3></div>
        <p className="company-create-section-description">The essentials for your new company profile.</p>
        <div className="company-create-fields">
          <Field label="Company name" id="company-name" required><Input id="company-name" name="name" value={name} onChange={event => setName(event.target.value)} autoComplete="organization" placeholder="e.g. Acme Industries" minLength={2} maxLength={160} required autoFocus disabled={pending} /></Field>
          <Field label="Website" id="company-website"><Input id="company-website" name="website" value={website} onChange={event => setWebsite(event.target.value)} inputMode="url" autoComplete="url" maxLength={500} placeholder="example.com" disabled={pending} /></Field>
          <CompanyLocationFields disabled={pending} />
          <div className="company-create-field-wide"><CompanySegmentField disabled={pending} existingSegments={existingSegments} /></div>
        </div>
      </section>
      <section className="company-create-section" aria-labelledby="company-create-contact">
        <div className="company-create-section-heading"><UserRound aria-hidden="true" /><h3 id="company-create-contact">Primary contact</h3><span>Optional</span></div>
        <p className="company-create-section-description">Add the person you work with. Include their business email to save the contact.</p>
        <div className="company-create-fields">
          <Field label="Contact name" id="contact-name"><Input id="contact-name" name="contactName" value={contactName} onChange={event => setContactName(event.target.value)} autoComplete="name" maxLength={120} placeholder="e.g. Alex Morgan" disabled={pending} /></Field>
          <ContactRoleField disabled={pending} onChange={setContactRole} />
          <div className="company-create-field-wide"><Field label="Business email" id="contact-email" required={hasContactDetails}><Input id="contact-email" name="contactEmail" value={contactEmail} onChange={event => setContactEmail(event.target.value)} type="email" autoComplete="email" maxLength={320} placeholder="name@example.com" required={hasContactDetails} disabled={pending} /></Field></div>
        </div>
      </section>
      {state?.error ? <p role="alert" className="company-create-error">{state.error}</p> : null}
    </div>
    <SheetFooter className="company-create-footer">
      <p>You can edit all details later in the profile.</p>
      <Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={pending}>{pending ? <><Loader2 aria-hidden="true" className="animate-spin" />Adding…</> : submitLabel}</Button>
    </SheetFooter>
  </form>;
}

function Field({ label, id, required, children }: { label: string; id: string; required?: boolean; children: ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label htmlFor={id}>{label}{required ? <span className="company-create-asterisk" aria-hidden="true">*</span> : null}</Label>{children}</div>;
}
