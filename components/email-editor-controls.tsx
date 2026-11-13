"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Type } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import "./email-editor-controls.css";

/** Inspector controls share one label column, filled surface, and focus treatment. */
export function EditorSelect({ label, value, options, onChange, font = false, compact = false }: {
  label: string;
  value: string;
  options: { value: string; label: string; iconSrc?: string }[];
  onChange: (value: string) => void;
  font?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  return <div className="editor-propertyField" data-compact={compact || undefined}>
    <label htmlFor={id}>{label}</label>
    <Select value={value} onValueChange={next => { if (next !== null) onChange(next); }}>
      <SelectTrigger id={id} aria-label={label} className="editor-select-trigger">{font ? <Type className="editor-select-fontIcon" /> : null}<SelectValue /></SelectTrigger>
      <SelectContent className="editor-select-popup">{options.map(option => <SelectItem key={option.value} value={option.value} style={font ? { fontFamily: option.value } : undefined}>{option.iconSrc ?
        // Bundled raster icons are already optimized and work without a network request.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="email-editor-optionIcon" src={option.iconSrc} alt="" width={16} height={16} /> : null}{option.label}</SelectItem>)}</SelectContent>
    </Select>
  </div>;
}

export function EditorNumberControl({ label, value, min = 0, max = 100, onChange, unit = "px", disabled = false, auto = false, step = 1, compact = false, prefix }: {
  label: string; value: number; min?: number; max?: number; onChange: (value: number) => void; unit?: string; disabled?: boolean; auto?: boolean; step?: number;
  compact?: boolean; prefix?: ReactNode;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  if (draft.source !== value) setDraft({ source: value, text: String(value) });
  const text = draft.source === value ? draft.text : String(value);
  function commit(raw: string) {
    const next = raw.trim() && Number.isFinite(Number(raw)) ? Number(Math.max(min, Math.min(max, Math.round(Number(raw) / step) * step)).toFixed(4)) : value;
    onChange(next); setDraft({ source: next, text: String(next) });
  }
  return <div className="editor-propertyField" data-compact={compact || undefined}>
    <label htmlFor={id}>{label}</label>
    <div className="editor-valueInput" title={label} data-disabled={disabled || auto || undefined}>
      {prefix ? <span className="editor-valuePrefix" aria-hidden="true">{prefix}</span> : null}
      <Input id={id} type="number" aria-label={label} min={min} max={max} step={step} disabled={disabled || auto} placeholder={auto ? "auto" : undefined} value={auto ? "" : text} onChange={event => {
        const raw = event.target.value;
        const next = Number(raw);
        const valid = raw !== "" && Number.isFinite(next) && Math.abs(next / step - Math.round(next / step)) < .00001 && next >= min && next <= max;
        setDraft({ source: valid ? next : value, text: raw });
        if (valid) onChange(next);
      }} onBlur={event => commit(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      <span className="editor-unit" aria-hidden="true">{unit}</span>
      <div className="editor-stepper">
        <button type="button" aria-label={`Increase ${label.toLowerCase()}`} title={`Increase ${label.toLowerCase()}`} disabled={disabled || auto || value >= max} onMouseDown={event => event.preventDefault()} onClick={() => commit(String(value + step))}><ChevronUp /></button>
        <button type="button" aria-label={`Decrease ${label.toLowerCase()}`} title={`Decrease ${label.toLowerCase()}`} disabled={disabled || auto || value <= min} onMouseDown={event => event.preventDefault()} onClick={() => commit(String(value - step))}><ChevronDown /></button>
      </div>
    </div>
  </div>;
}

export function EditorColorControl({ label, value, onChange, transparent = false, compact = false }: {
  label: string; value: string; onChange: (color: string) => void; transparent?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ source: value, text: value });
  if (draft.source !== value) setDraft({ source: value, text: value });
  const text = draft.source === value ? draft.text : value;
  function commit(raw: string) {
    let next = raw.trim();
    if (/^#[a-f\d]{3}$/i.test(next)) next = "#" + [...next.slice(1)].map(char => char + char).join("");
    if (/^#[a-f\d]{6}$/i.test(next) || transparent && next === "transparent") onChange(next);
    else next = value;
    setDraft({ source: next, text: next });
  }
  return <div className="editor-propertyField editor-colorField" data-compact={compact || undefined}>
    <label htmlFor={id}>{label}</label>
    <div className="editor-colorInput">
      <label className="editor-colorSwatch" title={`Choose ${label.toLowerCase()}`}>
        <span aria-hidden="true" style={{ backgroundColor: value }} />
        <input type="color" aria-label={label} value={value === "transparent" ? "#ffffff" : value} onChange={event => onChange(event.target.value)} />
      </label>
      <Input id={id} aria-label={`${label} hex value`} value={text} spellCheck={false} onChange={event => {
        const raw = event.target.value;
        setDraft({ source: value, text: raw });
        if (/^#[a-f\d]{6}$/i.test(raw)) onChange(raw);
      }} onBlur={event => commit(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
    </div>
    {transparent ? <label className="editor-switchRow"><span>Transparent background</span><span className="editor-switch"><input type="checkbox" aria-label={label === "Background color" ? "Transparent background" : `${label} transparent`} checked={value === "transparent"} onChange={event => onChange(event.target.checked ? "transparent" : "#ffffff")} /><span aria-hidden="true" /></span></label> : null}
  </div>;
}
