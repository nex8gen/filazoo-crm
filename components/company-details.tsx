"use client";

import Link from "next/link";
import { Building2, Copy, Mail, NotebookPen, UserRound } from "lucide-react";
import { toast } from "sonner";
import { CompanyCommerceFields } from "@/components/company-commerce-fields";
import { CompanyFollowupBar } from "@/components/company-followup-bar";
import { CompanyInlineField, CompanyProfileSection } from "@/components/company-profile-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import type { CompanyDetails as CompanyDetailsType } from "@/lib/types";
import "./company-details.css";

export function CompanyDetails({ details, canWrite }: { details: CompanyDetailsType; canWrite: boolean }) {
  const company = details.company;
  const contactName = company.contact === "No contact yet" ? "" : company.contact;
  const contactRole = company.contactRole === "Role not confirmed" ? "" : company.contactRole;
  const summary = company.summary === "This company has not been profiled yet." ? "" : company.summary;
  const initials = contactName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const fieldProps = { companyId: company.id, canWrite };

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(company.email);
      toast.success("Email copied.");
    } catch {
      toast.error("Could not copy the email. Please select and copy it manually.");
    }
  }

  return <div className="company-details-overview">
    <div className="company-overview-surface">
      <CompanyFollowupBar {...fieldProps} nextFollowupAt={company.nextFollowupAt} />
      <section className="company-overview-section" aria-labelledby="company-details-title">
        <h3 id="company-details-title" className="company-overview-heading"><Building2 aria-hidden="true" />Company details</h3>
        <div className="company-properties">
          <CompanyInlineField {...fieldProps} name="name" label="Company name" value={company.name} important />
          <CompanyInlineField {...fieldProps} name="website" label="Website" value={company.website} placeholder="+ Add website" />
          <CompanyInlineField {...fieldProps} name="country" label="Country" value={company.country === "Unknown" ? "" : company.country} important />
          <CompanyInlineField {...fieldProps} name="city" label="City" value={company.city} />
          <CompanyInlineField {...fieldProps} name="segment" label="Business segment" value={company.segment} className="company-property-wide" important />
        </div>
      </section>

      <section className="company-overview-section" aria-labelledby="company-contact-title">
        <h3 id="company-contact-title" className="company-overview-heading"><UserRound aria-hidden="true" />Primary contact</h3>
        <div className="company-contact-layout">
          <div className="company-contact-person">
            <span className="company-contact-initials" aria-hidden="true">{initials || <UserRound />}</span>
            <div className="company-contact-identity">
              <CompanyInlineField {...fieldProps} name="contactName" label="Primary contact" value={contactName} placeholder="+ Add contact name" hideLabel className="company-contact-name" />
              <CompanyInlineField {...fieldProps} name="contactRole" label="Job title" value={contactRole} placeholder="+ Add job title" hideLabel className="company-contact-role" />
            </div>
          </div>
          <div className="company-contact-email">
            <CompanyInlineField {...fieldProps} name="contactEmail" label="Business email" value={company.email} placeholder="+ Add email" important />
            {company.email ? <div className="company-contact-actions">
              <Button type="button" variant="outline" size="icon-xs" aria-label="Copy business email" title="Copy email" onClick={copyEmail}><Copy /></Button>
              {canWrite ? <Link href={`/companies/${encodeURIComponent(company.id)}?tab=email&compose=1`} className={buttonVariants({ variant: "outline", size: "icon-xs" })} aria-label="Compose email to primary contact" title="Compose email"><Mail /></Link> : null}
            </div> : null}
          </div>
        </div>
      </section>
    </div>
    <CompanyCommerceFields companyId={company.id} canWrite={canWrite} profile={details.commerce} />
    <CompanyProfileSection title="Account notes" icon={NotebookPen}>
      <CompanyInlineField {...fieldProps} name="summary" label="Profile notes" value={summary} placeholder="+ Add profile notes" className="company-property-wide" />
      <CompanyInlineField {...fieldProps} name="fitScore" label="Fit score (1–10)" value={company.fitScore ? String(company.fitScore) : ""} />
      <CompanyInlineField {...fieldProps} name="tags" label="Product interests" value={company.tags.join(", ")} />
    </CompanyProfileSection>
    <p className="company-overview-hint">{canWrite ? "Click a detail to edit. Confirm each change to save it." : "You have read-only access to this profile."}</p>
  </div>;
}
