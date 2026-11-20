"use client";

import { useActionState } from "react";
import { connectAlipay } from "@/app/auth/alipay/link-actions";
import { Button } from "@/components/ui/button";

export function AlipayConnection({ enabled, connected }: { enabled: boolean; connected: boolean }) {
  const [state, action, pending] = useActionState(connectAlipay, undefined);
  return <div className="space-y-3"><p className="text-sm font-medium">Alipay sign-in</p><p className="text-xs text-muted-foreground">{connected ? "Alipay is connected to this account." : "Connect Alipay here to sign in to your existing account without creating a second account."}</p>{!connected && <form action={action}><Button variant="outline" size="sm" disabled={!enabled || pending}>{pending ? "Connecting…" : "Connect Alipay"}</Button></form>}{!enabled && !connected && <p className="text-xs text-muted-foreground">Alipay sign-in is awaiting activation.</p>}{state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}</div>;
}
