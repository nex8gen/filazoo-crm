import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import type { WorkspaceViewer } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionSettings } from "../preferences-form";

export function SecuritySection({ viewer }: { viewer: WorkspaceViewer }) {
  return <div className="settings-content settings-section-enter space-y-4">
    <Card className="mb-4 max-w-2xl shadow-none"><CardHeader><CardTitle>Other devices</CardTitle><CardDescription>End your other signed-in sessions.</CardDescription></CardHeader><CardContent><SessionSettings /></CardContent></Card>
    <Card className="max-w-2xl shadow-none"><CardHeader><div className="mb-2 grid size-9 place-items-center rounded-lg border bg-muted"><ShieldCheck className="size-4 text-muted-foreground" /></div><CardTitle className="text-sm">Password and sessions</CardTitle><CardDescription className="text-xs">Use a unique password and rotate temporary credentials immediately.</CardDescription></CardHeader><CardContent className="flex flex-col items-start gap-4"><div><p className="text-xs text-muted-foreground">Workspace role</p><Badge variant="outline" className="mt-1 capitalize">{viewer.role}</Badge></div><Button nativeButton={false} render={<Link href="/update-password" />}><KeyRound />Change password</Button><p className="text-xs text-muted-foreground">Changing your password signs out the current session. Supabase refreshes active sessions using secure cookies.</p></CardContent></Card>
  </div>;
}
