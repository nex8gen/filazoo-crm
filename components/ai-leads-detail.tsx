"use client";

import Link from "next/link";
import { ArrowUpRight, Building2, Check, CircleHelp, Copy, FileText, Globe, Mail, MapPin, Phone, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableStatusBadge } from "@/components/ui/table-status-badge";
import { leadStatus } from "@/lib/lead-client";
import { qualificationLabels } from "@/lib/lead-prospecting";
import { isQualifiedLead } from "@/lib/lead-discovery-policy";
import type { LeadProof, LeadResult } from "@/lib/ai-leads";

export const feedbackChoices = [
  ["good_match", "Good match"], ["wrong_industry", "Wrong industry"], ["wrong_location", "Wrong location"],
  ["competitor", "Competitor"], ["contact_incorrect", "Contact incorrect"], ["dismissed", "Dismiss"],
] as const;
function Evidence({ label, proof }: { label: string; proof: LeadProof | null | undefined }) {
  if (!proof) return null;
  return <div className="ld-evidence-item"><h4>{label}</h4><p data-no-translate>{proof.value}</p><blockquote data-no-translate>{proof.quote}</blockquote><a href={proof.sourceUrl} target="_blank" rel="noreferrer">View source<ArrowUpRight size={12} /></a></div>;
}
export function AiLeadDetail({ lead, canWrite, busy, onClose, onSave, onFeedback, onNotice }: {
  lead: LeadResult | null; canWrite: boolean; busy: boolean; onClose: () => void;
  onSave: (lead: LeadResult) => void; onFeedback: (lead: LeadResult, reason: string) => void; onNotice: (message: string) => void;
}) {
  const status = lead ? leadStatus(lead) : "review";
  const companyId = lead?.savedCompanyId || lead?.existingCompanyId;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); onNotice("Contact copied."); }
    catch { onNotice("Copy is unavailable. Select the contact text to copy it."); }
  };
  return <Sheet open={Boolean(lead)} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent className="lead-detail-sheet">
      {lead ? <>
        <SheetHeader className="ld-detail-header">
          <div className="ld-detail-monogram" aria-hidden="true">{lead.name.slice(0, 1).toUpperCase()}</div>
          <SheetTitle data-no-translate>{lead.name}</SheetTitle>
          <SheetDescription>Company research and public contact information</SheetDescription>
          <a className="ld-company-website" href={lead.website} target="_blank" rel="noreferrer"><Globe size={14} /><span data-no-translate>{lead.domain}</span><ArrowUpRight size={12} /></a>
          <div className="ld-detail-badges"><TableStatusBadge tone={status === "qualified" ? "green" : status === "rejected" ? "red" : "yellow"}>{qualificationLabels[status]}</TableStatusBadge>{companyId ? <span className="ld-tag">In CRM</span> : null}<span className="ld-tag" data-no-translate>{lead.buyerGroup || lead.segment || "Unclassified"}</span></div>
        </SheetHeader>
        <div className="ld-detail-scroll">
          <section><h3>Qualification</h3><p className="ld-detail-summary" data-no-translate>{lead.reviewReason || lead.summary}</p>
            {lead.checks?.length ? <div className="ld-check-list">{lead.checks.map(check => <div key={check.key} className={"ld-qualification-check is-" + check.state}><span>{check.state === "met" ? <Check size={13} /> : check.state === "not_met" ? <X size={13} /> : <CircleHelp size={13} />}</span><div><strong>{check.label}</strong><p data-no-translate>{check.reason}</p></div></div>)}</div> : <p className="ld-helper">Earlier research has not been checked against a reviewed buyer profile.</p>}
          </section>
          <section><div className="ld-section-label"><h3>Contact information</h3><span className="ld-tag">Public sources</span></div>
            <div className="ld-contact-section"><div className="ld-contact-heading"><Mail size={15} /><h4>Business email</h4><span>Unverified</span></div>
              {lead.emails.length ? lead.emails.map(email => <div className="ld-contact-line" key={email.value}><div><a href={"mailto:" + email.value} data-no-translate>{email.value}</a><a className="ld-contact-source" href={email.sourceUrl} target="_blank" rel="noreferrer">Source<ArrowUpRight size={10} /></a></div><Button variant="ghost" size="icon-sm" aria-label={"Copy " + email.value} onClick={() => void copy(email.value)}><Copy size={13} /></Button></div>) : <p className="ld-helper">No public email found on the pages checked.</p>}
            </div>
            <div className="ld-contact-section"><div className="ld-contact-heading"><Phone size={15} /><h4>Business phone</h4></div>{lead.phones.length ? lead.phones.map(phone => <div className="ld-contact-line" key={phone.value}><a href={"tel:" + phone.value} data-no-translate>{phone.value}</a><a className="ld-contact-source" href={phone.sourceUrl} target="_blank" rel="noreferrer">Source<ArrowUpRight size={10} /></a></div>) : <p className="ld-helper">No public phone found on the pages checked.</p>}</div>
            {lead.contactPage ? <a className="ld-contact-page" href={lead.contactPage} target="_blank" rel="noreferrer"><FileText size={14} />Open contact page<ArrowUpRight size={12} /></a> : null}
            {lead.contactName ? <div className="ld-contact-section"><h4>Published contact person</h4><p data-no-translate>{lead.contactName.value}{lead.contactRole ? " · " + lead.contactRole.value : ""}</p></div> : null}
            {lead.address ? <p className="ld-address"><MapPin size={14} /><span data-no-translate>{lead.address.value}</span></p> : null}
            <p className="ld-privacy-note">Public contact details do not establish consent or confirmed buying intent. Email deliverability has not been verified.</p>
          </section>
          <section><h3>Why this company</h3><Evidence label="Product relevance" proof={lead.fitEvidence} /><Evidence label="Buyer group" proof={lead.buyerEvidence} /><Evidence label="Target location" proof={lead.locationEvidence} /><Evidence label="Company identity" proof={lead.identityEvidence} /><Evidence label="Requirements" proof={lead.requirementEvidence} /><Evidence label="Buying intent" proof={lead.buyingIntent} />{!lead.buyingIntent ? <p className="ld-helper">Buying intent is unknown. Product relevance does not confirm a purchase need.</p> : null}</section>
          <section><h3>Research sources</h3><div className="ld-source-list">{lead.sources.map(url => <a key={url} href={url} target="_blank" rel="noreferrer"><Globe size={13} /><span data-no-translate>{url}</span><ArrowUpRight size={12} /></a>)}</div><p className="ld-helper">Checked <time dateTime={lead.checkedAt}>{new Date(lead.checkedAt).toLocaleString("en-GB", { timeZone: "Asia/Shanghai" })}</time> · China time</p></section>
        </div>
        <div className="ld-detail-footer"><Select value={lead.feedback || null} disabled={!canWrite || busy} onValueChange={value => { if (value) onFeedback(lead, value); }}><SelectTrigger className="min-w-0 flex-1" aria-label="Rate this company"><SelectValue placeholder="Rate this company" /></SelectTrigger><SelectContent>{feedbackChoices.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>{companyId ? <Button render={<Link href={"/companies/" + companyId} />}><Building2 size={14} />Open company</Button> : <Button disabled={!canWrite || busy || !isQualifiedLead(lead) || status !== "qualified"} onClick={() => onSave(lead)}><Building2 size={14} />Add to CRM</Button>}</div>
      </> : null}
    </SheetContent>
  </Sheet>;
}
