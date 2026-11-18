"use client";

import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from "react";
import type { FlowPanelEditor } from "@/lib/flow-editor-session";
import { Clock3, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { applyWaitDraft, maxWaitAmount, waitDraftChanged, waitEditorDraft, waitUnits } from "@/lib/flow-wait-editor";
import type { JsonConfig } from "@/lib/flows";

export function FlowWaitPanel({ config, onChange, onClose, disabled, trail = [], footer, editorRef, onDirtyChange }: { config: JsonConfig; onChange: (config: JsonConfig) => void; onClose: () => void; disabled: boolean; trail?: string[]; footer?: ReactNode; editorRef?: Ref<FlowPanelEditor>; onDirtyChange?: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState(() => waitEditorDraft(config));
  const changed = waitDraftChanged(config, draft);
  const result = applyWaitDraft(config, draft);
  const update = (change: Partial<typeof draft>) => { if (!disabled) setDraft(current => ({ ...current, ...change })); };
  const save = () => { if (!disabled && changed && result.ok) { onChange(result.config); onClose(); } };
  useEffect(() => { onDirtyChange?.(changed); }, [changed, onDirtyChange]);
  useImperativeHandle(editorRef, () => ({ hasChanges: () => changed, snapshot: () => ({ config: result.ok ? result.config : { ...config, amount: draft.amount, unit: draft.unit, businessDays: draft.businessDays, resumeAt: draft.specificTime ? draft.resumeAt : "" } }), prepare: () => result.ok ? { ok: true, config: result.config } : { ok: false }, reset: () => setDraft(waitEditorDraft(config)) }));

  return <aside className="wf-panel wf-inspector wf-wait-panel" aria-label="Time delay settings">
    <div className="wf-settings-heading"><span className="wf-settings-icon"><Clock3 /></span><h2>Time delay details</h2><Button type="button" variant="ghost" size="icon-sm" aria-label="Close time delay settings" onClick={onClose}><X /></Button></div>
    <div className="wf-inspector-content scroll-surface">
      {trail.length ? <nav className="wf-action-location" aria-label="Action location"><span translate="no">{trail.join(" / ")}</span></nav> : null}
      <div className="wf-wait-settings">
        <h3>Settings</h3>
        <div className="wf-wait-duration"><Label htmlFor="flow-wait-amount">Set time delay</Label><div>
          <Input id="flow-wait-amount" aria-label="Delay amount" type="number" min={1} max={maxWaitAmount} step={1} value={draft.amount} disabled={disabled} aria-invalid={changed && !result.ok} onChange={event => update({ amount: event.target.value })} />
          <Select value={draft.unit} onValueChange={value => { if (value) update({ unit: value }); }} disabled={disabled}><SelectTrigger className="w-full" aria-label="Delay unit"><SelectValue /></SelectTrigger><SelectContent>{waitUnits.map(unit => <SelectItem key={unit} value={unit}>{unit.charAt(0).toUpperCase() + unit.slice(1)}</SelectItem>)}</SelectContent></Select>
        </div></div>
        <div className="wf-wait-option"><label><Checkbox aria-label="Delay until a specific time of day" checked={draft.specificTime} disabled={disabled} onCheckedChange={checked => update({ specificTime: checked === true })} /><span>Delay until a specific time of day</span></label>
          {draft.specificTime ? <div className="wf-wait-time"><Label htmlFor="flow-wait-time">Time of day (UTC)</Label><TimePicker id="flow-wait-time" aria-label="Time of day (UTC)" value={draft.resumeAt} disabled={disabled} onValueChange={resumeAt => update({ resumeAt })} /><p>The workflow resumes at this time after the delay. Times use UTC.</p></div> : null}
        </div>
        <div className="wf-wait-option"><label><Checkbox aria-label="Count business days only" checked={draft.businessDays} disabled={disabled} onCheckedChange={checked => update({ businessDays: checked === true })} /><span>Count business days only<small>Monday–Friday. Weekends are skipped.</small></span></label></div>
        <div className="wf-wait-option"><label><Checkbox aria-label="Count from trigger time" checked={draft.anchor === "trigger"} disabled={disabled} onCheckedChange={checked => update({ anchor: checked === true ? "trigger" : "previous_action" })} /><span>Count from trigger time<small>Use cumulative milestones instead of gaps between messages.</small></span></label></div>
        {changed && !result.ok ? <p role="alert" className="wf-wait-error">{result.error}</p> : null}
      </div>
    </div>
    {footer ?? <div className="wf-settings-footer"><Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button><Button type="button" size="sm" disabled={disabled || !changed || !result.ok} onClick={save}>Save</Button></div>}
  </aside>;
}
