"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, LoaderCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { shippingMinorFromInput, type AutoReplyState } from "@/lib/email-auto-reply";
import { formatMoney as formatInvoiceMoney, type InvoiceDocument } from "@/lib/invoices";
import { requestAutoReply } from "@/lib/email-auto-reply-client";

type Fact = { id: string; title: string; content: string };

function BusinessFacts({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/email/auto-reply/knowledge", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load business facts.");
        setFacts(result.facts); setCanManage(result.canManage); setError("");
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/email/auto-reply/knowledge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setFacts((current) => [...current, result.fact]); setTitle(""); setContent("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/email/auto-reply/knowledge?id=${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setFacts((current) => current.filter((fact) => fact.id !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to delete."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger aria-label="Business facts & policies" title="Business facts & policies" className={compact ? "rounded p-1.5 text-muted-foreground hover:bg-muted" : "inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4"}><BookOpen className="size-3.5" />{compact ? null : "Business facts & policies"}</DialogTrigger>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>Approved business facts & policies</DialogTitle><DialogDescription>AI uses these shared records and current database products to answer customer questions. Add only information approved for customers.</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {!facts.length ? <p className="text-sm text-muted-foreground">No policies saved yet. Questions without supporting facts will go to a person for review.</p> : facts.map((fact) => <article key={fact.id} className="space-y-2 rounded-lg border p-3"><p className="text-sm font-semibold">{fact.title}</p><p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{fact.content}</p>{canManage ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(fact.id)}>Remove</Button> : null}</article>)}
      {canManage ? <form onSubmit={save} className="space-y-3 border-t pt-4">
        <label className="grid gap-1.5 text-sm">Title<input required maxLength={200} className="rounded-md border bg-background px-3 py-2" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Returns, warranty, samples…" /></label>
        <label className="grid gap-1.5 text-sm">Approved information<textarea required maxLength={10000} rows={5} className="rounded-md border bg-background px-3 py-2" value={content} onChange={(event) => setContent(event.target.value)} /></label>
        <Button size="sm" disabled={busy}>{busy ? "Saving…" : "Save business fact"}</Button>
      </form> : <p className="text-xs text-muted-foreground">An admin or operator can add or remove shared policies.</p>}
    </DialogContent>
  </Dialog>;
}

const statusLabels: Record<AutoReplyState["status"], string> = {
  active: "On", paused: "Off", processing: "Replying…",
  waiting_shipping: "Shipping needed", ready: "Invoice queued", needs_review: "Needs review",
};

export function EmailAutoReplyControl({ automationId, mailboxId, senderId, messageId, references = [], onManualReply }: {
  automationId?: string; mailboxId?: string | null; senderId?: string; messageId?: string | null; references?: string[]; onManualReply?: () => void;
}) {
  const [automation, setAutomation] = useState<AutoReplyState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [shipping, setShipping] = useState("");
  const [manualReady, setManualReady] = useState(false);
  const actionPending = useRef(false);
  const readVersion = useRef(0);
  const query = automationId ? `id=${encodeURIComponent(automationId)}`
    : mailboxId && messageId ? new URLSearchParams({ mailboxId, messageId, references: JSON.stringify(references.slice(0, 100)) }).toString() : "";
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    let pending = false;
    async function refresh(initial = false) {
      if (pending || actionPending.current || (!initial && document.visibilityState === "hidden")) return;
      pending = true;
      const version = readVersion.current;
      try {
        const result = await requestAutoReply(`/api/email/auto-reply?${query}`, { signal: controller.signal });
        if (!controller.signal.aborted && version === readVersion.current) { setAutomation(result.automation); setLoaded(true); setLoadError(""); }
      } catch (cause) { if (!controller.signal.aborted && version === readVersion.current) setLoadError(cause instanceof Error ? cause.message : "Unable to load auto-reply."); }
      finally { pending = false; }
    }
    // Always perform the first read, including in an app's background webview.
    void refresh(true);
    const resume = () => { void refresh(); };
    const interval = setInterval(() => void refresh(), 10_000);
    window.addEventListener("focus", resume);
    window.addEventListener("email-auto-reply-updated", resume);
    document.addEventListener("visibilitychange", resume);
    return () => { controller.abort(); clearInterval(interval); window.removeEventListener("focus", resume); window.removeEventListener("email-auto-reply-updated", resume); document.removeEventListener("visibilitychange", resume); };
  }, [query, retry]);

  async function action(input: Record<string, unknown>) {
    if (actionPending.current) return;
    actionPending.current = true;
    readVersion.current += 1;
    setBusy(true); setError("");
    try {
      const result = await requestAutoReply("/api/email/auto-reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      setAutomation(result.automation);
      setLoaded(true); setLoadError("");
      window.dispatchEvent(new Event("flow-activity-updated"));
      if (input.action === "stop") { setManualReady(true); onManualReply?.(); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save automation."); }
    finally { actionPending.current = false; setBusy(false); }
  }
  const pendingDocument = automation?.pending_document as InvoiceDocument | null;
  const conversationLink = automation ? `/email?${new URLSearchParams({ mailbox: automation.mailbox_id, thread: automation.thread_key })}` : "";
  return <section aria-label="Conversation AI auto-reply" className="mb-2 shrink-0 border-b pb-2">
    <div className="flex min-h-8 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2"><Bot className="size-3.5 shrink-0 text-violet-600" /><span className="text-xs font-medium">AI auto-reply</span></div>
      <div className="flex shrink-0 items-center gap-2">
        {!automationId ? <BusinessFacts compact /> : null}
        {busy || (!loaded && !loadError && query) ? <LoaderCircle aria-label="Loading auto-reply" className="size-3.5 animate-spin text-muted-foreground" /> : null}
        <button type="button" role="switch" aria-label="AI auto-reply for this conversation" aria-checked={Boolean(automation?.enabled)} title="Automatically reply to future messages in this conversation" disabled={busy || !loaded || !query || (!automation?.enabled && (!senderId || Boolean(automationId)))} onClick={() => void action(automation?.enabled ? { action: "stop", id: automation.id } : { action: "enable", mailboxId, senderId, messageId, revision: automation?.revision ?? 0 })} className="inline-flex items-center gap-2 text-xs text-muted-foreground disabled:opacity-50"><span>{automation?.enabled ? "On" : "Off"}</span><span className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${automation?.enabled ? "bg-emerald-600" : "bg-muted-foreground/30"}`}><span className={`size-4 rounded-full bg-white shadow-sm transition-transform ${automation?.enabled ? "translate-x-4" : ""}`} /></span></button>
      </div>
    </div>
    {automation?.enabled && automation.status !== "active" ? <p className="mt-1 text-xs text-muted-foreground" role="status">{statusLabels[automation.status]}{!automationId && automation.task_id ? <> · <Link href="/tasks" className="text-primary underline">Review task</Link></> : null}</p> : null}
    {automationId && automation?.last_error ? <p className="mt-2 whitespace-pre-wrap break-words text-xs text-amber-800 dark:text-amber-300">{automation.last_error}</p> : null}
    {automationId && automation?.status === "waiting_shipping" && pendingDocument ? <form className="mt-3 space-y-3 rounded-lg border bg-background p-3" onSubmit={(event) => { event.preventDefault(); try { void action({ action: "shipping", id: automation.id, revision: automation.revision, shippingMinor: shippingMinorFromInput(shipping) }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a valid cost."); } }}>
      <div className="text-xs"><p className="font-semibold">{pendingDocument.customerName} · {pendingDocument.currency}</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{pendingDocument.shippingAddress}</p><ul className="mt-2 space-y-1">{pendingDocument.items.map((item, index) => <li key={index}>{item.description} × {item.quantity} · {formatInvoiceMoney(item.unitPriceMinor * item.quantity, pendingDocument.currency)}</li>)}</ul></div>
      <label className="grid max-w-52 gap-1 text-xs font-medium">Confirmed shipping cost ({pendingDocument.currency})<input required inputMode="decimal" placeholder="0.00" value={shipping} onChange={(event) => setShipping(event.target.value)} className="rounded-md border bg-background px-3 py-2 text-sm" /></label>
      <p className="text-xs text-muted-foreground">Confirming creates the invoice with this shipping cost and emails its PDF to {automation.recipient}. Enter 0 only for approved free shipping.</p>
      <Button size="sm" disabled={busy}>{busy ? "Saving…" : "Add shipping and send invoice"}</Button>
    </form> : null}
    {automationId && conversationLink ? <Link href={conversationLink} className="mt-2 inline-block text-xs text-primary underline">{manualReady ? "Open conversation to reply manually" : "Open conversation"}</Link> : null}
    {automation?.invoice_id ? <Link href={`/invoices/${automation.invoice_id}`} className="mt-2 inline-block text-xs text-primary underline">View invoice</Link> : null}
    {loadError ? <div className="mt-1 flex items-center gap-2 text-xs text-destructive" role="alert"><span>Unable to load.</span><button type="button" className="font-medium underline" onClick={() => { setLoadError(""); setRetry((value) => value + 1); }}>Retry</button></div> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}
  </section>;
}
