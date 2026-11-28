import Link from "next/link";
import { getAuthProviders, getPasskeysEnabled } from "@/lib/auth-providers";
import { createClient } from "@/lib/supabase/server";
import { readDeviceSessions } from "@/lib/account-security-server";
import { Button } from "@/components/ui/button";
import { SecuritySetting } from "../security-setting";
import { AlipayConnection } from "../alipay-connection";
import { WechatConnection } from "../wechat-connection";
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
  const wechatEnabled = providers.includes("wechat");
  const wechatConnected = Boolean(user?.identities?.some(identity => identity.provider === "custom:wechat"));
  return <div className="settings-content settings-section-enter settings-security">
    <SecuritySetting title="Password" actions={<Button size="sm" variant="outline" nativeButton={false} render={<Link href="/update-password" />}>Change password</Button>} />
    <TwoStepVerification factors={factors.data?.totp ?? []} initialError={factors.error ? "Unable to load two-step verification. Refresh to try again." : undefined} />
    <Passkeys initialPasskeys={passkeys?.data ?? []} enabled={passkeysEnabled} initialError={passkeys?.error ? "Unable to load passkeys. Refresh to try again." : undefined} />
    {alipayEnabled || alipayConnected ? <SecuritySetting title="Sign-in options" actions={<AlipayConnection enabled={alipayEnabled} connected={alipayConnected} />} /> : null}
    <SecuritySetting title="WeChat" actions={<WechatConnection enabled={wechatEnabled} connected={wechatConnected} />} />
    <DeviceSessions initialSessions={sessions.data} initialError={sessions.error} />
    <details className="settings-help security-help"><summary>About sign-in security</summary><div className="space-y-2">
      <p>You will need to sign in again after changing your password.</p>
      <p>Use an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password. Add a second authenticator as a backup before replacing your phone.</p>
      <p>Passkeys are saved in your device or password manager. Your biometric data stays on your device. Two-step verification still applies when enabled. Times shown in UTC.</p>
      <p>Times shown in UTC. Ending a session blocks its next CRM request. Device details come from the browser and may be approximate.</p>
    </div></details>
  </div>;
}
