"use client";

import { useActionState, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { neteaseServerProfiles, type NeteaseServerProfile } from "@/lib/netease-mail";
import { saveNeteaseConnection } from "./netease-actions";
import type { EmailConnectionScope } from "@/lib/email-connections";

export function NeteaseConnectionForm({ account, scope = "personal" }: { account?: { id: string; email: string; name: string; serverProfile: NeteaseServerProfile; smtpPort: number }; scope?: EmailConnectionScope }) {
  const [state, action, pending] = useActionState(saveNeteaseConnection, undefined);
  const [email, setEmail] = useState(account?.email ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [profile, setProfile] = useState<NeteaseServerProfile>(account?.serverProfile ?? "standard");
  const [smtpPort, setSmtpPort] = useState(String(account?.smtpPort === 465 ? 465 : 994));
  const prefix = `netease-${account?.id ?? "new"}`;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="mailboxId" value={account?.id ?? ""} />
      <input type="hidden" name="mailboxScope" value={scope} />
      <div className="space-y-2"><Label htmlFor={`${prefix}-email`}>Business email address</Label><Input id={`${prefix}-email`} name="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={event => setEmail(event.target.value)} readOnly={Boolean(account)} required disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>Connection name</Label><Input id={`${prefix}-name`} name="displayName" placeholder="Sales Lingxi Mail" value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-password`}>Client authorization password</Label><Input id={`${prefix}-password`} name="clientPassword" type="password" autoComplete="new-password" placeholder={account ? "Leave blank to keep the saved password" : "From your NetEase client settings"} required={!account} maxLength={255} disabled={pending} /><p className="text-xs leading-5 text-muted-foreground">Enable IMAP/SMTP and generate a client authorization password in your NetEase / Lingxi account settings.</p></div>
      <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Mail server settings</summary><div className="mt-4 space-y-4">
        <div className="space-y-2"><Label htmlFor={`${prefix}-profile`}>Server profile</Label><select id={`${prefix}-profile`} name="serverProfile" value={profile} onChange={event => setProfile(event.target.value as NeteaseServerProfile)} disabled={pending} className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">{Object.entries(neteaseServerProfiles).map(([key, server]) => <option key={key} value={key}>{server.label}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor={`${prefix}-port`}>SMTP port (SSL/TLS)</Label><select id={`${prefix}-port`} name="smtpPort" value={smtpPort} onChange={event => setSmtpPort(event.target.value)} disabled={pending} className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="994">994</option><option value="465">465</option></select></div>
        <p className="break-all text-xs leading-6 text-muted-foreground">SMTP: {neteaseServerProfiles[profile].smtpHost}:{smtpPort}<br />IMAP: {neteaseServerProfiles[profile].imapHost}:993</p><p className="text-xs text-muted-foreground">Use the server profile and port shown in your NetEase client settings. Both connections use SSL/TLS.</p>
      </div></details>
      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-primary">{state.success}</p> : null}
      <Button type="submit" disabled={pending}><Mail />{pending ? "Checking connection..." : account ? "Test and save connection" : "Connect Lingxi Mail"}</Button>
      <p className="text-xs leading-5 text-muted-foreground">Sending and receiving authentication are checked before saving. Your existing default sending account is kept.</p>
    </form>
  );
}
