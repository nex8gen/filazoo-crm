import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { setupSteps } from "@/lib/setup-plan";
import { getSetupReadiness } from "@/lib/setup-status";

export const metadata = { title: "Setup center" };

export default function SetupPage() {
  const status = getSetupReadiness();
  return <>
    <PageHeader title="Setup center" description="Connect your integrations and review the steps to get your workspace ready." actions={<Link className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted" href="/automation">Review automation</Link>} />
    <section className="mb-6 grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-[1fr_auto]" aria-label="Integration readiness">
      <div><p className="text-sm text-muted-foreground">Overall readiness</p><p className="mt-1 text-3xl font-semibold">{status.percent}%</p><p className="mt-2 text-sm text-muted-foreground">{status.configured} of {status.total} integrations configured</p></div>
      <div><Badge variant="secondary">{status.dryRun ? "Dry run protected" : "Live mode"}</Badge><p className="mt-2 max-w-xs text-sm text-muted-foreground">{status.dryRun ? "No real outreach can be sent." : "Review production settings before sending outreach."}</p></div>
      <div role="progressbar" aria-label="Integration readiness" aria-valuenow={status.percent} aria-valuemin={0} aria-valuemax={100} className="h-2 overflow-hidden rounded-full bg-muted sm:col-span-2"><div className="h-full rounded-full bg-primary" style={{ width: `${status.percent}%` }} /></div>
    </section>
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <section className="space-y-4" aria-label="Setup steps">{setupSteps.map((step) => <article key={step.number} className="rounded-xl border bg-card p-4 sm:p-5">
        <header className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-sm font-semibold text-primary">{step.number}</span><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{step.owner}</p><h2 className="mt-1 text-base font-semibold">{step.title}</h2></div><Badge variant="outline">Waiting</Badge></header>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"><div className="rounded-lg bg-muted/40 p-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account setup</h3><p className="mt-2 text-sm leading-6">{step.manual}</p></div><div className="rounded-lg bg-muted/40 p-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Implementation</h3><p className="mt-2 text-sm leading-6">{step.coding}</p></div></div>
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">Required: <span className="font-medium text-foreground">{step.unlock}</span></p>
      </article>)}</section>
      <aside className="space-y-4">
        <section className="rounded-xl border p-5"><h2 className="font-semibold">Start here</h2><ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground"><li>Create a Supabase project.</li><li>Run <code className="break-all">supabase/schema.sql</code>.</li><li>Connect Supabase to this Vercel project.</li><li>Verify the connection.</li></ol></section>
        <section className="rounded-xl border p-5"><h2 className="font-semibold">Server credentials</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter secrets directly in Vercel.</p><ul className="mt-3 space-y-2">{["SUPABASE_SECRET_KEY", "GEMINI_API_KEY", "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "SMTP_PASSWORD", "TELEGRAM_BOT_TOKEN"].map((key) => <li key={key}><code className="block break-all rounded-md bg-muted p-2 text-xs">{key}</code></li>)}</ul></section>
        <section className="rounded-xl border p-5"><h2 className="font-semibold">Recommended pilot</h2><p className="mt-3 text-sm font-medium">Germany</p><p className="mt-1 text-sm text-muted-foreground">3D printing service bureaus</p><p className="mt-3 text-xs leading-5 text-muted-foreground">20–30 companies · human approval · dry run</p></section>
      </aside>
    </div>
  </>;
}
