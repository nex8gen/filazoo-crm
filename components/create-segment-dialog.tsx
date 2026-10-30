"use client";

import { useActionState, useState } from "react";
import { Building2, Filter, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { createSegment, updateSegment, type SegmentActionState } from "@/app/segment-actions";
import { SegmentCompanyPicker } from "@/components/segment-company-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { matchesSegment, type SavedSegment, type SegmentCompany, type SegmentRules } from "@/lib/segments";

const selectClass = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function CreateSegmentDialog({ companies, segment, onClose }: { companies: SegmentCompany[]; segment?: SavedSegment; onClose: () => void }) {
  const [mode, setMode] = useState<"manual" | "rules">(segment && segment.rules.companyIds === undefined ? "rules" : "manual");
  const [selectedIds, setSelectedIds] = useState<string[]>(segment?.rules.companyIds ?? []);
  const [rules, setRules] = useState<SegmentRules>(segment?.rules.companyIds === undefined ? segment?.rules ?? {} : {});
  const submittedRules = mode === "manual" ? { companyIds: selectedIds } : rules;
  const [state, action, pending] = useActionState(async (previous: SegmentActionState, formData: FormData) => {
    try {
      const result = await (segment ? updateSegment : createSegment)(previous, formData);
      if (result.success) { toast.success(result.success); onClose(); }
      return result;
    } catch { return { error: "Unable to create the segment. Please try again." }; }
  }, {});
  const matches = companies.filter((company) => matchesSegment(company, submittedRules));
  const countries = [...new Set(companies.map((company) => company.country))].sort();
  const businessSegments = [...new Set(companies.map((company) => company.segment))].sort();
  const sources = [...new Map(companies.map((company) => [company.source, company.sourceLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  function setRule(key: keyof SegmentRules, value: string | number | boolean | undefined) {
    setRules((previous) => {
      const next = { ...previous };
      if (value !== undefined && value !== "") Object.assign(next, { [key]: value }); else delete next[key];
      return next;
    });
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="sm:max-w-3xl" showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle>{segment ? "Edit segment" : "Create segment"}</DialogTitle>
        <DialogDescription>Choose individual companies or build an audience with rules.</DialogDescription>
      </DialogHeader>
      <form action={action} className="space-y-5">
        {rules.stage ? <div role="alert" className="rounded-lg border p-3 text-xs"><p>This audience uses a retired sales rule. Review the membership before rebuilding its rules.</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setRules(({ stage: _stage, ...current }) => { void _stage; return current; })}>Remove retired rule</Button></div> : null}
        <input type="hidden" name="rules" value={JSON.stringify(submittedRules)} />
        {segment ? <input type="hidden" name="segmentId" value={segment.id} /> : null}
        <fieldset disabled={pending} className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0 space-y-4">
            <div className="space-y-1.5"><Label htmlFor="segment-name">Segment name</Label><Input id="segment-name" name="name" defaultValue={segment?.name} placeholder="e.g. High-fit wholesale prospects" minLength={2} maxLength={120} required autoFocus /></div>
            <div className="space-y-1.5"><Label htmlFor="segment-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="segment-description" name="description" defaultValue={segment?.description} placeholder="What makes this audience useful?" maxLength={500} rows={2} /></div>
            <fieldset className="flex flex-wrap gap-4 border-t pt-4"><legend className="sr-only">Segment membership</legend><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name="membership" checked={mode === "manual"} onChange={() => setMode("manual")} className="accent-primary" />Choose companies</label><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name="membership" checked={mode === "rules"} onChange={() => setMode("rules")} className="accent-primary" />Use rules</label></fieldset>
            {mode === "manual" ? <SegmentCompanyPicker companies={companies} selectedIds={selectedIds} onChange={setSelectedIds} /> : <>
            <div><div className="flex items-center gap-2 text-sm font-medium"><Filter className="size-4 text-primary" />Audience rules</div><p className="mt-1 text-xs text-muted-foreground">Companies must match all selected rules. Leave rules empty to include all companies.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="segment-business">Business segment</Label><select id="segment-business" className={selectClass} value={rules.businessSegment ?? ""} onChange={(event) => setRule("businessSegment", event.target.value)}><option value="">Any business segment</option>{businessSegments.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="segment-country">Country</Label><select id="segment-country" className={selectClass} value={rules.country ?? ""} onChange={(event) => setRule("country", event.target.value)}><option value="">Any country</option>{countries.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="segment-source">Lead source</Label><select id="segment-source" className={selectClass} value={rules.source ?? ""} onChange={(event) => setRule("source", event.target.value)}><option value="">Any lead source</option>{sources.map(([value, label]) => <option key={value} value={value}>{label} ({value.replaceAll("_", " ")})</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="segment-fit">Minimum fit score</Label><select id="segment-fit" className={selectClass} value={rules.minFitScore ?? ""} onChange={(event) => setRule("minFitScore", event.target.value ? Number(event.target.value) : undefined)}><option value="">Any fit score</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / 10 or higher</option>)}</select></div>
              <div className="space-y-1.5"><Label htmlFor="segment-email">Contact email</Label><select id="segment-email" className={selectClass} value={rules.hasEmail === undefined ? "" : String(rules.hasEmail)} onChange={(event) => setRule("hasEmail", event.target.value ? event.target.value === "true" : undefined)}><option value="">Any email availability</option><option value="true">Has contact email</option><option value="false">Missing contact email</option></select></div>
            </div></>}
          </div>
          <aside className="min-w-0 self-start rounded-lg border bg-muted/30 p-4">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><RefreshCw className="size-3.5" />Live audience preview</p>
            <div aria-live="polite" aria-atomic="true" className="mt-4"><p className="text-3xl font-semibold tabular-nums">{matches.length.toLocaleString()}</p><p className="mt-1 text-xs text-muted-foreground">Matching companies</p></div>
            <div className="mt-4 space-y-3 border-t pt-4">{matches.slice(0, 5).map((company) => <div key={company.id} className="flex items-start gap-2"><Building2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p data-no-translate className="truncate text-xs font-medium">{company.name}</p><p className="truncate text-xs text-muted-foreground">{company.country}</p></div></div>)}{matches.length > 5 ? <p className="text-xs text-muted-foreground">+{matches.length - 5} more companies</p> : null}{!matches.length ? <p className="text-xs leading-5 text-muted-foreground">{mode === "manual" ? "Choose companies from the list to build your segment." : "No companies match yet. You can save this segment; future matches will appear automatically."}</p> : null}</div>
            <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">A company can belong to multiple saved segments.</p>
          </aside>
        </fieldset>
        {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={pending}>Cancel</Button><Button type="submit" disabled={pending || (mode === "manual" && !selectedIds.length)}>{pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{pending ? "Saving…" : segment ? "Save segment" : "Create segment"}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
