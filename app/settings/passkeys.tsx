"use client";

import { useState, useTransition } from "react";
import { Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatSecurityDate, securityError } from "@/lib/account-security";
import { passkeyBrowserError } from "@/lib/passkey-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { NotificationToast } from "@/components/ui/notification-toast";

type Passkey = { id: string; friendly_name?: string; created_at: string; last_used_at?: string };
export function Passkeys({ initialPasskeys, enabled, initialError }: { initialPasskeys: Passkey[]; enabled: boolean; initialError?: string }) {
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [editing, setEditing] = useState<Passkey | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(initialError ?? "");
  const [success, setSuccess] = useState("");
  function run(operation: () => Promise<void>) { setError(""); setSuccess(""); startTransition(async () => { try { await operation(); } catch (error) { setError(securityError(error, "Unable to update passkeys. Please try again.")); } }); }
  async function reload() { const { data, error } = await createClient().auth.passkey.list(); if (error) throw error; setPasskeys(data ?? []); }
  function add() { run(async () => {
    const unsupported = passkeyBrowserError({ origin: window.location.origin, secure: window.isSecureContext, supported: Boolean(window.PublicKeyCredential) });
    if (unsupported) { setError(unsupported); return; }
    const { error } = await createClient().auth.registerPasskey();
    if (error) throw error;
    await reload(); setSuccess("Passkey added. You can now use it to sign in.");
  }); }
  return <Card><CardHeader><CardTitle>Passkeys</CardTitle><CardDescription>Sign in with your fingerprint, face, device PIN, or security key.</CardDescription></CardHeader><CardContent className="space-y-4">
    <p className="text-xs leading-5 text-muted-foreground">Passkeys are saved in your device or password manager. Your biometric data stays on your device. Two-step verification still applies when enabled. Times shown in UTC.</p>
    {passkeys.map(passkey => <div key={passkey.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="flex min-w-0 items-center gap-3"><KeyRound aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="break-words text-sm">{passkey.friendly_name || "Passkey"}</p><p className="mt-1 text-xs text-muted-foreground">Added {formatSecurityDate(passkey.created_at)}{passkey.last_used_at ? ` · Last used ${formatSecurityDate(passkey.last_used_at)}` : " · Not used yet"}</p></div></div><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => { setError(""); setName(passkey.friendly_name || ""); setEditing(passkey); }}>Rename</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => { setError(""); setRemoving(passkey); }}>Remove</Button></div></div>)}
    {enabled ? <Button variant="outline" disabled={pending} onClick={add}>{pending && !editing && !removing ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Fingerprint aria-hidden="true" className="size-4" />}Add passkey</Button> : <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">Passkeys are not enabled for this service yet.</p>}
    {error && !editing && !removing ? <NotificationToast>{error}</NotificationToast> : null}{success ? <p role="status" className="text-sm text-primary">{success}</p> : null}
    <Dialog open={Boolean(editing || removing)} onOpenChange={open => { if (!open && !pending) { setEditing(null); setRemoving(null); setError(""); } }}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>{editing ? "Rename passkey" : "Remove passkey?"}</DialogTitle><DialogDescription>{editing ? "Choose a name to help you recognize this passkey." : "This passkey will no longer sign in to your account. You can still use your password or another passkey."}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => {
      const client = createClient();
      const result = editing ? await client.auth.passkey.update({ passkeyId: editing.id, friendlyName: name.trim() }) : await client.auth.passkey.delete({ passkeyId: removing!.id });
      if (result.error) throw result.error;
      await reload(); setEditing(null); setRemoving(null); setSuccess(editing ? "Passkey renamed." : "Passkey removed.");
    }); }}>{editing ? <div className="space-y-2"><Label htmlFor="passkey-name">Passkey name</Label><Input id="passkey-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required disabled={pending} autoFocus /></div> : null}{error ? <NotificationToast>{error}</NotificationToast> : null}<DialogFooter><Button variant="outline" type="button" disabled={pending} onClick={() => { setEditing(null); setRemoving(null); setError(""); }}>Cancel</Button><Button type="submit" disabled={pending || Boolean(editing && !name.trim())}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}{editing ? "Save name" : "Remove passkey"}</Button></DialogFooter></form></DialogContent></Dialog>
  </CardContent></Card>;
}
