import Link from "next/link";
import { KeyRound } from "lucide-react";
import { getAuthProviders, getPasskeysEnabled } from "@/lib/auth-providers";
import { createClient } from "@/lib/supabase/server";
import { readDeviceSessions } from "@/lib/account-security-server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlipayConnection } from "../alipay-connection";
import { DeviceSessions } from "../device-sessions";
import { TwoStepVerification } from "../two-step-verification";
import { Passkeys } from "../passkeys";

export async function SecuritySection() {
  const client = await createClient();
  const [providers, passkeysEnabled, { data: { user } }, factors, sessions] = await Promise.all([
    getAuthProviders(), getPasskeysEnabled(), client.auth.getUser(), client.auth.mfa.listFactors(),
    readDeviceSessions().then(data => ({ data, error: "" })).catch(() => ({ data: [], error: "Unable to load your devices. Refresh to try again." })),
  ]);
  const passkeys = passkeysEnabled ? await client.auth.passkey.list() : null;
  const alipayEnabled = providers.includes("alipay");
  const alipayConnected = Boolean(user?.identities?.some(identity => identity.provider === "custom:alipay"));
  return <div className="settings-content settings-section-enter space-y-5">
    <Card><CardHeader><CardTitle>Password</CardTitle><CardDescription>Use a strong, unique password for your account.</CardDescription></CardHeader><CardContent className="space-y-4"><Button variant="outline" nativeButton={false} render={<Link href="/update-password" />}><KeyRound aria-hidden="true" />Change password</Button><p className="text-xs text-muted-foreground">You will need to sign in again after changing your password.</p></CardContent></Card>
    <TwoStepVerification factors={factors.data?.totp ?? []} initialError={factors.error ? "Unable to load two-step verification. Refresh to try again." : undefined} />
    <Passkeys initialPasskeys={passkeys?.data ?? []} enabled={passkeysEnabled} initialError={passkeys?.error ? "Unable to load passkeys. Refresh to try again." : undefined} />
    {alipayEnabled || alipayConnected ? <Card><CardHeader><CardTitle>Sign-in options</CardTitle></CardHeader><CardContent><AlipayConnection enabled={alipayEnabled} connected={alipayConnected} /></CardContent></Card> : null}
    <DeviceSessions initialSessions={sessions.data} initialError={sessions.error} />
  </div>;
}
