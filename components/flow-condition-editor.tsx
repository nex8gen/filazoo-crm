"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { companyStatuses, emailCategories, pipelineStages, type JsonConfig } from "@/lib/flows";

const fields = [
  ["customer_replied", "Customer replied"], ["opened_email", "Opened email"], ["clicked_link", "Clicked link"],
  ["company_status_is", "Company status"], ["pipeline_stage_is", "Pipeline stage"], ["segment_is", "Company segment"],
  ["country_is", "Country"], ["fit_score_at_least", "Fit score"], ["category_is", "Email category"],
] as const;
const operators = [["equals", "Equals"], ["not_equals", "Does not equal"], ["contains", "Contains"], ["not_contains", "Does not contain"], ["starts_with", "Starts with"], ["ends_with", "Ends with"], ["is_set", "Is set"], ["is_not_set", "Is not set"], ["gte", "At least"], ["gt", "Greater than"], ["lte", "At most"], ["lt", "Less than"]] as const;
function Choice({ value, options, onChange, disabled, label }: { value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void; disabled: boolean; label: string }) {
  return <Select value={value} onValueChange={(next) => next && onChange(next)} disabled={disabled}><SelectTrigger className="w-full" aria-label={label}><SelectValue>{options.find(([id]) => id === value)?.[1] || value}</SelectValue></SelectTrigger><SelectContent>{options.map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}</SelectContent></Select>;
}

export function FlowConditionEditor({ config, onChange, disabled = false }: { config: JsonConfig; onChange: (config: JsonConfig) => void; disabled?: boolean }) {
  const rules = (Array.isArray(config.rules) ? config.rules : [config]) as JsonConfig[];
  const update = (index: number, rule: JsonConfig) => {
    const next = rules.map((item, i) => i === index ? rule : item);
    onChange(next.length === 1 ? next[0] : { match: config.match || "all", rules: next });
  };
  return <div className="space-y-3">
    {rules.length > 1 ? <Choice label="Match rules" value={String(config.match || "all")} onChange={(match) => onChange({ match, rules })} options={[["all", "Match all rules (AND)"], ["any", "Match any rule (OR)"]]} disabled={disabled} /> : null}
    {rules.map((rule, index) => {
      const field = String(rule.field || "customer_replied"), boolean = ["customer_replied", "opened_email", "clicked_link"].includes(field), numeric = field === "fit_score_at_least";
      const key = field === "category_is" ? "category" : field === "company_status_is" ? "companyStatus" : field === "pipeline_stage_is" ? "pipelineStage" : numeric ? "fitScore" : "value";
      const values = key === "category" ? emailCategories : key === "companyStatus" ? companyStatuses : key === "pipelineStage" ? pipelineStages : null;
      const set = (name: string, value: JsonConfig[string]) => update(index, { ...rule, [name]: value });
      const operator = String(rule.operator || (numeric ? "gte" : "equals"));
      return <div key={index} className="space-y-3 rounded-lg border bg-background p-3"><div className="flex items-center gap-2"><div className="min-w-0 flex-1"><Choice label={`Rule ${index + 1} field`} value={field} options={fields} onChange={(next) => update(index, { field: next, ...(next === "company_status_is" ? { companyStatus: "engaged" } : next === "pipeline_stage_is" ? { pipelineStage: "contacted" } : next === "category_is" ? { category: "Interested" } : next === "fit_score_at_least" ? { fitScore: 7 } : {}) })} disabled={disabled} /></div>{rules.length > 1 ? <Button variant="ghost" size="icon-xs" aria-label={`Remove rule ${index + 1}`} disabled={disabled} onClick={() => { const next = rules.filter((_, i) => i !== index); onChange(next.length === 1 ? next[0] : { match: config.match || "all", rules: next }); }}><Trash2 /></Button> : null}</div>
        {boolean ? <Choice label="Expected result" value={rule.negate ? "false" : "true"} options={[["true", "Is true"], ["false", "Is false"]]} onChange={(next) => set("negate", next === "false")} disabled={disabled} /> : <><Choice label="Comparison operator" value={operator} options={operators.filter(([id]) => numeric ? ["equals", "not_equals", "gte", "gt", "lte", "lt", "is_set", "is_not_set"].includes(id) : !["gte", "gt", "lte", "lt"].includes(id))} onChange={(next) => set("operator", next)} disabled={disabled} />{!["is_set", "is_not_set"].includes(operator) ? <Label className="grid gap-2 text-xs">Comparison value{values ? <Choice label="Comparison value" value={String(rule[key] || "")} options={values.map((value) => [value, value])} onChange={(value) => set(key, value)} disabled={disabled} /> : <Input value={String(rule[key] ?? "")} type={numeric ? "number" : "text"} min={numeric ? 0 : undefined} max={numeric ? 10 : undefined} maxLength={120} onChange={(event) => set(key, numeric ? Number(event.target.value) : event.target.value)} disabled={disabled} />}</Label> : null}</>}
      </div>;
    })}
    <Button size="sm" variant="outline" onClick={() => onChange({ match: config.match || "all", rules: [...rules, { field: "customer_replied" }] })} disabled={disabled || rules.length >= 20}><Plus />Add rule</Button>
  </div>;
}
