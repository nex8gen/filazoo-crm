"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ShieldCheck, LoaderCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { securityError } from "@/lib/account-security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NotificationToast } from "@/components/ui/notification-toast";

type Factor = { id: string; friendly_name?: string; created_at: string };
type Setup = { id: string; secret: string; uri: string };
export function TwoStepVerification({ factors: initialFactors, initialError }: { factors: Factor[]; initialError?: string }) {
  const router = useRouter();
  const [factors, setFactors] = useState(initialFactors);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [removing, setRemoving] = useState<Factor | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [success, setSuccess] = useState("");
  const [pending, startTransition] = useTransition();
  const active = setup || removing;

  function run(operation: () => Promise<void>) {
    setError(""); setSuccess("");
    startTransition(async () => { try { await operation(); } catch (error) { setError(securityError(error, "Unable to update two-step verification. Please try again.")); } });
  }
  function enroll() { run(async () => {
    const client = createClient();
    const { data: listed, error: listError } = await client.auth.mfa.listFactors();
    if (listError) throw listError;
    // Remove abandoned setup attempts without touching any verified factor.
    for (const factor of listed.all.filter(f => f.factor_type === "totp" && f.status === "unverified")) {
      const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw error;
    }
    let index = 1;
    while (listed.all.some(factor => factor.friendly_name === `Authenticator ${index}`)) index++;
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", issuer: "Filazoo", friendlyName: `Authenticator ${index}` });
    if (error) throw error;
    setCode(""); setSetup({ id: data.id, secret: data.totp.secret, uri: data.totp.uri });
  }); }
  function close() { run(async () => {
    if (setup) { const { error } = await createClient().auth.mfa.unenroll({ factorId: setup.id }); if (error) throw error; }
    setSetup(null); setRemoving(null); setCode("");
  }); }
  function verify() { if (!active || !/^\d{6}$/.test(code)) return; run(async () => {
    const client = createClient();
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: active.id, code });
    if (error) throw error;
    if (removing) {
      const { error: removeError } = await client.auth.mfa.unenroll({ factorId: removing.id });
      if (removeError) throw removeError;
      setFactors(previous => previous.filter(f => f.id !== removing.id));
      // Unenrollment changes AAL; refresh the cookies before the server renders.
      const { error: refreshError } = await client.auth.refreshSession();
      if (refreshError) throw refreshError;
      setSuccess("Authenticator removed.");
    } else {
      const { data, error: listError } = await client.auth.mfa.listFactors();
      if (listError) throw listError;
      setFactors(data.totp); setSuccess("Two-step verification is enabled. You will need an authenticator code when signing in.");
    }
    setSetup(null); setRemoving(null); setCode(""); router.refresh();
  }); }
  return <Card><CardHeader><div className="flex items-center justify-between gap-4"><CardTitle>Two-step verification</CardTitle><span className={`rounded-full px-2.5 py-1 text-xs ${factors.length ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{factors.length ? "Enabled" : "Not enabled"}</span></div><CardDescription>Add an authenticator code as an extra step when you sign in.</CardDescription></CardHeader><CardContent className="space-y-4">
    <p className="text-xs leading-5 text-muted-foreground">Use an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password. Add a second authenticator as a backup before replacing your phone.</p>
    {factors.map(factor => <div key={factor.id} className="flex items-center justify-between gap-4 rounded-lg border p-3"><div className="flex items-center gap-3"><ShieldCheck aria-hidden="true" className="size-5 text-primary" /><span className="text-sm">{factor.friendly_name || "Authenticator app"}</span></div><Button variant="ghost" size="sm" disabled={pending} onClick={() => { setError(""); setCode(""); setRemoving(factor); }}>Remove</Button></div>)}
    <Button variant="outline" disabled={pending || Boolean(initialError)} onClick={enroll}>{pending && !active ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-4" />}{factors.length ? "Add backup authenticator" : "Set up authenticator"}</Button>
    {error && !active ? <NotificationToast>{error}</NotificationToast> : null}{success ? <p role="status" className="text-sm text-primary">{success}</p> : null}
    <Dialog open={Boolean(active)} onOpenChange={open => { if (!open && !pending) close(); }}><DialogContent showCloseButton={!pending} className="sm:max-w-md"><DialogHeader><DialogTitle>{setup ? "Set up two-step verification" : "Remove authenticator?"}</DialogTitle><DialogDescription>{setup ? "Scan this QR code with your authenticator app, then enter its six-digit code to finish." : "Enter a fresh code from this authenticator to confirm removal. Removing your last authenticator turns off two-step verification."}</DialogDescription></DialogHeader>
      {setup ? <><div className="mx-auto rounded-lg border bg-white p-4"><QRCodeSVG value={setup.uri} size={176} title="Authenticator setup QR code" /></div><details className="rounded-lg border p-3 text-xs"><summary className="cursor-pointer font-medium">Can’t scan the QR code?</summary><p className="mt-2 text-muted-foreground">Enter this setup key manually in your authenticator app.</p><code className="mt-2 block break-all select-all">{setup.secret}</code></details></> : null}
      <form onSubmit={event => { event.preventDefault(); verify(); }} className="space-y-4"><div className="space-y-2"><Label htmlFor="authenticator-code">Authenticator code</Label><Input id="authenticator-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} autoFocus required disabled={pending} placeholder="000000" /></div>{error ? <NotificationToast>{error}</NotificationToast> : null}<DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={close}>Cancel</Button><Button type="submit" disabled={pending || code.length !== 6}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}{setup ? "Verify and enable" : "Remove authenticator"}</Button></DialogFooter></form>
    </DialogContent></Dialog>
  </CardContent></Card>;
}
