"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { assignmentCapacity, leadAssignmentSettingsSchema, nextAssignment, type LeadAssignmentView } from "@/lib/lead-assignment-settings";
import { updateLeadAssignmentSettings } from "./lead-assignment-actions";
import { useUnsavedSettings } from "./use-unsaved-settings";

function draftOf(view: LeadAssignmentView) {
  return { enabled: view.enabled, strategy: view.strategy, workload: view.workload, members: view.members.map(member => ({ ...member, limit: member.capacity === null ? "" : String(member.capacity) })) };
}

export function LeadAssignmentForm({ initial }: { initial: LeadAssignmentView }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(saved));
  useUnsavedSettings(dirty);
  const preview = nextAssignment({ ...saved, ...draft, members: draft.members.map(member => ({ ...member, capacity: assignmentCapacity(member.limit) })) });
  const available = draft.members.filter(member => member.activated && member.enabled && (member.limit === "" || member[draft.workload === "open" ? "open" : "total"] < Number(member.limit))).length;
  function change(next: typeof draft) { if (saving.current) return; setDraft(next); setError(""); setSuccess(false); }
  function save() {
    if (saving.current || pending || !dirty) return;
    const parsed = leadAssignmentSettingsSchema.safeParse({ revision: saved.revision, enabled: draft.enabled, strategy: draft.strategy, workload: draft.workload, members: draft.members.map(member => ({ userId: member.userId, enabled: member.enabled, capacity: assignmentCapacity(member.limit) })) });
    if (!parsed.success) { setError("Enter whole-number capacities from 1 to 1,000,000, or leave them blank for unlimited."); return; }
    saving.current = true;
    startTransition(async () => {
      setError(""); setSuccess(false);
      try {
        const result = await updateLeadAssignmentSettings(parsed.data);
        if (result.error) setError(result.error);
        if ("saved" in result && result.saved) { setSaved(result.saved); setDraft(draftOf(result.saved)); setSuccess(true); }
      } catch { setError("Unable to save lead assignment settings. Please retry."); }
      finally { saving.current = false; }
    });
  }
  const assignmentStatus = !draft.enabled ? "Paused" : preview ? "Active" : "No available managers";

  return <form onSubmit={event => { event.preventDefault(); save(); }} className="settings-assignment-form">
    <fieldset disabled={pending} className="settings-assignment-fields">
      <section className="settings-form-row" aria-labelledby="assignment-rules-title">
        <div className="settings-row-heading">
          <h2 id="assignment-rules-title">Automatic assignment</h2>
          <p>Distribute unowned incoming leads from Shopify and Meta using your team rules.</p>
        </div>
        <div className="settings-row-content settings-assignment-controls">
          <div className="settings-panel settings-assignment-toggle">
            <div>
              <div className="settings-assignment-toggle-heading">
                <label htmlFor="assignment-enabled">Enable automatic assignment</label>
                <Badge variant="outline" data-status={assignmentStatus}>{assignmentStatus}</Badge>
              </div>
              <p id="assignment-enabled-help">When paused, incoming unowned leads stay unassigned.</p>
            </div>
            <Switch id="assignment-enabled" aria-describedby="assignment-enabled-help" checked={draft.enabled} onCheckedChange={enabled => change({ ...draft, enabled })} />
          </div>
          <div className="settings-assignment-rule-fields">
            <div className="settings-assignment-field">
              <label htmlFor="assignment-strategy">Distribution rule</label>
              <select id="assignment-strategy" aria-describedby="assignment-strategy-help" value={draft.strategy} onChange={event => change({ ...draft, strategy: event.target.value as typeof draft.strategy })}>
                <option value="lowest_workload">Lowest workload</option><option value="round_robin">Round robin</option>
              </select>
              <p id="assignment-strategy-help">{draft.strategy === "lowest_workload" ? "Choose the available manager with the fewest company profiles. The oldest assignment breaks ties." : "Rotate through available managers, starting with whoever received a lead least recently."}</p>
            </div>
            <div className="settings-assignment-field">
              <label htmlFor="assignment-workload">Count workload and capacity using</label>
              <select id="assignment-workload" aria-describedby="assignment-workload-help" value={draft.workload} onChange={event => change({ ...draft, workload: event.target.value as typeof draft.workload })}>
                <option value="all">All assigned companies</option><option value="open">Open companies only</option>
              </select>
              <p id="assignment-workload-help">Open companies exclude won and lost deals. Capacity limits apply to both distribution rules.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-form-row" aria-labelledby="assignment-managers-title">
        <div className="settings-row-heading">
          <h2 id="assignment-managers-title">Manager participation & capacity</h2>
          <p>Pause individual managers and limit their workload. Leave capacity blank for unlimited.</p>
        </div>
        <div className="settings-row-content">
          {draft.members.length ? <ul className="settings-panel settings-assignment-members">
            {draft.members.map((member, index) => {
              const count = member[draft.workload === "open" ? "open" : "total"];
              const status = !member.activated ? "Awaiting activation" : !member.enabled ? "Paused" : member.limit !== "" && count >= Number(member.limit) ? "At capacity" : "Available";
              return <li key={member.userId} className="settings-assignment-member">
                <div className="settings-assignment-member-info">
                  <p className="settings-assignment-member-name">{member.name}</p>
                  <p>{member.open} open / {member.total} total</p>
                  <Badge variant="outline" data-status={status}>{status}</Badge>
                </div>
                <div className="settings-assignment-field">
                  <label htmlFor={`capacity-${member.userId}`}>Company capacity</label>
                  <Input id={`capacity-${member.userId}`} aria-label={`Company capacity for ${member.name}`} type="number" min="1" max="1000000" step="1" placeholder="Unlimited" value={member.limit} onChange={event => change({ ...draft, members: draft.members.map((item, position) => position === index ? { ...item, limit: event.target.value } : item) })} />
                </div>
                <div className="settings-assignment-participation">
                  <label htmlFor={`participation-${member.userId}`}>Automatic</label>
                  <Switch id={`participation-${member.userId}`} aria-label={`Automatic assignment for ${member.name}`} disabled={!member.activated || pending} checked={member.enabled} onCheckedChange={enabled => change({ ...draft, members: draft.members.map((item, position) => position === index ? { ...item, enabled } : item) })} />
                </div>
              </li>;
            })}
          </ul> : <p className="settings-panel p-5 text-sm text-muted-foreground">No BD Managers yet. Add a manager in Team and access to start automatic assignment.</p>}
          <Button className="settings-assignment-team-link" variant="ghost" nativeButton={false} render={<Link href="/settings/team" />}>Manage team members<ArrowRight className="size-4" /></Button>
        </div>
      </section>

      <section className="settings-form-row" aria-labelledby="assignment-preview-title">
        <div className="settings-row-heading">
          <h2 id="assignment-preview-title">Assignment preview</h2>
          <p>{dirty ? "Based on your unsaved rules and current workload." : "Based on saved rules and current workload."}</p>
        </div>
        <div className="settings-row-content settings-assignment-preview">
          <div className="settings-panel settings-assignment-preview-panel">
            <div className="settings-assignment-next">
              <p>Next eligible manager</p>
              <p className="settings-assignment-next-name" aria-live="polite">{!draft.enabled ? "Assignment paused" : preview?.name || "No available managers"}</p>
              <p>{!draft.enabled || !preview ? "New unowned leads will stay in the unassigned queue." : "Previewing does not assign a lead or change the rotation."}</p>
            </div>
            <div className="settings-assignment-stats">
              <p><span>Available managers</span><strong>{available} / {draft.members.length}</strong></p>
              <p><span>Unassigned company profiles</span><strong>{saved.unassigned}</strong></p>
            </div>
          </div>
          <p>Existing owners and manually created companies keep their ownership. Saving rules does not redistribute the unassigned queue.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/companies" />}>Open company assignments<ArrowRight className="size-4" /></Button>
          <p>Administrators can manually assign a company to any active BD Manager, including managers paused for automatic assignment.</p>
        </div>
      </section>
    </fieldset>
    {error ? <NotificationToast>{error}</NotificationToast> : null}
    <footer className="settings-assignment-footer">
      <p role="status" aria-live="polite">{pending ? "Saving assignment rules..." : dirty ? "You have unsaved assignment rules." : success ? "Assignment rules saved." : "Changes apply to future assignments after saving."}</p>
      <div><Button type="button" variant="outline" disabled={pending || !dirty} onClick={() => change(draftOf(saved))}>Discard changes</Button><Button type="submit" disabled={pending || !dirty}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}Save assignment rules</Button></div>
    </footer>
  </form>;
}
