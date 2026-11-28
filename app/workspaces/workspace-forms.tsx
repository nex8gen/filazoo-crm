"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useActionState } from "react";
import { Building2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspace, renameWorkspace, switchWorkspace } from "./actions";
import { AuthField, authButtonClass } from "@/components/auth-fields";

export function WorkspaceNameForm({ name = "", editing = false }: { name?: string; editing?: boolean }) {
  const [state, action, pending] = useActionState(editing ? renameWorkspace : createWorkspace, undefined);
  return <form action={action} className="space-y-4">{editing ? <div className="space-y-2"><Label htmlFor="workspace-name">Workspace name</Label><Input id="workspace-name" name="name" defaultValue={name} autoComplete="organization" placeholder="Your company" minLength={2} maxLength={80} required /></div> : <AuthField label="Workspace name" id="workspace-name" name="name" defaultValue={name} autoComplete="organization" placeholder="e.g. Acme Studio" minLength={2} maxLength={80} required />}
    {state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}{state?.success ? <NotificationToast tone="success">{state.success}</NotificationToast> : null}
    {editing ? <Button disabled={pending} type="submit">{pending ? "Saving…" : "Save workspace"}<ArrowRight /></Button> : <button disabled={pending} type="submit" className={authButtonClass}>{pending ? "Creating workspace…" : "Create workspace"}<ArrowRight className="size-4" /></button>}</form>;
}

export function OpenWorkspaceForm({ id, name, role, active, logoDataUrl }: { id: string; name: string; role: string; active: boolean; logoDataUrl?: string | null }) {
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof switchWorkspace>>, data: FormData) => {
    const result = await switchWorkspace(previous, data);
    // A document navigation clears Router Cache, retained tabs, and account-specific client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Workspace changes require clearing retained client state.
    if (result?.success) window.location.assign("/");
    return result;
  }, undefined);
  return <form action={action}><input type="hidden" name="workspaceId" value={id} /><Button type="submit" variant="outline" disabled={pending} className="h-auto w-full justify-between gap-4 p-4 text-left"><span className="flex min-w-0 items-center gap-3"><WorkspaceLogo dataUrl={logoDataUrl} /><span className="min-w-0"><span className="block truncate font-medium">{name}</span><span className="block text-xs capitalize text-muted-foreground">{role === "bd_manager" ? "BD Sales Manager" : role}{active ? " · Current workspace" : ""}</span></span></span><ArrowRight className="size-4" /></Button>{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}</form>;
}

function WorkspaceLogo({ dataUrl }: { dataUrl?: string | null }) {
  // Workspace logos are sanitized WebP images, read only after membership checks.
  // eslint-disable-next-line @next/next/no-img-element
  return dataUrl ? <img src={dataUrl} alt="" className="size-9 shrink-0 rounded-lg border object-contain p-1" /> : <Building2 aria-hidden="true" className="size-5 shrink-0 text-primary" />;
}
