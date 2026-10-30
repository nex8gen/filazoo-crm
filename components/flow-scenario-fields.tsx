"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FlowFacts } from "@/lib/flow-engine";

export function FlowScenarioFields({ facts, onChange, disabled = false }: { facts: FlowFacts; onChange: (facts: FlowFacts) => void; disabled?: boolean }) {
  return <fieldset disabled={disabled} className="space-y-3">
    <div className="flex flex-wrap gap-x-4 gap-y-2">{([
      ["customerReplied", "Customer replied"], ["openedEmail", "Opened email"], ["clickedLink", "Clicked link"],
    ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={facts[key]} onCheckedChange={(value) => onChange({ ...facts, [key]: value === true })} />{label}</label>)}</div>
    <div className="grid grid-cols-2 gap-3">{([
      ["companyStatus", "Company status"], ["segment", "Company segment"], ["country", "Country"], ["category", "Email category"],
    ] as const).map(([key, label]) => <Label key={key} className="grid gap-1.5 text-xs">{label}<Input value={facts[key] ?? ""} maxLength={100} onChange={(event) => onChange({ ...facts, [key]: event.target.value || null })} /></Label>)}<Label className="grid gap-1.5 text-xs">Fit score<Input type="number" min={0} max={10} value={facts.fitScore ?? ""} onChange={(event) => onChange({ ...facts, fitScore: event.target.value === "" ? null : Number(event.target.value) })} /></Label></div>
  </fieldset>;
}
