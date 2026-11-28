"use client";

import { useActionState, useEffect, useState } from "react";
import { Building2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotificationToast } from "@/components/ui/notification-toast";
import { weekdayLabels, workspaceLogoMaxBytes, type WorkspaceSettings } from "@/lib/workspace-settings";
import { saveWorkspaceDetails, saveWorkspaceSchedule } from "./actions";

export function WorkspaceDetailsForm({ name, settings, editable }: { name: string; settings: WorkspaceSettings; editable: boolean }) {
  const [state, action, pending] = useActionState(saveWorkspaceDetails, undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [fileError, setFileError] = useState("");
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const logo = removeLogo ? null : preview ?? settings.logoDataUrl;
  return <form action={action} className="space-y-5">
    <fieldset disabled={!editable || pending} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="workspace-logo">Workspace logo</Label>
        <div className="flex flex-wrap items-center gap-4">
          <div className="settings-panel flex size-16 shrink-0 items-center justify-center overflow-hidden">
            {/* Uploaded images are sanitized WebP data URLs, scoped to workspace membership. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logo} alt="Workspace logo" className="size-full object-contain p-1" /> : <Building2 aria-hidden="true" className="size-6 text-muted-foreground" />}
          </div>
          {editable ? <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="workspace-logo" className="cursor-pointer rounded-md border px-3 py-2 hover:bg-muted"><Upload aria-hidden="true" className="size-3.5" />Upload logo</Label>
              {logo ? <Button type="button" variant="ghost" size="sm" onClick={() => { setPreview(null); setRemoveLogo(true); setFileError(""); const input = document.getElementById("workspace-logo") as HTMLInputElement; input.value = ""; }}><X aria-hidden="true" />Remove logo</Button> : null}
            </div>
            <p id="workspace-logo-help" className="text-xs text-muted-foreground">PNG, JPG, or WebP. Maximum 2 MB.</p>
          </div> : null}
        </div>
        <Input id="workspace-logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only focus:not-sr-only" aria-describedby={editable ? "workspace-logo-help" : undefined} onChange={event => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > workspaceLogoMaxBytes || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
            setFileError("Choose a PNG, JPG, or WebP logo smaller than 2 MB."); setPreview(null); setRemoveLogo(false); event.target.value = ""; return;
          }
          setFileError(""); setRemoveLogo(false); setPreview(URL.createObjectURL(file));
        }} />
        <input type="hidden" name="removeLogo" value={String(removeLogo)} />
      </div>
      <div className="space-y-2"><Label htmlFor="workspace-name">Workspace name</Label><Input id="workspace-name" name="name" defaultValue={name} autoComplete="organization" minLength={2} maxLength={80} required /></div>
      <div className="space-y-2"><Label htmlFor="workspace-website">Company website</Label><Input id="workspace-website" name="website" defaultValue={settings.website} autoComplete="url" maxLength={500} /></div>
    </fieldset>
    {fileError ? <p role="alert">{fileError}</p> : null}
    {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
    {state?.success ? <NotificationToast tone="success">{state.success}</NotificationToast> : null}
    {editable ? <Button disabled={pending} type="submit">{pending ? "Saving…" : "Save workspace"}</Button> : <p className="text-xs text-muted-foreground">Ask an administrator to change workspace details.</p>}
  </form>;
}

export function WorkspaceScheduleForm({ settings, editable, timezones }: { settings: WorkspaceSettings; editable: boolean; timezones: string[] }) {
  const [state, action, pending] = useActionState(saveWorkspaceSchedule, undefined);
  return <form action={action} className="space-y-5">
    <fieldset disabled={!editable || pending} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="workspace-timezone">Workspace timezone</Label><select id="workspace-timezone" name="timezone" defaultValue={settings.timezone} className="h-10 w-full rounded-lg border bg-background px-3 text-sm" aria-describedby="workspace-timezone-help">{timezones.map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}</select><p id="workspace-timezone-help" className="text-xs text-muted-foreground">Used for reports and workflow business hours. Daylight saving time adjusts automatically.</p></div>
      <fieldset className="space-y-3"><legend className="mb-2 text-[.8125rem] font-medium">Working days</legend><div className="flex flex-wrap gap-x-5 gap-y-3">{[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day} className="flex cursor-pointer items-center gap-2 text-xs"><input type="checkbox" name="days" value={day} defaultChecked={settings.businessHours.days.includes(day)} className="size-4 accent-primary" />{weekdayLabels[day]}</label>)}</div></fieldset>
      <div className="settings-fields-grid"><div className="space-y-2"><Label htmlFor="workspace-opens">Opening time</Label><Input id="workspace-opens" type="time" name="start" defaultValue={settings.businessHours.start} required /></div><div className="space-y-2"><Label htmlFor="workspace-closes">Closing time</Label><Input id="workspace-closes" type="time" name="end" defaultValue={settings.businessHours.end} required /></div></div>
      <p className="text-xs text-muted-foreground">Applies to workflow messages set to business hours. Other messages keep their own schedule.</p>
    </fieldset>
    {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}
    {state?.success ? <NotificationToast tone="success">{state.success}</NotificationToast> : null}
    {editable ? <Button disabled={pending} type="submit">{pending ? "Saving…" : "Save business hours"}</Button> : null}
  </form>;
}
