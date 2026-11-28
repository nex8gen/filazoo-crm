import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export function wechatProviderSettings(environment) {
  const secret = environment.WECHAT_OAUTH_CLIENT_SECRET || "";
  const subjectKey = environment.WECHAT_OAUTH_SUBJECT_KEY || "";
  if (secret.length < 43 || subjectKey.length < 43) throw new Error("Set WECHAT_OAUTH_CLIENT_SECRET and WECHAT_OAUTH_SUBJECT_KEY to independent random 32-byte base64url secrets.");
  const origin = new URL(environment.NEXT_PUBLIC_APP_URL).origin;
  if (!origin.startsWith("https://")) throw new Error("Set NEXT_PUBLIC_APP_URL to the public HTTPS application URL.");
  const enabled = environment.WECHAT_LOGIN_ENABLED === "true";
  if (enabled && (!/^wx[a-f0-9]{16}$/i.test(environment.WECHAT_APP_ID || "") || !/^[a-f0-9]{32}$/i.test(environment.WECHAT_APP_SECRET || ""))) {
    throw new Error("Activation requires an approved website app's WECHAT_APP_ID and WECHAT_APP_SECRET.");
  }
  return {
    name: "WeChat", client_id: "filazoo-wechat", client_secret: secret,
    authorization_url: `${origin}/auth/wechat/authorize`, token_url: `${origin}/auth/wechat/token`, userinfo_url: `${origin}/auth/wechat/userinfo`,
    scopes: ["profile"], pkce_enabled: true, email_optional: true, enabled,
    attribute_mapping: { id: "sub", name: "name" },
  };
}

async function main() {
  const settings = wechatProviderSettings(process.env);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set the Supabase URL and server-only secret key.");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } });
  const { error: tableError } = await client.from("wechat_login_grants").select("code_hash").limit(0);
  if (tableError) throw new Error("Apply the wechat_oauth_bridge migration before configuring the provider.");
  const api = client.auth.admin.customProviders;
  const existing = await api.listProviders();
  if (existing.error) throw new Error("Unable to read custom OAuth providers. Check server credentials.");
  const provider = existing.data.providers.find(item => item.identifier === "custom:wechat");
  if (process.argv.includes("--check")) {
    if (!provider) throw new Error("custom:wechat is not registered. Run this script without --check to register it.");
    for (const field of ["client_id", "authorization_url", "token_url", "userinfo_url", "pkce_enabled", "email_optional", "enabled"]) {
      if (provider[field] !== settings[field]) throw new Error(`WeChat provider configuration mismatch: ${field}.`);
    }
    console.log(`WeChat provider and database verified. Provider ${provider.enabled ? "enabled" : "disabled"}. Real WeChat consent must still be tested.`);
    return;
  }
  const result = provider
    ? await api.updateProvider("custom:wechat", settings)
    : await api.createProvider({ provider_type: "oauth2", identifier: "custom:wechat", ...settings });
  if (result.error) throw new Error("Unable to save the WeChat provider. Check the Supabase auth configuration.");
  console.log(`WeChat provider saved ${settings.enabled ? "enabled" : "disabled"}. Deploy matching server environment variables, then run this script with --check.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
