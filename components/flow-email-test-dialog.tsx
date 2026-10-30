"use client";

import { useEffect, useRef, useState } from "react";
import { FlaskConical, FileText, LoaderCircle, Mail, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { flowEmailDeliveryTestSchema, flowEmailTestSchema, type FlowEmailDeliveryTestRun, type FlowEmailTestResult } from "@/lib/flow-email-test";
import { flowScenarioSchema } from "@/lib/flow-email-test";
import { FlowScenarioFields } from "@/components/flow-scenario-fields";
import type { FlowInput } from "@/lib/flows";
import type { FlowFacts } from "@/lib/flow-engine";

const examples = [
  { label: "Pricing inquiry", subject: "Black PLA pricing", body: "Hi, we run a print farm and need 100 rolls of black PLA, 1.75 mm, 1 kg. Can you share your pricing and product catalog?" },
  { label: "Catalog request", subject: "Product catalog for our store", body: "Hello, we are interested in selling your filament. Please send us your product catalog and let us know your minimum order quantities." },
] as const;
const blankEmail = () => ({ id: crypto.randomUUID(), from: "customer@example.com", subject: "", body: "" });

export function FlowEmailTestDialog({ flow, open, onOpenChange, messageStepPath, sample }: { flow: FlowInput; open: boolean; onOpenChange: (open: boolean) => void; messageStepPath?: number[]; sample?: { facts: FlowFacts; customerName?: string | null; companyName?: string | null; email?: string | null } }) {
  const [emails, setEmails] = useState<Array<ReturnType<typeof blankEmail>>>(() => [{ ...blankEmail(), from: sample?.email || "customer@example.com", subject: examples[0].subject, body: examples[0].body }]);
  const [customerName, setCustomerName] = useState(sample?.customerName || "Alex");
  const [companyName, setCompanyName] = useState(sample?.companyName || "Sample company");
  const [firstMessage, setFirstMessage] = useState(true);
  const [result, setResult] = useState<FlowEmailTestResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [sendReal, setSendReal] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [facts, setFacts] = useState(() => flowScenarioSchema.parse(sample?.facts ?? {
    ...Object.fromEntries(["category", "segment", "country", "companyStatus", "pipelineStage"].map((key) => [key, typeof flow.triggerConfig[key] === "string" ? flow.triggerConfig[key] : null])),
    fitScore: typeof flow.triggerConfig.minFitScore === "number" ? flow.triggerConfig.minFitScore : null,
  }));
  const [recipient, setRecipient] = useState("");
  const [delivery, setDelivery] = useState<FlowEmailDeliveryTestRun | null>(null);
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);
  const pending = delivery?.status === "waiting";
  const deliveryId = delivery?.id;
  const deliveryStatus = delivery?.status;

  useEffect(() => {
    if (!open || !deliveryId || deliveryStatus !== "waiting") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/flows/test-email/send/${deliveryId}`, { method: "POST" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to check test delivery.");
        if (stopped) return;
        setDelivery(data.run); setError("");
        if (data.run.status !== "waiting") return;
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Unable to check test delivery.");
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [open, deliveryId, deliveryStatus]);

  function updateEmail(id: string, field: "from" | "subject" | "body", value: string) {
    setEmails((current) => current.map((email) => email.id === id ? { ...email, [field]: value } : email));
    setResult(null);
  }

  async function runTest() {
    if (busy.current) return;
    if (sendReal) {
      requestId.current ??= crypto.randomUUID();
      const parsed = flowEmailDeliveryTestSchema.safeParse({ flow, customerName, companyName, firstMessage, facts, messageStepPath, emails: emails.slice(0, 1), recipient, requestId: requestId.current });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Enter a test recipient and one sample email."); return; }
      busy.current = true; setRunning(true); setError(""); setResult(null);
      try {
        const response = await fetch("/api/flows/test-email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to start the real delivery test.");
        setDelivery(data.run);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start the real delivery test."); }
      finally { busy.current = false; setRunning(false); }
      return;
    }
    const parsed = flowEmailTestSchema.safeParse({ flow, customerName, companyName, firstMessage, facts, messageStepPath, emails });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Complete the flow settings and sample emails."); return; }
    busy.current = true; setRunning(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/flows/test-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to test the flow.");
      setResult(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to test the flow.");
    } finally { busy.current = false; setRunning(false); }
  }

  async function cancelDelivery() {
    if (!delivery || busy.current) return;
    busy.current = true; setRunning(true);
    try {
      const response = await fetch(`/api/flows/test-email/send/${delivery.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to cancel the test.");
      setDelivery(data.run); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to cancel the test."); }
    finally { busy.current = false; setRunning(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => { if (!running) onOpenChange(next); }}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl" showCloseButton={!running}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-violet-600" />{messageStepPath ? "Preview & test message" : "Test flow with emails"}</DialogTitle>
        <DialogDescription>Test the current flow before turning it on. Send a real reply to your test inbox, or generate a preview.</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={sendReal} disabled={running || pending} onCheckedChange={(value) => { setSendReal(value === true); setResult(null); setDelivery(null); requestId.current = null; }} /><span>Send real test emails</span></label>
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200">{messageStepPath ? sendReal ? "This test sends only the selected message to your test recipient immediately. It does not run the surrounding journey." : "Preview only the selected message with your sample customer and email data." : sendReal ? "Real tests follow the configured waits and send only to your test recipient. Keep this dialog open until delivery finishes. CRM tasks, alerts and category changes are simulated; the flow stays unchanged." : "Preview simulates waits immediately using your scenario facts. Journey entry is assumed; use Preview flow to check saved customer eligibility. No email or CRM action is executed."}</div>
        <fieldset disabled={running || pending || Boolean(delivery)} className="space-y-4">
          {sendReal ? <label className="block space-y-1.5 text-xs font-medium"><span>Test recipient email</span><Input type="email" value={recipient} maxLength={300} placeholder="Your test inbox" onChange={(event) => setRecipient(event.target.value)} /><span className="block font-normal text-muted-foreground">Actual emails and catalog attachments will be sent to this address.</span></label> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium"><span>Customer name</span><Input value={customerName} maxLength={200} onChange={(event) => { setCustomerName(event.target.value); setResult(null); }} /></label>
            <label className="space-y-1.5 text-xs font-medium"><span>Company name</span><Input value={companyName} maxLength={300} onChange={(event) => { setCompanyName(event.target.value); setResult(null); }} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={firstMessage} onCheckedChange={(value) => { setFirstMessage(value === true); setResult(null); }} /><span>Test as the first automated message</span></label>
          {(sendReal ? emails.slice(0, 1) : emails).map((email, index) => <section key={email.id} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Sample email {index + 1}</p><div className="flex flex-wrap gap-1">{examples.map((example) => <Button key={example.label} variant="ghost" size="sm" onClick={() => { setEmails((current) => current.map((item) => item.id === email.id ? { ...item, subject: example.subject, body: example.body } : item)); setResult(null); }}>{example.label}</Button>)}{emails.length > 1 ? <Button variant="ghost" size="icon-sm" aria-label={`Remove sample email ${index + 1}`} onClick={() => { setEmails((current) => current.filter((item) => item.id !== email.id)); setResult(null); }}><Trash2 className="size-4" /></Button> : null}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs font-medium"><span>Sample sender email</span><Input type="email" value={email.from} maxLength={300} onChange={(event) => updateEmail(email.id, "from", event.target.value)} /></label><label className="space-y-1.5 text-xs font-medium"><span>Subject</span><Input value={email.subject} maxLength={300} onChange={(event) => updateEmail(email.id, "subject", event.target.value)} /></label></div>
            <label className="block space-y-1.5 text-xs font-medium"><span>Incoming email</span><Textarea value={email.body} maxLength={6000} className="min-h-28" placeholder="Paste a customer email here…" onChange={(event) => updateEmail(email.id, "body", event.target.value)} /></label>
          </section>)}
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-xs font-semibold">Scenario facts</summary><div className="mt-4"><FlowScenarioFields facts={facts} onChange={(next) => { setFacts(next); setResult(null); }} disabled={running || pending} /></div></details>
          {!sendReal ? <Button variant="outline" size="sm" disabled={running || emails.length >= 3} onClick={() => { setEmails((current) => [...current, blankEmail()]); setResult(null); }}><Plus />Add sample email</Button> : null}
        </fieldset>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {running ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Testing flow and generating replies…</p> : null}
        {delivery ? <div aria-live="polite" className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Real delivery test</h3>
          <p className="text-sm" data-no-translate>{delivery.recipient} · {delivery.status}</p>
          {pending && delivery.next_run_at ? <p className="text-xs text-muted-foreground">Next email: <time data-no-translate>{new Date(delivery.next_run_at).toLocaleString()}</time></p> : null}
          {delivery.result.map((reply) => <div key={reply.step} className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm"><p className="font-medium" data-no-translate>{reply.subject}</p><p className="whitespace-pre-wrap" data-no-translate>{reply.body}</p><p className="text-xs text-muted-foreground">Accepted by mail server: <time data-no-translate>{new Date(reply.sentAt).toLocaleString()}</time></p>{reply.attachments.map((attachment) => <p key={attachment.filename} className="text-xs" data-no-translate>{attachment.filename} · {Math.ceil(attachment.size / 1024)} KB</p>)}</div>)}
          {delivery.error ? <p role="alert" className="text-sm text-destructive">{delivery.error}</p> : null}
          {pending ? <Button variant="outline" size="sm" disabled={running} onClick={() => void cancelDelivery()}>Cancel delivery test</Button> : <Button variant="outline" size="sm" onClick={() => { setDelivery(null); requestId.current = null; setError(""); }}>Start another test</Button>}
        </div> : null}
        {result ? <div aria-live="polite" className="space-y-4 border-t pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Test results</h3><div className="flex gap-1"><Button variant={device === "desktop" ? "secondary" : "ghost"} size="sm" onClick={() => setDevice("desktop")}>Desktop</Button><Button variant={device === "mobile" ? "secondary" : "ghost"} size="sm" onClick={() => setDevice("mobile")}>Mobile</Button></div></div>{result.cases.map((testCase, index) => <section key={index} className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-semibold" data-no-translate>{index + 1}. {testCase.subject}</p>
          <ol className="space-y-2">{testCase.trace.map((entry, traceIndex) => <li key={traceIndex} className="flex items-start gap-2 text-xs"><span className={`mt-1 size-2 shrink-0 rounded-full ${entry.status === "skipped" || entry.status === "stopped" ? "bg-amber-400" : "bg-emerald-500"}`} /><span><strong>Step {entry.step}</strong> · {entry.detail}</span></li>)}</ol>
          {testCase.replies.map((reply) => <div key={reply.step} className="space-y-3 rounded-lg bg-muted/40 p-4"><p className="text-xs font-semibold">Message preview · Step {reply.step}</p><div className={`mx-auto w-full overflow-hidden rounded-xl border bg-white text-slate-900 transition-[max-width] ${device === "mobile" ? "max-w-[360px]" : "max-w-[640px]"}`}><div className="space-y-1 border-b bg-slate-50 px-5 py-4"><p className="text-xs text-slate-500">To: <span data-no-translate>{customerName || emails[index]?.from}</span></p><p className="text-sm font-semibold" data-no-translate>{reply.subject}</p></div><div className="whitespace-pre-wrap break-words px-5 py-6 text-sm leading-6" data-no-translate>{reply.body}</div></div>{reply.attachments.map((attachment) => <div key={attachment.filename} className="flex items-center gap-2 rounded-lg border bg-background p-3 text-xs"><FileText className="size-4 text-violet-600" /><span data-no-translate>{attachment.filename} · {Math.ceil(attachment.size / 1024)} KB</span><span className="ml-auto text-muted-foreground">Would attach</span></div>)}</div>)}
          {testCase.error ? <p role="alert" className="text-sm text-destructive">{testCase.error}</p> : null}
        </section>)}</div> : null}
      </div>
      <DialogFooter><Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>Close</Button><Button disabled={running || Boolean(delivery)} onClick={() => void runTest()}>{running ? <LoaderCircle className="animate-spin" /> : sendReal ? <Mail /> : <FlaskConical />}{running ? "Testing…" : sendReal ? "Start real email test" : "Run preview"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
