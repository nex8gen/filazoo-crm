"use client";

import { useActionState } from "react";
import { Bot, FileText, Mail, Save, UserRound } from "lucide-react";
import { updateCompany, type CrmActionState } from "@/app/crm-actions";
import { AssignedOwner } from "@/components/assigned-owner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CompanyActivity, CompanyDetails as CompanyDetailsType } from "@/lib/types";

const stageOptions = [
  ["new", "New"], ["contacted", "Contacted"], ["replied", "Replied"], ["interested", "Interested"],
  ["big_order", "Big order"], ["won", "Won"], ["lost", "Lost"],
] as const;

const stageValue: Record<string, (typeof stageOptions)[number][0]> = { New: "new", Contacted: "contacted", Replied: "replied", Interested: "interested", "Big order": "big_order", Won: "won", Lost: "lost" };

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ActivityIcon({ item }: { item: CompanyActivity }) {
  if (item.type === "email") return <Mail className="size-4" />;
  if (item.type === "catalog") return <FileText className="size-4" />;
  return item.actor === "Automation" ? <Bot className="size-4" /> : <UserRound className="size-4" />;
}

export function CompanyDetails({ details, canWrite }: { details: CompanyDetailsType; canWrite: boolean }) {
  const company = details.company;
  const updateWithId = updateCompany.bind(null, company.id);
  const [state, action, pending] = useActionState<CrmActionState, FormData>(updateWithId, undefined);
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
    <form action={action}>
      <fieldset disabled={!canWrite || pending} className="space-y-6 disabled:opacity-70">
        <Card>
          <CardHeader><CardTitle>Company information</CardTitle><CardDescription>Identity, market segment, and primary contact details.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Company / customer name" id="company-name"><Input id="company-name" name="name" defaultValue={company.name} required /></Field>
            <Field label="Website" id="company-website"><Input id="company-website" name="website" defaultValue={company.website} inputMode="url" /></Field>
            <Field label="Country" id="company-country"><Input id="company-country" name="country" defaultValue={company.country === "Unknown" ? "" : company.country} required /></Field>
            <Field label="City" id="company-city"><Input id="company-city" name="city" defaultValue={company.city} /></Field>
            <div className="sm:col-span-2"><Field label="Segment" id="company-segment"><Input id="company-segment" name="segment" defaultValue={company.segment} required /></Field></div>
            <Field label="Primary contact" id="contact-name"><Input id="contact-name" name="contactName" defaultValue={company.contact === "No contact yet" ? "" : company.contact} /></Field>
            <Field label="Contact role" id="contact-role"><Input id="contact-role" name="contactRole" defaultValue={company.contactRole === "Role not confirmed" ? "" : company.contactRole} /></Field>
            <div className="sm:col-span-2"><Field label="Business email" id="contact-email"><Input id="contact-email" name="contactEmail" type="email" defaultValue={company.email} /></Field></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Pipeline and automation</CardTitle><CardDescription>Status, expected order, and the next tracked follow-up.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" id="company-stage"><Select name="stage" defaultValue={stageValue[company.stage]}><SelectTrigger id="company-stage" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{stageOptions.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Next follow-up" id="company-followup"><Input id="company-followup" name="nextFollowupAt" type="datetime-local" defaultValue={toLocalDateTime(company.nextFollowupAt)} /></Field>
            <Field label="Estimated order quantity" id="company-quantity"><Input id="company-quantity" name="estimatedOrderQuantity" type="number" min="0" step="1" defaultValue={company.estimatedOrderQuantity ?? ""} /></Field>
            <Field label="Estimated value" id="company-value"><Input id="company-value" name="estimatedValue" type="number" min="0" step="0.01" defaultValue={company.estimatedValue ?? ""} /></Field>
            <Field label="Currency" id="company-currency"><Select name="currency" defaultValue={company.currency}><SelectTrigger id="company-currency" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["USD", "EUR", "GBP", "CNY"].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Fit score (1–10)" id="company-fit"><Input id="company-fit" name="fitScore" type="number" min="1" max="10" defaultValue={company.fitScore || ""} /></Field>
            <div className="sm:col-span-2"><Field label="Interest tags (comma separated)" id="company-tags"><Input id="company-tags" name="tags" defaultValue={company.tags.join(", ")} /></Field></div>
            <div className="sm:col-span-2"><Field label="Profile summary" id="company-summary"><Textarea id="company-summary" name="summary" className="min-h-28" defaultValue={company.summary === "This company has not been profiled yet." ? "" : company.summary} /></Field></div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between gap-4">
          <div>{state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state?.success && <p role="status" className="text-sm text-primary">{state.success}</p>}</div>
          <Button type="submit" disabled={!canWrite || pending}><Save />{pending ? "Saving…" : "Save changes"}</Button>
        </div>
      </fieldset>
    </form>

    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Record summary</CardTitle><CardDescription>Current source and outreach state.</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2 rounded-lg border p-3"><AssignedOwner name={company.ownerName} initials={company.ownerInitials} assigned={Boolean(company.ownerId)} label="Assigned BD Manager" /></div>
          <Summary label="Source" value={company.sourceLabel} />
          <Summary label="Outreach" value={company.outreachStatus} />
          <Summary label="Status" value={company.stage} />
          <Summary label="Next action" value={company.nextAction} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Activity history</CardTitle><CardDescription>Emails, catalogs, automation, and edits in time order.</CardDescription></CardHeader>
        <CardContent>
          {details.activity.length ? <ol className="space-y-0">{details.activity.map((item, index) => <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">{index < details.activity.length - 1 && <span className="absolute top-7 bottom-0 left-3 w-px bg-border" />}<span className="relative z-10 grid size-6 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground"><ActivityIcon item={item} /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium capitalize">{item.title}</p><Badge variant="secondary" className="text-[10px]">{item.actor}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p><time className="mt-1 block text-[11px] text-muted-foreground" dateTime={item.createdAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time></div></li>)}</ol> : <p className="text-sm text-muted-foreground">No activity has been recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}
