"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { ArrowRight, LoaderCircle, Shuffle, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { assignmentCapacity, leadAssignmentSettingsSchema, nextAssignment, type LeadAssignmentView } from "@/lib/lead-assignment-settings";
import { updateLeadAssignmentSettings } from "./lead-assignment-actions";

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
  return <form onSubmit={event => { event.preventDefault(); save(); }} className="space-y-5">
    <fieldset disabled={pending} className="min-w-0 space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="shadow-none">
          <CardHeader><div className="mb-2 flex items-center justify-between"><span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Shuffle className="size-4" /></span><Badge variant={saved.enabled && saved.members.some(member => member.enabled && member.activated && (member.capacity === null || member[saved.workload === "open" ? "open" : "total"] < member.capacity)) ? "default" : "outline"}>{!saved.enabled ? "Paused" : nextAssignment(saved) ? "Active" : "No available managers"}</Badge></div><CardTitle>Automatic assignment</CardTitle><CardDescription>Distribute unowned incoming leads from Shopify and Meta using your team rules.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4"><div><label htmlFor="assignment-enabled" className="text-sm font-medium">Enable automatic assignment</label><p className="mt-1 text-xs leading-5 text-muted-foreground">When paused, incoming unowned leads stay unassigned.</p></div><Switch id="assignment-enabled" checked={draft.enabled} onCheckedChange={enabled => change({ ...draft, enabled })} /></div>
            <div className="space-y-2"><label htmlFor="assignment-strategy" className="text-sm font-medium">Distribution rule</label><select id="assignment-strategy" value={draft.strategy} onChange={event => change({ ...draft, strategy: event.target.value as typeof draft.strategy })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="lowest_workload">Lowest workload</option><option value="round_robin">Round robin</option></select><p className="text-xs leading-5 text-muted-foreground">{draft.strategy === "lowest_workload" ? "Choose the available manager with the fewest company profiles. The oldest assignment breaks ties." : "Rotate through available managers, starting with whoever received a lead least recently."}</p></div>
            <div className="space-y-2"><label htmlFor="assignment-workload" className="text-sm font-medium">Count workload and capacity using</label><select id="assignment-workload" value={draft.workload} onChange={event => change({ ...draft, workload: event.target.value as typeof draft.workload })} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="all">All assigned companies</option><option value="open">Open companies only</option></select><p className="text-xs leading-5 text-muted-foreground">Open companies exclude won and lost deals. Capacity limits apply to both distribution rules.</p></div>
          </CardContent>
        </Card>
        <Card className="shadow-none"><CardHeader><CardTitle>Assignment preview</CardTitle><CardDescription>{dirty ? "Based on your unsaved rules and current workload." : "Based on saved rules and current workload."}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="rounded-lg border bg-muted/30 p-4"><p className="text-xs text-muted-foreground">Next eligible manager</p><p className="mt-2 text-base font-semibold">{!draft.enabled ? "Assignment paused" : preview?.name || "No available managers"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{!draft.enabled || !preview ? "New unowned leads will stay in the unassigned queue." : "Previewing does not assign a lead or change the rotation."}</p></div><p className="text-xs text-muted-foreground">Available managers: {available} / {draft.members.length}</p><p className="text-xs text-muted-foreground">Unassigned company profiles: {saved.unassigned}</p><p className="text-xs leading-5 text-muted-foreground">Existing owners and manually created companies keep their ownership. Saving rules does not redistribute the unassigned queue.</p><Button variant="outline" nativeButton={false} render={<Link href="/companies" />}>Open company assignments<ArrowRight className="size-4" /></Button><p className="text-xs leading-5 text-muted-foreground">Administrators can manually assign a company to any active BD Manager, including managers paused for automatic assignment.</p></CardContent></Card>
      </div>
      <Card className="shadow-none"><CardHeader><div className="flex items-center gap-2"><UsersRound className="size-4 text-primary" /><CardTitle>Manager participation & capacity</CardTitle></div><CardDescription>Pause individual managers and limit their workload. Leave capacity blank for unlimited.</CardDescription></CardHeader><CardContent className="space-y-3">
        {draft.members.length ? draft.members.map((member, index) => {
          const count = member[draft.workload === "open" ? "open" : "total"];
          const status = !member.activated ? "Awaiting activation" : !member.enabled ? "Paused" : member.limit !== "" && count >= Number(member.limit) ? "At capacity" : "Available";
          return <div key={member.userId} className="flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"><div className="min-w-36 flex-1"><p className="text-sm font-medium">{member.name}</p><p className="mt-1 text-xs text-muted-foreground">{member.open} open / {member.total} total</p><Badge variant="outline" className="mt-2">{status}</Badge></div><div className="flex flex-wrap items-end gap-5"><div className="space-y-2"><label htmlFor={`capacity-${member.userId}`} className="block text-xs font-medium">Company capacity</label><Input id={`capacity-${member.userId}`} aria-label={`Company capacity for ${member.name}`} className="w-32" type="number" min="1" max="1000000" step="1" placeholder="Unlimited" value={member.limit} onChange={event => change({ ...draft, members: draft.members.map((item, position) => position === index ? { ...item, limit: event.target.value } : item) })} /></div><div className="flex h-10 items-center gap-3"><label htmlFor={`participation-${member.userId}`} className="text-xs">Automatic</label><Switch id={`participation-${member.userId}`} aria-label={`Automatic assignment for ${member.name}`} disabled={!member.activated || pending} checked={member.enabled} onCheckedChange={enabled => change({ ...draft, members: draft.members.map((item, position) => position === index ? { ...item, enabled } : item) })} /></div></div></div>;
        }) : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No BD Managers yet. Add a manager in Team and access to start automatic assignment.</p>}
        <Button variant="ghost" nativeButton={false} render={<Link href="/settings/team" />}>Manage team members<ArrowRight className="size-4" /></Button>
      </CardContent></Card>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-4"><p role="status" aria-live="polite" className="text-xs text-muted-foreground">{pending ? "Saving assignment rules..." : dirty ? "You have unsaved assignment rules." : success ? "Assignment rules saved." : "Changes apply to future assignments after saving."}</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={pending || !dirty} onClick={() => change(draftOf(saved))}>Discard changes</Button><Button type="submit" disabled={pending || !dirty}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}Save assignment rules</Button></div></div>
  </form>;
}
