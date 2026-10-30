"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { Clock3, Save, Workflow } from "lucide-react";
import { updateCompany, type CrmActionState } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CompanyCommerceFields } from "@/components/company-commerce-fields";
import { followupInstant, followupLocalTime } from "@/lib/company-followup";
import { type CompanyDetails as CompanyDetailsType } from "@/lib/types";

const subscribeToHydration = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function Field({ label, id, children, hint }: { label: string; id: string; children: React.ReactNode; hint?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}{hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}</div>;
}

export function CompanyDetails({ details, canWrite }: { details: CompanyDetailsType; canWrite: boolean }) {
  const company = details.company;
  const updateWithId = updateCompany.bind(null, company.id);
  const [state, action, pending] = useActionState<CrmActionState, FormData>(updateWithId, undefined);
  const clientReady = useSyncExternalStore(subscribeToHydration, clientSnapshot, serverSnapshot);
  const [editedFollowup, setNextFollowup] = useState<string | null>(null);
  const nextFollowup = editedFollowup ?? (clientReady ? followupLocalTime(company.nextFollowupAt) : "");

  return <div className="space-y-6">
    <form action={action}>
      <input type="hidden" name="nextFollowupAt" value={editedFollowup === null ? company.nextFollowupAt || "" : followupInstant(editedFollowup)} />
      <fieldset disabled={!canWrite || pending} className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)] disabled:opacity-70">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Company & primary contact</CardTitle><CardDescription>Business information and the person to contact about orders.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" id="company-name"><Input id="company-name" name="name" defaultValue={company.name} required /></Field>
              <Field label="Website" id="company-website"><Input id="company-website" name="website" defaultValue={company.website} inputMode="url" /></Field>
              <Field label="Country" id="company-country"><Input id="company-country" name="country" defaultValue={company.country === "Unknown" ? "" : company.country} required /></Field>
              <Field label="City" id="company-city"><Input id="company-city" name="city" defaultValue={company.city} /></Field>
              <div className="sm:col-span-2"><Field label="Business segment" id="company-segment"><Input id="company-segment" name="segment" defaultValue={company.segment} required /></Field></div>
              <Field label="Primary contact" id="contact-name"><Input id="contact-name" name="contactName" defaultValue={company.contact === "No contact yet" ? "" : company.contact} /></Field>
              <Field label="Job title" id="contact-role"><Input id="contact-role" name="contactRole" defaultValue={company.contactRole === "Role not confirmed" ? "" : company.contactRole} /></Field>
              <div className="sm:col-span-2"><Field label="Business email" id="contact-email" hint="Incoming and outgoing messages using this email are matched to the company timeline."><Input id="contact-email" name="contactEmail" type="email" defaultValue={company.email} /></Field></div>
            </CardContent>
          </Card>

          <CompanyCommerceFields profile={details.commerce} />
          <Card>
            <CardHeader><CardTitle>Account notes</CardTitle><CardDescription>Keep useful customer preferences and profile notes together.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <details className="sm:col-span-2 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Optional qualification</summary><div className="mt-4 grid gap-4 sm:grid-cols-2">              <Field label="Fit score (1–10)" id="company-fit"><Input id="company-fit" name="fitScore" type="number" min="1" max="10" defaultValue={company.fitScore || ""} /></Field>
              <div className="sm:col-span-2"><Field label="Interest tags (comma separated)" id="company-tags"><Input id="company-tags" name="tags" defaultValue={company.tags.join(", ")} /></Field></div>
</div></details>
              <div className="sm:col-span-2"><Field label="Profile notes" id="company-summary"><Textarea id="company-summary" name="summary" className="min-h-28" defaultValue={company.summary === "This company has not been profiled yet." ? "" : company.summary} placeholder="Add a durable summary of customer needs, preferences, objections, and buying intent." /></Field></div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4"><div>{state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state?.success && <p role="status" className="text-sm text-primary">{state.success}</p>}</div><Button type="submit" disabled={!canWrite || pending}><Save />{pending ? "Saving…" : "Save company profile"}</Button></div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-4" />Follow-up schedule</CardTitle><CardDescription>Set the confirmed follow-up date here.</CardDescription></CardHeader>
            <CardContent className="space-y-4"><Field label="Scheduled date and time" id="company-followup"><DatePicker id="company-followup" includeTime value={nextFollowup} onValueChange={setNextFollowup} /></Field><div className="flex gap-2 rounded-lg border bg-background/80 p-3 text-xs leading-5 text-muted-foreground"><Workflow className="mt-0.5 size-4 shrink-0 text-primary" /><span>A saved follow-up date creates a reminder for the account owner.</span></div></CardContent>
          </Card>

        </div>
      </fieldset>
    </form>

  </div>;
}
