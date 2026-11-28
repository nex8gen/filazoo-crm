"use client";
import { AgentIcon } from "@/components/agent-icon";
import { AiIcon } from "@/components/ai-icon";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Database, LoaderCircle, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { aiActionAccess, aiDataAccess, aiFeatures, type AiPolicy } from "@/lib/ai-policy";
import type { AiSettingsView } from "@/lib/data/ai-settings";
import { updateAiSettings } from "./ai-settings-actions";
import { useUnsavedSettings } from "./use-unsaved-settings";

const selectClass = "h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44";
function Section({ title, description, icon: Icon, children }: { title: string; description: string; icon: LucideIcon | typeof AiIcon | typeof AgentIcon; children: ReactNode }) {
  return <section className="settings-form-row settings-policy-group"><div className="settings-row-heading"><div className="settings-row-title"><Icon aria-hidden="true" /><h2>{title}</h2></div><p>{description}</p></div><div className="settings-row-content">{children}</div></section>;
}
function ToggleRows({ prefix, entries, values, onChange, disabled = false }: { prefix: string; entries: Record<string, readonly [string, string]>; values: Record<string, boolean>; disabled?: boolean; onChange: (key: string, value: boolean) => void }) {
  return <div className="divide-y">{Object.entries(entries).map(([key, [label, description]]) => <div key={key} className="flex items-center justify-between gap-5 py-4"><div><label htmlFor={`${prefix}-${key}`} className="text-sm font-medium">{label}</label><p id={`${prefix}-${key}-help`} className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div><Switch disabled={disabled} aria-label={label} id={`${prefix}-${key}`} aria-describedby={`${prefix}-${key}-help`} checked={values[key]} onCheckedChange={value => onChange(key, value)} /></div>)}</div>;
}
export function AiSettingsForm({ initial, canManage }: { initial: AiSettingsView; canManage: boolean }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.policy);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const saving = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.policy);
  useUnsavedSettings(canManage && dirty);
  function change(next: AiPolicy) { if (saving.current) return; setDraft(next); setSuccess(false); setError(""); }
  function save() {
    if (!canManage || saving.current || pending || !dirty) return;
    saving.current = true;
    startTransition(async () => {
      setError(""); setSuccess(false);
      try {
        const result = await updateAiSettings({ policy: draft, revision: saved.revision });
        if (result.error) { setError(result.error); return; }
        if (result.saved) { setSaved(result.saved); setDraft(result.saved.policy); setSuccess(true); }
      } catch { setError("Unable to save AI settings. Your changes have not been applied."); }
      finally { saving.current = false; }
    });
  }
  return <form onSubmit={event => { event.preventDefault(); save(); }} className="ai-surface settings-policy-form space-y-5">
    <p className="text-sm text-muted-foreground">Applies to chat, agents, email writing, and background AI. Only administrators can make changes.</p>
    {!canManage ? <p role="status" className="settings-panel px-4 py-3 text-sm text-muted-foreground">You can view the workspace AI policy. Ask an administrator to change it.</p> : null}
    <fieldset disabled={!canManage || pending} className="min-w-0 space-y-5">
      <div className="settings-panel px-5"><ToggleRows disabled={!canManage || pending} prefix="ai-master" entries={{ enabled: ["Enable AI in this workspace", "Turning this off blocks new AI requests and checks access again before pending actions and AI replies run. Save to apply."] }} values={{ enabled: draft.enabled }} onChange={(_, enabled) => change({ ...draft, enabled })} /></div>
      <Section title="AI features" description="Choose where your team can use AI." icon={AgentIcon}><ToggleRows disabled={!canManage || pending} prefix="ai-feature" entries={aiFeatures} values={draft.features} onChange={(key, value) => change({ ...draft, features: { ...draft.features, [key]: value } })} /></Section>
      <Section title="What AI can read" description="Control which CRM records can be included in AI context." icon={Database}><p className="pb-3 text-xs text-muted-foreground">Administrators can access workspace customers. Other members can access only their assigned customers and conversations.</p><details className="settings-help"><summary>How data access works</summary><p>Disabled areas are excluded from record lookups, page context, and chat history sent to AI. Actions need access to every area they use. Text you type or paste can still be sent to AI.</p></details><ToggleRows disabled={!canManage || pending} prefix="ai-data" entries={aiDataAccess} values={draft.data} onChange={(key, value) => change({ ...draft, data: { ...draft.data, [key]: value } })} /></Section>
      <Section title="What AI can do" description="Block actions, require approval, or allow automatic execution." icon={SlidersHorizontal}><details className="settings-help"><summary>How action approval works</summary><p>Require approval overrides the agent’s Auto mode. Allow automatic still respects the agent’s selected mode and existing mandatory reviews. Background AI pauses for human review if a required action needs approval. This policy does not affect template-only email workflows.</p></details><div className="divide-y">{Object.entries(aiActionAccess).map(([key, [label, description]]) => <div key={key} className="settings-policy-action"><div className="min-w-0"><label htmlFor={`ai-action-${key}`} className="text-sm font-medium">{label}</label><p id={`ai-action-${key}-help`} className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div><select id={`ai-action-${key}`} aria-describedby={`ai-action-${key}-help`} className={`${selectClass} shrink-0`} value={draft.actions[key as keyof typeof aiActionAccess]} onChange={event => change({ ...draft, actions: { ...draft.actions, [key]: event.target.value } })}><option value="deny">Blocked</option><option value="ask">Require approval</option><option value="auto">Allow automatic</option></select></div>)}</div></Section>
      <Section title="Writing & business guidance" description="Keep AI answers and emails consistent with your business." icon={AiIcon}><div className="space-y-5 py-5"><div className="settings-fields-grid"><div><label htmlFor="ai-tone" className="mb-2 block text-sm font-medium">Default tone</label><select id="ai-tone" className={selectClass} value={draft.tone} onChange={event => change({ ...draft, tone: event.target.value as AiPolicy["tone"] })}><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="concise">Concise</option></select></div><div><label htmlFor="ai-detail" className="mb-2 block text-sm font-medium">Response detail</label><select id="ai-detail" className={selectClass} value={draft.detail} onChange={event => change({ ...draft, detail: event.target.value as AiPolicy["detail"] })}><option value="brief">Brief</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></div></div>{([
        ["businessContext", "Business context", "Describe your business, customers, and value proposition. Use approved business facts for verified policies and pricing."],
        ["instructions", "General AI instructions", "Explain how AI should help your team, what to prioritize, and when to ask for clarification."],
        ["emailInstructions", "Email writing instructions", "Describe your preferred greeting, structure, closing, and sales approach. Personal email footers still apply."],
      ] as const).map(([key, label, help]) => <div key={key}><label htmlFor={`ai-${key}`} className="block text-sm font-medium">{label}</label><p id={`ai-${key}-help`} className="mt-1 text-xs leading-5 text-muted-foreground">{help}</p><textarea id={`ai-${key}`} aria-describedby={`ai-${key}-help`} maxLength={4000} rows={4} className="mt-3 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value={draft[key]} onChange={event => change({ ...draft, [key]: event.target.value })} placeholder="Write your guidance here." /><p className="text-right text-xs text-muted-foreground">{draft[key].length}/4,000</p></div>)}</div></Section>
    </fieldset>
    <details className="settings-help"><summary>Policy scope</summary><p>Saved connection credentials are excluded from AI context. Team roles, record permissions, and delivery checks still apply. Changes affect future requests; existing chat history and sent messages are kept.</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2"><Link className="font-medium text-ai-foreground underline underline-offset-4" href="/settings/email">Email preferences & footer</Link><Link className="font-medium text-ai-foreground underline underline-offset-4" href="/workflow">Workflow workspace</Link></div></details>
    {error ? <NotificationToast>{error}</NotificationToast> : null}
    {canManage ? <div className="settings-save-bar"><p role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">{success ? <CheckCircle2 aria-hidden="true" className="size-4 text-ai-foreground" /> : null}{pending ? "Saving AI settings…" : dirty ? "Unsaved changes" : success ? "AI settings saved. New requests use this policy." : "Workspace-wide settings"}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" disabled={pending || !Object.values(draft.actions).includes("auto")} onClick={() => change({ ...draft, actions: Object.fromEntries(Object.entries(draft.actions).map(([key, mode]) => [key, mode === "auto" ? "ask" : mode])) as AiPolicy["actions"] })}>Require approval for allowed actions</Button>{dirty ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => change(saved.policy)}>Discard</Button> : null}<Button type="submit" size="sm" disabled={pending || !dirty}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <AgentIcon aria-hidden="true" className="size-4" />}Save AI settings</Button></div></div> : null}
  </form>;
}
