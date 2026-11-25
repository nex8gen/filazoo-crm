"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function EditorSettingsGroup({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return <details className="pb-settings-group" open={open}><summary>{title}<ChevronDown /></summary><div>{children}</div></details>;
}
export function EditorRange({ label, value, min, max, step = 1, unit = "px", onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return <div className="pb-field"><Label htmlFor={id}>{label}</Label><div className="pb-range-field"><input id={id} type="range" min={min} max={max} step={step} value={value} onChange={event => { setDraft(null); onChange(Number(event.target.value)); }} /><Input aria-label={`${label} value`} type="number" min={min} max={max} step={step} value={draft ?? value} onChange={event => { setDraft(event.target.value); const next = event.target.valueAsNumber; if (Number.isFinite(next) && next >= min && next <= max) onChange(Math.round(next)); }} onBlur={() => { if (draft !== null && draft.trim() && Number.isFinite(Number(draft))) { const next = Math.min(max, Math.max(min, Math.round(Number(draft)))); if (next !== value) onChange(next); } setDraft(null); }} />{unit && <span>{unit}</span>}</div></div>;
}
export function EditorColor({ label, value, fallback = "#171717", onChange }: { label: string; value: string; fallback?: string; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="pb-field"><Label htmlFor={id}>{label}</Label><div className="pb-color-field"><input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : fallback} onChange={event => onChange(event.target.value)} /><Input aria-label={`${label} hex`} value={value} placeholder="Inherit" maxLength={7} onChange={event => onChange(event.target.value)} /><Button type="button" variant="ghost" size="sm" aria-label={`Reset ${label.toLowerCase()}`} disabled={!value} onClick={() => onChange("")}>Reset</Button></div></div>;
}
export function EditorToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <div className="pb-feature"><Label htmlFor={id}>{label}</Label><Switch id={id} checked={checked} onCheckedChange={onChange} /></div>;
}
