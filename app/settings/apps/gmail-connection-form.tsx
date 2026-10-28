"use client";

import { useActionState, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGmailConnection } from "./gmail-actions";
import type { EmailConnectionScope } from "@/lib/email-connections";

export function GmailConnectionForm({ account, scope = "personal" }: { account?: { id: string; email: string; name: string }; scope?: EmailConnectionScope }) {
  const [state, action, pending] = useActionState(saveGmailConnection, undefined);
  const [email, setEmail] = useState(account?.email ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const prefix = `gmail-${account?.id ?? "new"}`;
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="mailboxId" value={account?.id ?? ""} />
      <input type="hidden" name="mailboxScope" value={scope} />
      <div className="space-y-2"><Label htmlFor={`${prefix}-email`}>Gmail address</Label><Input id={`${prefix}-email`} name="email" type="email" autoComplete="email" placeholder="you@gmail.com" value={email} onChange={event => setEmail(event.target.value)} readOnly={Boolean(account)} required disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-name`}>Connection name</Label><Input id={`${prefix}-name`} name="displayName" placeholder="Sales Gmail" value={name} onChange={event => setName(event.target.value)} maxLength={80} disabled={pending} /></div>
      <div className="space-y-2"><Label htmlFor={`${prefix}-password`}>Google app password</Label><Input id={`${prefix}-password`} name="appPassword" type="password" autoComplete="new-password" placeholder={account ? "Leave blank to keep the saved app password" : "Your 16-character app password"} required={!account} disabled={pending} /><p className="text-xs leading-5 text-muted-foreground">Use an app password from your Google account. A Google Workspace administrator may need to enable this option.</p></div>
      {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      {state?.success ? <p role="status" className="text-sm text-primary">{state.success}</p> : null}
      <Button type="submit" disabled={pending}><Mail />{pending ? "Checking connection..." : account ? "Test and save connection" : "Connect Gmail"}</Button>
      <p className="text-xs leading-5 text-muted-foreground">Sending and receiving are checked before saving. Your existing default sending account is kept.</p>
    </form>
  );
}
