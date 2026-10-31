"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleHelp, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlowScenarioFields } from "@/components/flow-scenario-fields";
import { flowScenarioSchema } from "@/lib/flow-email-test";
import { flowStepAtPath } from "@/lib/flow-engine";
import type { FlowCustomer } from "@/lib/flow-customers";
import type { FlowInput } from "@/lib/flows";
import { stepLabels } from "@/lib/flows";
import { previewFlowScenario, type FlowPreviewResult } from "@/lib/flow-preview";

export function FlowJourneyPreview({ flow, flowId, result, onResult, onFocus, onTestMessage }: {
  flow: FlowInput; flowId: string | null; result: FlowPreviewResult | null;
  onResult: (result: FlowPreviewResult | null) => void;
  onFocus: (id: string) => void;
  onTestMessage: (path: number[]) => void;
}) {
  const [mode, setMode] = useState<"customer" | "scenario">("customer");
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<FlowCustomer[]>([]);
  const [customer, setCustomer] = useState<FlowCustomer | null>(null);
  const [facts, setFacts] = useState(() => flowScenarioSchema.parse({}));
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const previewRequest = useRef<AbortController | null>(null);
  useEffect(() => () => previewRequest.current?.abort(), []);

  useEffect(() => {
    if (mode !== "customer") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ kind: "preview", query });
        const response = await fetch(`/api/flows/customers?${params}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load customers.");
        if (!controller.signal.aborted) { setCustomers(data.customers ?? []); setError(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load customers."); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, query]);

  async function preview(selected = customer) {
    previewRequest.current?.abort();
    const controller = new AbortController(); previewRequest.current = controller;
    setLoading(true); setError(""); onResult(null);
    try {
      if (mode === "scenario") { onResult(previewFlowScenario(flow, facts)); return; }
      const response = await fetch("/api/flows/preview", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow, ...(flowId ? { flowId } : {}), ...(mode === "customer" && selected ? { contactId: selected.id } : { scenario: facts }) }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to preview this journey.");
      if (!controller.signal.aborted) onResult(data);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to preview this journey."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <aside className="scroll-surface min-h-0 overflow-y-auto border-t bg-background p-5 lg:w-[360px] lg:shrink-0 lg:border-l lg:border-t-0" aria-label="Journey preview">
    <h2 className="text-sm font-semibold">Preview workflow</h2>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a customer or set scenario facts to follow their journey.</p>
    <div className="my-4 flex gap-2"><Button size="sm" variant={mode === "customer" ? "secondary" : "ghost"} disabled={loading} onClick={() => { setMode("customer"); setError(""); onResult(null); }}>Saved customer</Button><Button size="sm" variant={mode === "scenario" ? "secondary" : "ghost"} disabled={loading} onClick={() => { setMode("scenario"); setError(""); onResult(null); }}>Scenario</Button></div>
    {mode === "customer" ? <div className="space-y-3"><Label htmlFor="preview-customer-search">Find a customer</Label><Input id="preview-customer-search" value={query} placeholder="Search customer name or email" onChange={(event) => setQuery(event.target.value)} />{customer ? <p className="rounded-lg border p-3 text-xs" data-no-translate>{customer.name || customer.email}<br />{customer.companyName}</p> : null}<div className="max-h-48 space-y-1 overflow-auto">{searching ? <p role="status" className="text-xs text-muted-foreground">Loading customers…</p> : customers.map((item) => <button key={item.id} type="button" className={`w-full rounded-lg border p-3 text-left text-xs hover:border-primary ${customer?.id === item.id ? "border-primary bg-primary/5" : ""}`} onClick={() => { setCustomer(item); void preview(item); }} disabled={loading}><span data-no-translate className="block font-medium">{item.name || item.email}</span><span data-no-translate className="mt-1 block text-muted-foreground">{item.email} · {item.companyName}</span></button>)}{!searching && !customers.length ? <p className="text-xs text-muted-foreground">No customers found.</p> : null}</div></div> : <FlowScenarioFields facts={facts} onChange={(next) => { setFacts(next); onResult(null); }} disabled={loading} />}
    <Button className="my-4 w-full" variant="outline" onClick={() => void preview()} disabled={loading || (mode === "customer" && !customer)}>{loading ? <LoaderCircle className="animate-spin" /> : null}{loading ? "Previewing…" : "Preview journey"}</Button>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {result ? <div className="space-y-5" aria-live="polite"><section><h3 className={`text-sm font-semibold ${result.enters ? "text-emerald-700" : "text-destructive"}`}>{result.enters ? "Enters the workflow" : "Does not enter"}</h3><div className="mt-3 space-y-3">{result.checks.map((check) => { const Icon = check.passed === null ? CircleHelp : check.passed ? CheckCircle2 : XCircle; return <details key={check.label} className="rounded-lg border p-3 text-xs"><summary className="flex cursor-pointer items-center gap-2 font-medium"><Icon className={`size-4 ${check.passed === false ? "text-destructive" : "text-muted-foreground"}`} />{check.label}</summary><p className="mt-2 leading-5 text-muted-foreground">{check.detail}</p></details>; })}</div></section><section><h3 className="text-xs font-semibold">Journey timeline</h3><ol className="mt-3 space-y-3">{result.trace.map((entry, index) => { const path = entry.stepPath ?? [entry.step - 1]; const action = flowStepAtPath(flow, path); return <li key={index} className="border-l-2 border-primary/25 pl-3"><button type="button" className="text-left text-xs font-semibold hover:text-primary" onClick={() => action?.id && onFocus(action.id)}>{stepLabels[entry.type]}</button><p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.detail}</p>{entry.pathChecks ? <details className="mt-2 text-xs"><summary className="cursor-pointer text-primary">View path checks</summary><ul className="mt-2 space-y-1">{entry.pathChecks.map((check) => <li key={check.name}><span data-no-translate>{check.name}</span> · {check.matched === null ? "Not evaluated" : check.matched ? "Matched" : "Did not match"}</li>)}</ul></details> : null}{entry.scheduledAt ? <time data-no-translate className="mt-1 block text-[11px] text-muted-foreground">{new Date(entry.scheduledAt).toLocaleString()}</time> : null}{["send_email", "ai_auto_reply"].includes(entry.type) && entry.status === "would_run" ? <Button size="sm" variant="link" className="h-auto px-0 py-1 text-xs" onClick={() => onTestMessage(path)}>Preview & test message</Button> : null}</li>; })}</ol></section><div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}
  </aside>;
}
