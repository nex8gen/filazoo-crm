"use client";

import { useState, useTransition } from "react";
import { KeyRound, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatSecurityDate, securityError } from "@/lib/account-security";
import { passkeyBrowserError } from "@/lib/passkey-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecuritySetting } from "./security-setting";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  return <SecuritySetting title="Passkeys" actions={enabled ? <Button size="sm" variant="outline" disabled={pending || Boolean(initialError)} onClick={add}>{pending && !editing && !removing ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <Plus aria-hidden="true" className="size-3.5" />}Add passkey</Button> : null}>
    {passkeys.length ? <ul className="security-items">{passkeys.map(passkey => <li key={passkey.id} className="security-item">
      <div className="security-item-identity"><KeyRound aria-hidden="true" className="security-item-icon" /><div className="security-item-text"><p id={`passkey-${passkey.id}`} className="security-item-name">{passkey.friendly_name || "Passkey"}</p><p className="security-item-meta">{passkey.last_used_at ? <><span>Last used</span> <time dateTime={passkey.last_used_at}>{formatSecurityDate(passkey.last_used_at)}</time></> : <span>Not used yet</span>}</p></div></div>
      <DropdownMenu><DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" aria-label="Passkey actions" aria-describedby={`passkey-${passkey.id}`} />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => { setError(""); setName(passkey.friendly_name || ""); setEditing(passkey); }}><Pencil aria-hidden="true" />Rename</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => { setError(""); setRemoving(passkey); }}><Trash2 aria-hidden="true" />Remove</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
    </li>)}</ul> : enabled && !error ? <p className="security-empty">No passkeys added.</p> : null}
    {!enabled ? <p className="security-empty">Passkeys are not enabled for this service yet.</p> : null}
    {error && !editing && !removing ? <NotificationToast>{error}</NotificationToast> : null}{success ? <p role="status" className="text-sm text-primary">{success}</p> : null}
    <Dialog open={Boolean(editing || removing)} onOpenChange={open => { if (!open && !pending) { setEditing(null); setRemoving(null); setError(""); } }}><DialogContent showCloseButton={!pending} className="settings-field-dialog"><DialogHeader><DialogTitle>{editing ? "Rename passkey" : "Remove passkey?"}</DialogTitle><DialogDescription>{editing ? "Choose a name to help you recognize this passkey." : "This passkey will no longer sign in to your account. You can still use your password or another passkey."}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); run(async () => {
      const client = createClient();
      const result = editing ? await client.auth.passkey.update({ passkeyId: editing.id, friendlyName: name.trim() }) : await client.auth.passkey.delete({ passkeyId: removing!.id });
      if (result.error) throw result.error;
      await reload(); setEditing(null); setRemoving(null); setSuccess(editing ? "Passkey renamed." : "Passkey removed.");
    }); }}>{editing ? <div className="space-y-2"><Label htmlFor="passkey-name">Passkey name</Label><Input id="passkey-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required disabled={pending} autoFocus /></div> : null}{error ? <NotificationToast>{error}</NotificationToast> : null}<DialogFooter><Button variant="outline" type="button" disabled={pending} onClick={() => { setEditing(null); setRemoving(null); setError(""); }}>Cancel</Button><Button type="submit" disabled={pending || Boolean(editing && !name.trim())}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}{editing ? "Save name" : "Remove passkey"}</Button></DialogFooter></form></DialogContent></Dialog>
  </SecuritySetting>;
}
