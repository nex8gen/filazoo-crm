"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Bot, Building2, CheckCircle2, Clock3, FileText, Mail, Save, Sparkles, UserRound, UsersRound, Workflow } from "lucide-react";
import { updateCompany, type CrmActionState } from "@/app/crm-actions";
import { AssignedOwner } from "@/components/assigned-owner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { pipelineStageLabels, pipelineStageValues, type CompanyActivity, type CompanyDetails as CompanyDetailsType, type PipelineStageValue } from "@/lib/types";

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

function suggestedFollowup(stage: PipelineStageValue, activity: CompanyActivity[]) {
  const latest = activity[0]?.createdAt ? new Date(activity[0].createdAt) : new Date();
  const dayDelay: Record<PipelineStageValue, number> = { new: 0, contacted: 3, replied: 1, interested: 2, big_order: 2, won: 14, lost: 30 };
  const next = new Date(Math.max(Date.now(), latest.getTime()));
  next.setDate(next.getDate() + dayDelay[stage]);
  next.setHours(10, 0, 0, 0);
  if (next.getDay() === 0) next.setDate(next.getDate() + 1);
  if (next.getDay() === 6) next.setDate(next.getDate() + 2);
  const reason: Record<PipelineStageValue, string> = {
    new: "Review the new profile today and prepare the first outreach.",
    contacted: "No reply after a catalog is best followed up in 3 business days.",
    replied: "A customer reply is high intent; respond within one business day.",
    interested: "Keep momentum with a focused follow-up in 2 business days.",
    big_order: "Confirm quote details and purchasing timing within 2 business days.",
    won: "Check delivery and satisfaction after the order is confirmed.",
    lost: "Place the profile into a light 30-day re-engagement cycle.",
  };
  return { value: toLocalDateTime(next.toISOString()), reason: reason[stage] };
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
  const [stage, setStage] = useState<PipelineStageValue>(stageValue[company.stage] || "new");
  const recommendation = useMemo(() => suggestedFollowup(stage, details.activity), [stage, details.activity]);
  const [nextFollowup, setNextFollowup] = useState(toLocalDateTime(company.nextFollowupAt) || recommendation.value);
  const latestEmail = details.activity.find((item) => item.type === "email");
  const aiInsight = company.summary === "This company has not been profiled yet."
    ? `${company.contact} at ${company.name} is currently in “${pipelineStageLabels[stage]}”. ${latestEmail ? `The latest email activity was “${latestEmail.detail}”.` : "No email conversation has been recorded yet."} Recommended next step: ${recommendation.reason}`
    : company.summary;

  return <div className="space-y-6">
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-violet-600" />AI insight</CardTitle><CardDescription>Short customer summary based on the connected profile and communication history.</CardDescription></div><Badge variant="secondary" className="w-fit">Updated from activity</Badge></CardHeader>
        <CardContent><p className="text-sm leading-6">{aiInsight}</p><div className="mt-4 flex flex-wrap gap-2">{company.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}{!company.tags.length ? <span className="text-xs text-muted-foreground">Interest tags will appear as the conversation develops.</span> : null}</div></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-4" />Unified profile</CardTitle><CardDescription>Customer records are matched to this company profile.</CardDescription></CardHeader>
        <CardContent className="space-y-3"><div className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm">Connected contacts</span><Badge variant="secondary">{details.contacts.length}</Badge></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-4 text-emerald-600" />Email and reply history is linked automatically.</div></CardContent>
      </Card>
    </div>

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
              <div className="sm:col-span-2"><Field label="Profile notes / AI summary" id="company-summary"><Textarea id="company-summary" name="summary" className="min-h-28" defaultValue={company.summary === "This company has not been profiled yet." ? "" : company.summary} placeholder="Add a durable summary of customer needs, preferences, objections, and buying intent." /></Field></div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-4"><div>{state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}{state?.success && <p role="status" className="text-sm text-primary">{state.success}</p>}</div><Button type="submit" disabled={!canWrite || pending}><Save />{pending ? "Saving…" : "Save follow-up details"}</Button></div>
        </div>

        <div className="space-y-6">
          <Card className="border-violet-200/70 bg-violet-50/40 dark:border-violet-500/20 dark:bg-violet-500/5">
            <CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="flex items-center gap-2"><Clock3 className="size-4 text-violet-600" />Next follow-up</CardTitle><Badge variant="secondary">Intelligent</Badge></div><CardDescription>{recommendation.reason}</CardDescription></CardHeader>
            <CardContent className="space-y-4"><Field label="Scheduled date and time" id="company-followup"><Input id="company-followup" name="nextFollowupAt" type="datetime-local" value={nextFollowup} onChange={(event) => setNextFollowup(event.target.value)} /></Field><Button type="button" variant="outline" size="sm" onClick={() => setNextFollowup(recommendation.value)}><Sparkles />Use suggested time</Button><div className="flex gap-2 rounded-lg border bg-background/80 p-3 text-xs leading-5 text-muted-foreground"><Workflow className="mt-0.5 size-4 shrink-0 text-primary" /><span>Saving the date enrolls this profile in follow-up tracking. Stage and no-reply flows can act on the same customer history.</span></div></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Ownership</CardTitle><CardDescription>Automatic assignment uses the active BD Manager with the fewest company profiles. Admins can change it manually from the pipeline.</CardDescription></CardHeader>
            <CardContent className="space-y-4"><div className="rounded-lg border p-3"><AssignedOwner name={company.ownerName} initials={company.ownerInitials} assigned={Boolean(company.ownerId)} label="Assigned BD Manager" /></div><Link href="/pipeline" className={buttonVariants({ variant: "outline", size: "sm" })}><UsersRound />Manage assignment</Link></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Connected customer profiles</CardTitle><CardDescription>Every contact belongs to the main company profile.</CardDescription></CardHeader>
            <CardContent className="space-y-2">{details.contacts.length ? details.contacts.map((contact) => <div key={contact.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{contact.name}</p><p className="truncate text-xs text-muted-foreground">{contact.role} · {contact.email}</p></div><Badge variant="outline" className="text-[10px] capitalize">{contact.verificationStatus}</Badge></div></div>) : <p className="text-sm text-muted-foreground">No customer contact is connected yet.</p>}</CardContent>
          </Card>
        </div>
      </fieldset>
    </form>

    <Card>
      <CardHeader className="sm:flex-row sm:items-end sm:justify-between"><div><CardTitle>Activity</CardTitle><CardDescription>Complete email, reply, catalog, automation, and profile history in one timeline.</CardDescription></div><Badge variant="outline">{details.activity.length} events</Badge></CardHeader>
      <CardContent>{details.activity.length ? <ol className="grid gap-0 lg:grid-cols-2 lg:gap-x-8">{details.activity.map((item) => <li key={item.id} className="relative flex gap-3 border-b py-4 first:pt-0 last:border-0"><span className="grid size-7 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground"><ActivityIcon item={item} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium capitalize">{item.title}</p>{item.direction ? <Badge variant={item.direction === "received" ? "default" : "secondary"} className="text-[10px]">{item.direction === "received" ? "Reply" : "Sent"}</Badge> : null}<Badge variant="outline" className="text-[10px]">{item.actor}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>{item.body ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap rounded-md bg-muted/60 p-2 text-xs leading-5 text-muted-foreground">{item.body}</p> : null}<time className="mt-2 block text-[11px] text-muted-foreground" dateTime={item.createdAt}>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</time></div></li>)}</ol> : <p className="text-sm text-muted-foreground">No activity has been recorded yet.</p>}</CardContent>
    </Card>
  </div>;
}
