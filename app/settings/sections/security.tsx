import Link from "next/link";
import { KeyRound } from "lucide-react";
import { getAuthProviders } from "@/lib/auth-providers";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionSettings } from "../preferences-form";
import { AlipayConnection } from "../alipay-connection";

export async function SecuritySection() {
  const [providers, { data: { user } }] = await Promise.all([getAuthProviders(), (await createClient()).auth.getUser()]);
  const alipayEnabled = providers.includes("alipay");
  const alipayConnected = Boolean(user?.identities?.some(identity => identity.provider === "custom:alipay"));
  return <div className="settings-content settings-section-enter space-y-5">
    <Card><CardHeader><CardTitle>Password</CardTitle><CardDescription>Use a strong, unique password for your account.</CardDescription></CardHeader><CardContent className="space-y-4"><Button variant="outline" nativeButton={false} render={<Link href="/update-password" />}><KeyRound aria-hidden="true" />Change password</Button><p className="text-xs text-muted-foreground">You will need to sign in again after changing your password.</p></CardContent></Card>
    {alipayEnabled || alipayConnected ? <Card><CardHeader><CardTitle>Sign-in options</CardTitle></CardHeader><CardContent><AlipayConnection enabled={alipayEnabled} connected={alipayConnected} /></CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Other sessions</CardTitle><CardDescription>Sign out on other browsers and devices.</CardDescription></CardHeader><CardContent><SessionSettings /></CardContent></Card>
  </div>;
}
