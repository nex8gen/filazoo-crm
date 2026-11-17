"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Check, Copy, Globe, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { updatePortalDomain } from "@/app/customer-portal/domains/actions";
import { portalDomainLabels, type PortalDomain } from "@/lib/portal-domains";

export function PortalDomainSettings({ domain: initial, hostingReady, canWrite }: { domain: PortalDomain | null; hostingReady: boolean; canWrite: boolean }) {
  const [domain, setDomain] = useState(initial);
  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const locked = useRef(false);
  async function run(action: "connect" | "verify" | "disconnect") {
    if (!canWrite || locked.current) return;
    locked.current = true; setBusy(action); setError(""); setNotice("");
    try {
      const result = await updatePortalDomain(action, hostname);
      if ("error" in result) { setError(result.error || "Unable to update your domain."); if (result.domain !== undefined) setDomain(result.domain); }
      else { setDomain(result.domain); setNotice(action === "disconnect" ? "Custom domain disconnected. Your standard portal links still work." : result.domain?.status === "connected" ? "Your custom domain is connected and secured with HTTPS." : "Domain settings updated."); }
    } catch { setError("Unable to update your domain. Please try again."); }
    finally { locked.current = false; setBusy(""); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void run("connect"); }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setError("Unable to copy. Select and copy the record manually."); }
  }
  return <div className="scroll-surface h-full overflow-auto bg-muted/20 p-5 sm:p-8"><div className="mx-auto max-w-3xl space-y-6">
    <Link href="/customer-portal" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to customer portal</Link>
    <header><div className="mb-4 grid size-11 place-items-center rounded-xl border bg-background"><Globe className="size-5 text-primary" /></div><h1 className="text-xl font-semibold">Your portal, your domain</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Give your customers a familiar address, like portal.yourbrand.com. A custom domain is optional; your standard portal links continue to work.</p></header>
    {!canWrite && <p className="rounded-xl border bg-background p-4 text-sm text-muted-foreground">Only workspace admins can connect or disconnect a domain.</p>}
    {!hostingReady && <p role="status" className="rounded-xl border bg-background p-4 text-sm text-muted-foreground">Custom domain connections are not enabled for this installation yet. The installation administrator needs to enable domain hosting first.</p>}
    {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-xl border bg-background p-4 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{notice}</p>}
    {!domain ? <form onSubmit={submit} className="rounded-2xl border bg-background p-5 sm:p-6"><label htmlFor="portal-custom-domain" className="text-sm font-medium">Connect a domain you own</label><p className="mb-4 mt-1 text-xs leading-5 text-muted-foreground">We recommend a subdomain so your main website stays where it is.</p><div className="flex flex-col gap-3 sm:flex-row"><Input id="portal-custom-domain" value={hostname} onChange={event => setHostname(event.target.value)} placeholder="portal.yourbrand.com" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={253} disabled={!canWrite || Boolean(busy)} /><Button type="submit" disabled={!canWrite || !hostingReady || Boolean(busy) || !hostname.trim()}>{busy === "connect" && <LoaderCircle className="animate-spin" />}Connect domain</Button></div></form> : <section aria-label="Connected domain settings" className="overflow-hidden rounded-2xl border bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b p-5 sm:p-6"><div className="min-w-0"><h2 className="break-all text-base font-semibold">{domain.hostname}</h2><p className="mt-1 text-xs text-muted-foreground">Customer portal domain</p></div><Badge variant={domain.status === "connected" ? "default" : "secondary"}>{portalDomainLabels[domain.status]}</Badge></header>
      <div className="space-y-5 p-5 sm:p-6">{domain.message && <p role="status" className="rounded-lg bg-muted/60 p-3 text-xs leading-5">{domain.message}</p>}
        <div><h3 className="text-sm font-medium">Add these records at your DNS provider</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Use the full record names below, or just the subdomain if your provider adds your domain automatically. Keep these records in place. Turn off proxying while connecting.</p></div>
        <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-xs"><caption className="sr-only">Required custom domain DNS records</caption><thead className="bg-muted/50 text-muted-foreground"><tr><th className="p-3 font-medium">Type</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Value</th></tr></thead><tbody>{domain.records.map((record, index) => <tr key={`${record.type}:${record.name}:${index}`} className="border-t"><td className="p-3 align-top font-medium">{record.type}</td><td className="max-w-56 p-3 align-top"><div className="flex items-start gap-2"><code className="break-all">{record.name}</code><button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Copy DNS name ${record.name}`} onClick={() => void copy(record.name)}><Copy className="size-3" /></button></div></td><td className="max-w-72 p-3 align-top"><div className="flex items-start gap-2"><code className="break-all">{record.value}</code><button type="button" className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Copy ${record.type} value`} onClick={() => void copy(record.value)}><Copy className="size-3" /></button></div></td></tr>)}</tbody></table></div>
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" />The connection becomes active after ownership, DNS, and HTTPS are verified. DNS updates can take up to 48 hours.</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!canWrite || !hostingReady || Boolean(busy) || domain.status === "disconnecting"} onClick={() => void run("verify")}>{busy === "verify" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}Check connection</Button>{domain.status === "connected" && <a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium hover:bg-muted">Open portal<ArrowUpRight className="size-3.5" /></a>}</div>
      </div><footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-5 py-4"><p className="text-xs text-muted-foreground">Disconnecting switches new portal links back to the standard address.</p><Button variant="ghost" size="sm" disabled={!canWrite || Boolean(busy)} onClick={() => setConfirm(true)}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect domain"}</Button></footer>
    </section>}
    <ConfirmActionDialog open={confirm} onOpenChange={setConfirm} title="Disconnect this domain?" description="Links using this custom domain will stop working. Your standard portal links will continue to work. You can connect the domain again later." onConfirm={() => run("disconnect")} />
  </div></div>;
}
