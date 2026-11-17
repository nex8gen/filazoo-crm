"use client";

import { Check, CircleDashed, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FlowPanelSaveControls({ dirty, saving, autoSaving = false, disabled, onSave, onCancel, cancelLabel = "Close" }: {
  dirty: boolean; saving: boolean; autoSaving?: boolean; disabled: boolean; onSave: () => void; onCancel: () => void; cancelLabel?: string;
}) {
  return <div className="wf-settings-footer wf-save-footer">
    <span className="wf-save-state" data-dirty={dirty && !autoSaving || undefined} role="status">{saving || autoSaving ? <><LoaderCircle className="animate-spin" />Saving…</> : dirty ? <><CircleDashed />Unsaved changes</> : <><Check />All changes saved</>}</span>
    <div className="wf-save-footer-buttons"><Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>{cancelLabel}</Button>{!disabled ? <Button type="button" size="sm" onClick={onSave} disabled={saving || autoSaving || !dirty}>{saving ? "Saving…" : "Save"}</Button> : null}</div>
  </div>;
}
