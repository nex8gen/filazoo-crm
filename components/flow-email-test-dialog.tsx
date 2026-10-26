"use client";

import { useRef, useState } from "react";
import { FlaskConical, FileText, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { flowEmailTestSchema, type FlowEmailTestResult } from "@/lib/flow-email-test";
import type { FlowInput } from "@/lib/flows";

const examples = [
  { label: "Pricing inquiry", subject: "Black PLA pricing", body: "Hi, we run a print farm and need 100 rolls of black PLA, 1.75 mm, 1 kg. Can you share your pricing and product catalog?" },
  { label: "Catalog request", subject: "Product catalog for our store", body: "Hello, we are interested in selling your filament. Please send us your product catalog and let us know your minimum order quantities." },
] as const;
const blankEmail = () => ({ id: crypto.randomUUID(), from: "customer@example.com", subject: "", body: "" });

export function FlowEmailTestDialog({ flow, open, onOpenChange }: { flow: FlowInput; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [emails, setEmails] = useState<Array<ReturnType<typeof blankEmail>>>(() => [{ ...blankEmail(), subject: examples[0].subject, body: examples[0].body }]);
  const [customerName, setCustomerName] = useState("Alex");
  const [companyName, setCompanyName] = useState("Sample company");
  const [firstMessage, setFirstMessage] = useState(true);
  const [result, setResult] = useState<FlowEmailTestResult | null>(null);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const busy = useRef(false);

  function updateEmail(id: string, field: "from" | "subject" | "body", value: string) {
    setEmails((current) => current.map((email) => email.id === id ? { ...email, [field]: value } : email));
    setResult(null);
  }

  async function runTest() {
    if (busy.current) return;
    const parsed = flowEmailTestSchema.safeParse({ flow, customerName, companyName, firstMessage, emails });
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

  return <Dialog open={open} onOpenChange={(next) => { if (!running) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-4xl" showCloseButton={!running}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><FlaskConical className="size-4 text-violet-600" />Test flow with emails</DialogTitle>
        <DialogDescription>Try up to three sample incoming emails. Preview the journey, AI replies and catalog attachments. Nothing is sent or saved.</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs leading-5 text-violet-900 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-200">Waits are simulated immediately. Each email is a separate test lead assumed to match the trigger filters. Open, click and later-reply conditions start as false. AI previews use your current products, prices and flow settings.</div>
        <fieldset disabled={running} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium"><span>Customer name</span><Input value={customerName} maxLength={200} onChange={(event) => { setCustomerName(event.target.value); setResult(null); }} /></label>
            <label className="space-y-1.5 text-xs font-medium"><span>Company name</span><Input value={companyName} maxLength={300} onChange={(event) => { setCompanyName(event.target.value); setResult(null); }} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={firstMessage} onCheckedChange={(value) => { setFirstMessage(value === true); setResult(null); }} /><span>Test as the first automated message</span></label>
          {emails.map((email, index) => <section key={email.id} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Sample email {index + 1}</p><div className="flex flex-wrap gap-1">{examples.map((example) => <Button key={example.label} variant="ghost" size="sm" onClick={() => { setEmails((current) => current.map((item) => item.id === email.id ? { ...item, subject: example.subject, body: example.body } : item)); setResult(null); }}>{example.label}</Button>)}{emails.length > 1 ? <Button variant="ghost" size="icon-sm" aria-label={`Remove sample email ${index + 1}`} onClick={() => { setEmails((current) => current.filter((item) => item.id !== email.id)); setResult(null); }}><Trash2 className="size-4" /></Button> : null}</div></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs font-medium"><span>Sample sender email</span><Input type="email" value={email.from} maxLength={300} onChange={(event) => updateEmail(email.id, "from", event.target.value)} /></label><label className="space-y-1.5 text-xs font-medium"><span>Subject</span><Input value={email.subject} maxLength={300} onChange={(event) => updateEmail(email.id, "subject", event.target.value)} /></label></div>
            <label className="block space-y-1.5 text-xs font-medium"><span>Incoming email</span><Textarea value={email.body} maxLength={6000} className="min-h-28" placeholder="Paste a customer email here…" onChange={(event) => updateEmail(email.id, "body", event.target.value)} /></label>
          </section>)}
          <Button variant="outline" size="sm" disabled={running || emails.length >= 3} onClick={() => { setEmails((current) => [...current, blankEmail()]); setResult(null); }}><Plus />Add sample email</Button>
        </fieldset>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {running ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Testing flow and generating replies…</p> : null}
        {result ? <div aria-live="polite" className="space-y-4 border-t pt-4"><h3 className="text-sm font-semibold">Test results</h3>{result.cases.map((testCase, index) => <section key={index} className="space-y-3 rounded-xl border p-4">
          <p className="text-sm font-semibold" data-no-translate>{index + 1}. {testCase.subject}</p>
          <ol className="space-y-2">{testCase.trace.map((entry, traceIndex) => <li key={traceIndex} className="flex items-start gap-2 text-xs"><span className={`mt-1 size-2 shrink-0 rounded-full ${entry.status === "skipped" || entry.status === "stopped" ? "bg-amber-400" : "bg-emerald-500"}`} /><span><strong>Step {entry.step}</strong> · {entry.detail}</span></li>)}</ol>
          {testCase.replies.map((reply) => <div key={reply.step} className="space-y-3 rounded-lg bg-muted/40 p-4"><p className="text-xs font-semibold">AI reply preview · Step {reply.step}</p><p className="text-sm font-medium" data-no-translate>{reply.subject}</p><p className="whitespace-pre-wrap text-sm leading-6" data-no-translate>{reply.body}</p>{reply.attachments.map((attachment) => <div key={attachment.filename} className="flex items-center gap-2 rounded-lg border bg-background p-3 text-xs"><FileText className="size-4 text-violet-600" /><span data-no-translate>{attachment.filename} · {Math.ceil(attachment.size / 1024)} KB</span><span className="ml-auto text-muted-foreground">Would attach</span></div>)}</div>)}
          {testCase.error ? <p role="alert" className="text-sm text-destructive">{testCase.error}</p> : null}
        </section>)}</div> : null}
      </div>
      <DialogFooter><Button variant="outline" disabled={running} onClick={() => onOpenChange(false)}>Close</Button><Button disabled={running} onClick={() => void runTest()}>{running ? <LoaderCircle className="animate-spin" /> : <FlaskConical />}{running ? "Testing…" : "Run test"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
