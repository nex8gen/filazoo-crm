"use client";

import { useState, useTransition } from "react";
import { Laptop, Smartphone, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { NotificationToast } from "@/components/ui/notification-toast";
import { describeDevice, formatSecurityDate, type DeviceSession } from "@/lib/account-security";
import { loadDeviceSessions, revokeDeviceSessions } from "./security-actions";

type Selection = { scope: "one"; id: string } | { scope: "others" | "all" };
export function DeviceSessions({ initialSessions, initialError }: { initialSessions: DeviceSession[]; initialError?: string }) {
  const [sessions, setSessions] = useState(initialSessions);
  const [error, setError] = useState(initialError ?? "");
  const [success, setSuccess] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const result = await loadDeviceSessions();
    if (result.error) setError(result.error);
    else if (result.sessions) { setSessions(result.sessions); setError(""); }
  }
  function revoke() {
    if (!selection) return;
    setError(""); setSuccess("");
    startTransition(async () => {
      try {
        const result = await revokeDeviceSessions(selection);
        if (result.error) setError(result.error);
        else if (result.signedOut) { window.location.assign(new URL("/login?message=You%20have%20been%20signed%20out.", window.location.origin).href); return; }
        else { setSuccess(result.success ?? "Sessions ended."); await refresh(); }
      } catch { setError("Unable to end sessions. Please try again."); }
      finally { setSelection(null); }
    });
  }
  const date = formatSecurityDate;
  return <Card><CardHeader className="flex flex-wrap items-start justify-between gap-4 sm:flex-row"><div className="space-y-2"><CardTitle>Manage sessions</CardTitle><CardDescription>Review browsers and devices signed in to your account.</CardDescription></div><Button variant="outline" disabled={pending || !sessions.length} onClick={() => setSelection({ scope: "all" })}>End all sessions</Button></CardHeader><CardContent className="space-y-4" aria-busy={pending}>
    <div className="overflow-x-auto"><table className="w-full min-w-[32rem] text-left text-sm"><thead><tr className="border-b text-xs font-normal text-muted-foreground"><th scope="col" className="pb-3 font-normal">Device</th><th scope="col" className="pb-3 font-normal">Last login</th><th scope="col" className="pb-3 font-normal">Status</th><th scope="col" className="pb-3 text-right font-normal"><span className="sr-only">Actions</span></th></tr></thead><tbody>{sessions.map(session => {
      const device = describeDevice(session.user_agent); const Icon = device.kind === "mobile" ? Smartphone : Laptop;
      return <tr key={session.id} className="border-b last:border-0"><td className="py-4 pr-4"><div className="flex items-center gap-3"><Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><div><p>{device.name}</p><p className="mt-1 text-xs text-muted-foreground">{session.ip ? `IP: ${session.ip}` : "Network address unavailable"}</p></div></div></td><td className="py-4 pr-4"><time dateTime={session.created_at}>{date(session.created_at)}</time><p className="mt-1 text-xs text-muted-foreground">Active {date(session.last_active_at)}</p></td><td className="py-4 pr-4"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs ${session.current ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{session.current ? <ShieldCheck aria-hidden="true" className="size-3.5" /> : null}{session.current ? "This device" : "Signed in"}</span></td><td className="py-4 text-right"><Button size="sm" variant="ghost" disabled={pending} onClick={() => setSelection({ scope: "one", id: session.id })}>Sign out</Button></td></tr>;
    })}</tbody></table></div>
    {!sessions.length && !error ? <p className="py-4 text-sm text-muted-foreground">No active sessions found. Refresh to check again.</p> : null}
    {error ? <NotificationToast>{error}</NotificationToast> : null}{success ? <p role="status" className="text-sm text-primary">{success}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="max-w-lg text-xs leading-5 text-muted-foreground">Times shown in UTC. Ending a session blocks its next CRM request. Device details come from the browser and may be approximate.</p><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { try { await refresh(); } catch { setError("Unable to refresh devices. Please try again."); } })}><RefreshCw aria-hidden="true" className="size-3.5" />Refresh</Button><Button size="sm" variant="outline" disabled={pending || !sessions.some(s => !s.current)} onClick={() => setSelection({ scope: "others" })}>Sign out other devices</Button></div></div>
    <Dialog open={selection !== null} onOpenChange={open => { if (!open && !pending) setSelection(null); }}><DialogContent showCloseButton={!pending}><DialogHeader><DialogTitle>{selection?.scope === "all" ? "End all sessions?" : selection?.scope === "others" ? "Sign out other devices?" : "Sign out this device?"}</DialogTitle><DialogDescription>{selection?.scope === "all" ? "You will be signed out here and on every other device. Sign in again to continue." : selection?.scope === "others" ? "All other browsers and devices will lose access to your account. This device stays signed in." : "This session will lose access to your account. If it is your current device, you will return to sign-in."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setSelection(null)}>Cancel</Button><Button disabled={pending} onClick={revoke}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}End session{selection?.scope !== "one" ? "s" : ""}</Button></DialogFooter></DialogContent></Dialog>
  </CardContent></Card>;
}
