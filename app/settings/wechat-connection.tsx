"use client";

import { useActionState } from "react";
import { connectWechat } from "@/app/auth/wechat/link-actions";
import { Button } from "@/components/ui/button";

export function WechatConnection({ enabled, connected }: { enabled: boolean; connected: boolean }) {
  const [state, action, pending] = useActionState(connectWechat, undefined);
  return <div className="space-y-3">
    <p className="text-sm font-medium">WeChat sign-in</p>
    <p className="text-xs text-muted-foreground">{connected ? "WeChat is connected to this account." : "Connect WeChat to sign in to your existing account without creating a second account."}</p>
    {!connected ? <form action={action} aria-busy={pending}><Button variant="outline" size="sm" disabled={!enabled || pending}>{pending ? "Connecting…" : "Connect WeChat"}</Button></form> : null}
    {!enabled && !connected ? <p className="text-xs text-muted-foreground">WeChat sign-in is awaiting activation.</p> : null}
    {state?.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
  </div>;
}
