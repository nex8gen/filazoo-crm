"use client";

import { useState, useTransition } from "react";
import { Laptop, Smartphone, LoaderCircle, RefreshCw, ChevronDown, Info, LogOut, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecuritySetting } from "./security-setting";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  const [inspecting, setInspecting] = useState<DeviceSession | null>(null);
  const [showAll, setShowAll] = useState(false);
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
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
  const visible = showAll ? ordered : ordered.slice(0, 3);
  return <SecuritySetting title="Active sessions" status={error ? undefined : <span className="security-count" aria-label="Active session count">{sessions.length}</span>} actions={<>
    <Button size="icon-sm" variant="ghost" aria-label="Refresh devices" title="Refresh devices" disabled={pending} onClick={() => startTransition(async () => { try { await refresh(); } catch { setError("Unable to refresh devices. Please try again."); } })}><RefreshCw aria-hidden="true" className={pending ? "size-4 animate-spin" : "size-4"} /></Button>
    <DropdownMenu><DropdownMenuTrigger disabled={pending || !sessions.length} render={<Button size="sm" variant="outline" />}>Sign out devices<ChevronDown aria-hidden="true" className="size-3.5" /></DropdownMenuTrigger><DropdownMenuContent align="end">
      <DropdownMenuItem disabled={!sessions.some(s => !s.current)} onClick={() => setSelection({ scope: "others" })}><LogOut aria-hidden="true" />Sign out other devices</DropdownMenuItem>
      <DropdownMenuItem variant="destructive" onClick={() => setSelection({ scope: "all" })}><LogOut aria-hidden="true" />End all sessions</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
  </>}>
    <ul className="security-items" aria-label="Signed-in devices" aria-busy={pending}>{visible.map(session => {
      const device = describeDevice(session.user_agent); const Icon = device.kind === "mobile" ? Smartphone : Laptop;
      return <li key={session.id} className="security-item">
        <div className="security-item-identity"><Icon aria-hidden="true" className="security-item-icon" /><div className="security-item-text"><div className="security-item-title"><p id={`device-${session.id}`} className="security-item-name">{device.name}</p>{session.current ? <span className="security-status" data-enabled="true">This device</span> : null}</div><p className="security-item-meta"><span>Last active</span> <time dateTime={session.last_active_at}>{date(session.last_active_at)}</time></p></div></div>
        <DropdownMenu><DropdownMenuTrigger disabled={pending} render={<Button variant="ghost" size="icon-sm" aria-label="Device actions" aria-describedby={`device-${session.id}`} />}><MoreHorizontal aria-hidden="true" /></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setInspecting(session)}><Info aria-hidden="true" />Device details</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setSelection({ scope: "one", id: session.id })}><LogOut aria-hidden="true" />Sign out</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>
      </li>;
    })}</ul>
    {sessions.length > 3 ? <Button size="sm" variant="ghost" className="security-show-all" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer devices" : "Show all devices"}<span className="security-count">{sessions.length}</span></Button> : null}
    {!sessions.length && !error ? <p className="security-empty">No active sessions found. Refresh to check again.</p> : null}
    {error ? <NotificationToast>{error}</NotificationToast> : null}{success ? <p role="status" className="text-sm text-primary">{success}</p> : null}
    <Dialog open={inspecting !== null} onOpenChange={open => { if (!open) setInspecting(null); }}><DialogContent className="settings-field-dialog"><DialogHeader><DialogTitle>Device details</DialogTitle><DialogDescription>{inspecting ? describeDevice(inspecting.user_agent).name : ""}</DialogDescription></DialogHeader>{inspecting ? <dl className="security-device-details"><div><dt>Last login</dt><dd>{date(inspecting.created_at)}</dd></div><div><dt>Last active</dt><dd>{date(inspecting.last_active_at)}</dd></div><div><dt>IP address</dt><dd>{inspecting.ip || "Network address unavailable"}</dd></div><div><dt>Status</dt><dd>{inspecting.current ? "This device" : "Signed in"}</dd></div></dl> : null}<p className="text-xs text-muted-foreground">Times shown in UTC.</p><DialogFooter><Button variant="outline" onClick={() => setInspecting(null)}>Close</Button><Button variant="destructive" disabled={pending} onClick={() => { if (inspecting) { setSelection({ scope: "one", id: inspecting.id }); setInspecting(null); } }}>Sign out</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={selection !== null} onOpenChange={open => { if (!open && !pending) setSelection(null); }}><DialogContent showCloseButton={!pending} className="settings-field-dialog"><DialogHeader><DialogTitle>{selection?.scope === "all" ? "End all sessions?" : selection?.scope === "others" ? "Sign out other devices?" : "Sign out this device?"}</DialogTitle><DialogDescription>{selection?.scope === "all" ? "You will be signed out here and on every other device. Sign in again to continue." : selection?.scope === "others" ? "All other browsers and devices will lose access to your account. This device stays signed in." : "This session will lose access to your account. If it is your current device, you will return to sign-in."}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setSelection(null)}>Cancel</Button><Button disabled={pending} onClick={revoke}>{pending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}End session{selection?.scope !== "one" ? "s" : ""}</Button></DialogFooter></DialogContent></Dialog>
  </SecuritySetting>;
}
