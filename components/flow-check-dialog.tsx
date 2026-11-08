"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, CircleHelp, LoaderCircle, Mail, RotateCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { FlowInput } from "@/lib/flows";
import type { FlowCheckResult } from "@/lib/flow-check";

export function FlowCheckDialog({ flow, flowId, onOpenChange, onDeliveryTest }: { flow: FlowInput; flowId: string | null; onOpenChange: (open: boolean) => void; onDeliveryTest: () => void }) {
  const [report, setReport] = useState<FlowCheckResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    void fetch("/api/flows/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flow, flowId }), signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Unable to check this workflow.");
        if (!controller.signal.aborted) { setReport(result); setError(""); }
      })
      .catch(cause => { if (!active) return; if (controller.signal.aborted) setError("The check timed out. Connections have not been verified. Try again."); else setError(cause instanceof Error ? cause.message : "Unable to check this workflow."); })
      .finally(() => { clearTimeout(timeout); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [flow, flowId, revision]);
  return <Dialog open onOpenChange={onOpenChange}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />Quick workflow check</DialogTitle><DialogDescription>Checks real sender authentication, AI access, recipients and resources for every action. No customer messages or CRM changes.</DialogDescription></DialogHeader>
    {loading ? <div role="status" className="flex items-center gap-3 rounded-lg border p-5 text-sm"><LoaderCircle className="size-4 animate-spin text-primary" /><div><p className="font-medium">Checking live connections…</p><p className="mt-1 text-xs text-muted-foreground">Usually a few seconds. Slow or unavailable services are reported as unverified.</p></div></div> : null}
    {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
    {!loading && report ? <div aria-live="polite" className="space-y-4"><div className={`rounded-lg border p-4 ${report.status === "blocked" ? "border-destructive/30 bg-destructive/5" : report.status === "ready" ? "border-emerald-500/30 bg-emerald-500/5" : "bg-muted/30"}`}><p className="font-semibold">{report.status === "blocked" ? "Fix the blockers below" : report.status === "ready" ? "Connection and resource checks passed" : "Some connections could not be verified"}</p><p className="mt-1 text-xs text-muted-foreground">{report.actionCount} actions · {(report.durationMs / 1000).toFixed(1)}s · Checked {new Date(report.checkedAt).toLocaleTimeString()}</p></div><div className="space-y-2">{report.checks.map(check => { const Icon = check.status === "passed" ? CheckCircle2 : check.status === "unverified" ? CircleHelp : AlertCircle; return <div key={check.id} className="flex gap-3 rounded-lg border p-3"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${check.status === "passed" ? "text-emerald-600" : check.status === "blocked" ? "text-destructive" : "text-amber-600"}`} /><div className="min-w-0"><p className="text-sm font-medium">{check.actionPath ? `Step ${check.actionPath.map(i => i + 1).join(".")} · ` : ""}{check.label}<span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">{check.status}</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{check.detail}</p>{check.links?.length ? <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{check.links.map(link => <Link key={link.href} href={link.href} data-no-translate className="text-xs text-primary underline">{link.label}</Link>)}</div> : null}</div></div>; })}</div><p className="text-xs leading-5 text-muted-foreground">For proof of AI generation and email submission, send a test to your own inbox. Quick checks do not execute actions or verify future trigger delivery.</p></div> : null}
    <DialogFooter><Button variant="outline" disabled={loading} onClick={() => { setReport(null); setError(""); setLoading(true); setRevision(value => value + 1); }}><RotateCw />Check again</Button><Button onClick={onDeliveryTest}><Mail />Send test email</Button></DialogFooter>
  </DialogContent></Dialog>;
}
