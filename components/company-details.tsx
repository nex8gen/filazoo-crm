"use client";

import { useActionState, useState } from "react";
import { Clock3, Save, Workflow } from "lucide-react";
import { updateCompany, type CrmActionState } from "@/app/crm-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { pipelineStageLabels, pipelineStageValues, type CompanyDetails as CompanyDetailsType, type PipelineStageValue } from "@/lib/types";

const stageOptions = pipelineStageValues.map((value) => [value, pipelineStageLabels[value]] as const);
const stageValue = Object.fromEntries(stageOptions.map(([value, label]) => [label, value])) as Record<string, PipelineStageValue>;

function Field({ label, id, children, hint }: { label: string; id: string; children: React.ReactNode; hint?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}{hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}</div>;
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function CompanyDetails({ details, canWrite }: { details: CompanyDetailsType; canWrite: boolean }) {
  const company = details.company;
  const updateWithId = updateCompany.bind(null, company.id);
  const [state, action, pending] = useActionState<CrmActionState, FormData>(updateWithId, undefined);
  const [stage, setStage] = useState<PipelineStageValue>(stageValue[company.stage] || "new");
  const [nextFollowup, setNextFollowup] = useState(toLocalDateTime(company.nextFollowupAt));

  return <div className="space-y-6">
    <form action={action}>
      <fieldset disabled={!canWrite || pending} className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.65fr)] disabled:opacity-70">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Follow-up details</CardTitle><CardDescription>The customer profile, company record, sales category, and pipeline stage stay in sync.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" id="company-name"><Input id="company-name" name="name" defaultValue={company.name} required /></Field>
              <Field label="Website" id="company-website"><Input id="company-website" name="website" defaultValue={company.website} inputMode="url" /></Field>
              <Field label="Country" id="company-country"><Input id="company-country" name="country" defaultValue={company.country === "Unknown" ? "" : company.country} required /></Field>
              <Field label="City" id="company-city"><Input id="company-city" name="city" defaultValue={company.city} /></Field>
              <div className="sm:col-span-2"><Field label="Business segment" id="company-segment"><Input id="company-segment" name="segment" defaultValue={company.segment} required /></Field></div>
              <Field label="Primary customer" id="contact-name"><Input id="contact-name" name="contactName" defaultValue={company.contact === "No contact yet" ? "" : company.contact} /></Field>
              <Field label="Customer role" id="contact-role"><Input id="contact-role" name="contactRole" defaultValue={company.contactRole === "Role not confirmed" ? "" : company.contactRole} /></Field>
              <div className="sm:col-span-2"><Field label="Business email" id="contact-email" hint="Incoming and outgoing messages using this email are matched to the company timeline."><Input id="contact-email" name="contactEmail" type="email" defaultValue={company.email} /></Field></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Sales category & pipeline</CardTitle><CardDescription>One shared status powers the customer category, pipeline board, and automation rules.</CardDescription></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2"><Field label="Sales category" id="company-stage" hint="Changing this also moves the profile to the matching pipeline stage."><Select name="stage" value={stage} onValueChange={(value) => value && setStage(value as PipelineStageValue)}><SelectTrigger id="company-stage" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{stageOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field></div>
              <Field label="Estimated order quantity" id="company-quantity"><Input id="company-quantity" name="estimatedOrderQuantity" type="number" min="0" step="1" defaultValue={company.estimatedOrderQuantity ?? ""} /></Field>
              <Field label="Estimated value" id="company-value"><Input id="company-value" name="estimatedValue" type="number" min="0" step="0.01" defaultValue={company.estimatedValue ?? ""} /></Field>
              <Field label="Currency" id="company-currency"><Select name="currency" defaultValue={company.currency}><SelectTrigger id="company-currency" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["USD", "EUR", "GBP", "CNY"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Fit score (1–10)" id="company-fit"><Input id="company-fit" name="fitScore" type="number" min="1" max="10" defaultValue={company.fitScore || ""} /></Field>
              <div className="sm:col-span-2"><Field label="Interest tags (comma separated)" id="company-tags"><Input id="company-tags" name="tags" defaultValue={company.tags.join(", ")} /></Field></div>
              <div className="sm:col-span-2"><Field label="Profile notes" id="company-summary"><Textarea id="company-summary" name="summary" className="min-h-28" defaultValue={company.summary === "This company has not been profiled yet." ? "" : company.summary} placeholder="Add a durable summary of customer needs, preferences, objections, and buying intent." /></Field></div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4"><div>{state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state?.success && <p role="status" className="text-sm text-primary">{state.success}</p>}</div><Button type="submit" disabled={!canWrite || pending}><Save />{pending ? "Saving…" : "Save follow-up details"}</Button></div>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-4" />Follow-up schedule</CardTitle><CardDescription>Set the confirmed follow-up date here. Explore recommendations in the AI tab.</CardDescription></CardHeader>
            <CardContent className="space-y-4"><Field label="Scheduled date and time" id="company-followup"><Input id="company-followup" name="nextFollowupAt" type="datetime-local" value={nextFollowup} onChange={(event) => setNextFollowup(event.target.value)} /></Field><div className="flex gap-2 rounded-lg border bg-background/80 p-3 text-xs leading-5 text-muted-foreground"><Workflow className="mt-0.5 size-4 shrink-0 text-primary" /><span>Saving the date enrolls this profile in follow-up tracking. Stage and no-reply flows can act on the same customer history.</span></div></CardContent>
          </Card>

        </div>
      </fieldset>
    </form>

  </div>;
}
