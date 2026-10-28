import { CheckCircle2, ExternalLink, Mail, Plus } from "lucide-react";
import type { ConnectionApp } from "@/lib/connection-apps";
import { mailboxAppId } from "@/lib/app-connection-status";
import { getPersonalAppMailboxes, getTeamAppMailboxes } from "@/lib/data/app-connections";
import type { EmailConnectionScope } from "@/lib/email-connections";
import { getErpSettingsView } from "@/lib/data/erp-settings";
import { getInventoryState } from "@/lib/data/inventory";
import { listProducts } from "@/lib/data/crm";
import { env } from "@/lib/env";
import { getBridgeSecret } from "@/lib/meta-lead-bridge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErpConnectionForm } from "../erp-connection-form";
import { GmailConnectionForm } from "./gmail-connection-form";
import { NeteaseConnectionForm } from "./netease-connection-form";
import { neteaseProfileForHosts } from "@/lib/netease-mail";

async function EmailAccounts({ appId, scope }: { appId: "gmail" | "outlook" | "netease-mail"; scope: EmailConnectionScope }) {
  let result;
  try { result = await (scope === "workspace" ? getTeamAppMailboxes() : getPersonalAppMailboxes()); }
  catch { return <p role="alert" className="rounded-xl border p-5 text-sm text-destructive">Your saved connections could not be loaded. Refresh before adding or updating an account.</p>; }
  const accounts = result.mailboxes.filter(mailbox => mailboxAppId({ smtp_host: mailbox.smtpHost, imap_host: mailbox.imapHost, provider: mailbox.provider }) === appId);

  return (
    <div className="space-y-6">
      {accounts.length ? <section aria-label="Connected accounts" className="space-y-3"><h2 className="text-base font-semibold">{scope === "workspace" ? "Team accounts" : "My accounts"}</h2>{accounts.map(account => (
        <Card key={account.id} id={`account-${account.id}`} className="scroll-mt-6 shadow-none"><CardContent className="space-y-4 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><Mail className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="break-all text-sm font-medium">{account.email}</p><p className="text-xs text-muted-foreground">{account.displayName || "Personal account"}{account.isDefault ? " · Default sender" : ""}</p></div></div><Badge variant="outline">{!account.isActive ? "Paused" : account.smtpPassword && account.imapPassword && account.smtpUsername && account.imapUsername ? "Connected" : "Setup needed"}</Badge></div>
          {appId === "gmail" || appId === "netease-mail" ? <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Update connection</summary><div className="pt-5">{appId === "gmail" ? <GmailConnectionForm scope={scope} account={{ id: account.id, email: account.email, name: account.displayName || "Gmail" }} /> : <NeteaseConnectionForm scope={scope} account={{ id: account.id, email: account.email, name: account.displayName || "Lingxi Mail", serverProfile: neteaseProfileForHosts(account.smtpHost, account.imapHost) ?? "standard", smtpPort: account.smtpPort ?? 994 }} />}</div></details> : null}
        </CardContent></Card>
      ))}</section> : null}
      {appId === "netease-mail" ? <>
        <Card className="shadow-none"><CardHeader><CardTitle>{accounts.length ? "Add another Lingxi account" : "Connect Lingxi Mail"}</CardTitle><CardDescription>网易灵犀办公 · mail.qiye.163.com · Connect your {scope === "workspace" ? "team" : "personal"} inbox with a client authorization password.</CardDescription></CardHeader><CardContent><NeteaseConnectionForm scope={scope} /></CardContent></Card>
        <Card className="shadow-none"><CardHeader><CardTitle>Before you connect</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-6 text-muted-foreground"><ol className="list-decimal space-y-2 pl-5"><li>Sign in to NetEase / Lingxi using your full business email address.</li><li>Open Settings → Account and security → Client settings. Enable IMAP/SMTP access and generate a client authorization password.</li><li>Enter your business email and authorization password above. If your account lists different servers, select the matching profile under Mail server settings.</li></ol><a href="https://mail.qiye.163.com/static/login/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-foreground underline underline-offset-4">Open NetEase Mail<ExternalLink className="size-3.5" /></a></CardContent></Card>
      </> : appId === "gmail" ? <>
        <Card className="shadow-none"><CardHeader><CardTitle>{accounts.length ? "Add another Gmail account" : "Connect Gmail"}</CardTitle><CardDescription>Connect your {scope === "workspace" ? "team" : "personal"} Gmail or Google Workspace inbox with an app password.</CardDescription></CardHeader><CardContent><GmailConnectionForm scope={scope} /></CardContent></Card>
        <Card className="shadow-none"><CardHeader><CardTitle>Before you connect</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-6 text-muted-foreground"><ol className="list-decimal space-y-2 pl-5"><li>Turn on 2-Step Verification in your Google account.</li><li>Create an app password for Filazoo CRM if your Google account supports app passwords.</li><li>Enter your email and app password above. Filazoo checks both mail connections before saving.</li></ol><a href="https://support.google.com/mail/answer/185833" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-foreground underline underline-offset-4">Google app password guide<ExternalLink className="size-3.5" /></a></CardContent></Card>
      </> : <UnavailableConnection appName="Microsoft Outlook" description="Microsoft sign-in is not available yet. Existing manually configured Outlook accounts are shown above and keep their current settings." />}
    </div>
  );
}

function UnavailableConnection({ appName, description }: { appName: string; description: string }) {
  return <Card className="shadow-none"><CardHeader><CardTitle>Connect {appName}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><Button disabled><Plus />Connect {appName}</Button><p className="mt-3 text-xs text-muted-foreground">This connector is coming soon.</p></CardContent></Card>;
}

async function LingxingSetup() {
  const [settings, inventory, products] = await Promise.all([getErpSettingsView(), getInventoryState(), listProducts()]);
  const skus = [...new Map(products.products.flatMap(product => [{ sku: product.sku, name: product.name }, ...product.variants.map(variant => ({ sku: variant.sku, name: `${product.name} - ${variant.name}` }))]).map(product => [product.sku, product])).values()];
  return <ErpConnectionForm key={settings.revision} initial={settings} status={inventory.status} products={skus} />;
}

function MakeSetup() {
  const secret = getBridgeSecret(env.supabaseSecretKey, process.env.META_LEAD_BRIDGE_SECRET);
  const receiver = new URL("/api/meta/lead-bridge", env.NEXT_PUBLIC_APP_URL).toString();
  const example = JSON.stringify({ lead_id: "MAP_ORIGINAL_META_LEAD_ID", page_id: "MAP_PAGE_ID", full_name: "MAP_FULL_NAME", email: "MAP_EMAIL", phone: "MAP_PHONE" }, null, 2);
  return <Card className="shadow-none"><CardHeader><CardTitle>Connect Meta leads through Make</CardTitle><CardDescription>Receive Facebook and Instagram Instant Form submissions in Filazoo.</CardDescription></CardHeader><CardContent className="space-y-5 text-sm leading-6">
    <ol className="list-decimal space-y-3 pl-5"><li>In Make, add Facebook Lead Ads → New Lead. Sign in and choose your Page and Instant Form.</li><li>Add an HTTP request: POST to the receiver below with a JSON body.</li><li>Add an Authorization header with <code>Bearer YOUR_CONNECTION_SECRET</code>, then map the original lead ID and form answers.</li><li>Run the scenario once and submit a test lead. Enable the scenario after confirming the lead arrived.</li></ol>
    <div><p className="mb-2 font-medium">Receiver URL</p><code className="block break-all rounded-lg bg-muted p-3">{receiver}</code><p className="mt-2 text-xs text-muted-foreground">Use your deployed public CRM domain so Make can reach the receiver.</p></div>
    {secret ? <details><summary className="cursor-pointer font-medium">Show connection secret</summary><code className="mt-2 block break-all rounded-lg bg-muted p-3">{secret}</code></details> : <p role="alert" className="text-destructive">The CRM receiver needs server configuration before it can accept leads.</p>}
    <details><summary className="cursor-pointer font-medium">JSON field mapping</summary><pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">{example}</pre></details>
    <p className="text-muted-foreground">Receiver configuration is checked automatically. A successful test submission is needed to verify delivery from your Make scenario.</p>
  </CardContent></Card>;
}

function ManagedChannelSetup({ app }: { app: ConnectionApp }) {
  const shopify = app.id === "shopify";
  const whatsapp = app.id === "whatsapp";
  const receiver = new URL(shopify ? "/api/shopify/webhook" : whatsapp ? "/api/twilio/webhook" : "/api/meta/webhook", env.NEXT_PUBLIC_APP_URL).toString();
  const checks = shopify ? [
    { label: "Store domain configured", ready: Boolean(env.SHOPIFY_STORE_DOMAIN) },
    { label: "Webhook signing secret configured", ready: Boolean(env.SHOPIFY_WEBHOOK_SECRET) },
  ] : whatsapp ? [
    { label: "Twilio account configured", ready: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) },
    { label: "WhatsApp business sender configured", ready: Boolean(env.TWILIO_WHATSAPP_FROM) },
    { label: "Webhook callback configured", ready: Boolean(env.TWILIO_WEBHOOK_URL) },
  ] : [
    { label: "Meta Page and access token configured", ready: Boolean(env.META_FACEBOOK_PAGE_ID && env.META_FACEBOOK_PAGE_ACCESS_TOKEN) },
    { label: "Webhook signature secret configured", ready: Boolean(env.META_WEBHOOK_SECRET) },
    { label: "Webhook verification token configured", ready: Boolean(env.META_VERIFY_TOKEN) },
  ];
  return <Card className="shadow-none"><CardHeader><CardTitle>Connect {app.name}</CardTitle><CardDescription>{shopify ? "Connect your store's B2B lead webhook." : `Set up your ${app.name} account and incoming message callback.`}</CardDescription></CardHeader><CardContent className="space-y-5 text-sm leading-6">
    <p className="text-muted-foreground">This channel currently uses an administrator-managed server connection. Credentials are configured on the CRM server; guided account sign-in is not available yet.</p>
    <ul className="space-y-3">{checks.map(check => <li key={check.label} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span>{check.label}</span><Badge variant="outline" className={check.ready ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{check.ready ? <CheckCircle2 className="size-3" /> : null}{check.ready ? "Configured" : "Required"}</Badge></li>)}</ul>
    <div><p className="mb-2 font-medium">Incoming webhook URL</p><code className="block break-all rounded-lg bg-muted p-3">{receiver}</code></div>
    <p className="text-muted-foreground">{shopify ? "Configure a customers/create webhook for the connected store and tag the B2B leads you want imported. Use a test form submission to verify that a customer arrives in the CRM." : "Register the callback with your messaging provider, grant the required account permissions, then send an incoming test message to verify delivery."}</p>
    <p className="text-xs text-muted-foreground">Configuration checks show saved server setup. They do not confirm provider authorization or message delivery.</p>
  </CardContent></Card>;
}

export function AppSetup({ app, scope = "personal" }: { app: ConnectionApp; scope?: EmailConnectionScope }) {
  if (app.id === "gmail" || app.id === "outlook" || app.id === "netease-mail") return <EmailAccounts appId={app.id} scope={scope} />;
  if (app.id === "lingxing") return <LingxingSetup />;
  if (app.id === "make" || app.id === "meta-leads") return <MakeSetup />;
  if (["whatsapp", "facebook", "instagram", "shopify"].includes(app.id)) return <ManagedChannelSetup app={app} />;
  return <UnavailableConnection appName={app.name} description={app.details} />;
}
