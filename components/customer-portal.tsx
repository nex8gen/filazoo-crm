"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Download, LockKeyhole, LogOut, MessageCircle, Package, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { InvoicePaper } from "@/components/invoice-paper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney, invoiceLabel, invoiceStatus } from "@/lib/invoices";
import { shipmentLabels, type PortalData } from "@/lib/customer-portal";
import "@/app/invoices/invoices.css";
import "@/app/customer/customer.css";

async function requestPortal(url: string, method = "GET", input?: unknown) {
  const response = await fetch(url, { method, cache: "no-store", headers: input ? { "Content-Type": "application/json" } : undefined, body: input ? JSON.stringify(input) : undefined });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || "Unable to load the customer portal."), { status: response.status });
  return body;
}

export function CustomerPortal({ invoiceId }: { invoiceId: string }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [email, setEmail] = useState("");
  const [login, setLogin] = useState(false);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const started = useRef(false);
  const pendingMessage = useRef<{ id: string; body: string } | null>(null);
  const endpoint = `/api/customer/invoices/${invoiceId}`;
  const hasSession = Boolean(data);
  const refresh = useCallback(async () => {
    try {
      const next: PortalData = await requestPortal(endpoint);
      setData(next); setEmail(next.email); setLogin(false);
      return next;
    } catch (err) {
      if ((err as { status?: number }).status === 401 || (err as { status?: number }).status === 403) { setData(null); setLogin(true); }
      throw err;
    }
  }, [endpoint]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
        // Do not leave a bearer credential in browser history after exchange.
        if (key) {
          window.history.replaceState(null, "", window.location.pathname);
          const result = await requestPortal("/api/customer/session", "POST", { invoiceId, key });
          setEmail(result.email);
          if (result.requiresLogin) { setLogin(true); return; }
        }
        const next = await refresh();
        setSetup(next.needsPassword);
      } catch (err) { setError((err as Error).message); }
      finally { setLoading(false); }
    })();
  }, [invoiceId, refresh]);
  useEffect(() => {
    if (!hasSession) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh().catch(err => setError(err.message)); }, 15000);
    return () => window.clearInterval(timer);
  }, [hasSession, refresh]);
  async function secure(event: FormEvent) {
    event.preventDefault();
    if (!login && password !== confirmation) { setError("Your passwords do not match."); return; }
    setBusy(true); setError("");
    try {
      await requestPortal("/api/customer/session", "PATCH", { action: login ? "login" : "set-password", password });
      setPassword(""); setConfirmation(""); setSetup(false);
      await refresh(); setNotice("You are signed in securely.");
    } catch (err) {
      setError((err as Error).message);
      if ((err as { status?: number }).status === 409) { setData(null); setSetup(false); setLogin(true); }
    }
    finally { setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true); setError("");
    if (pendingMessage.current?.body !== message.trim()) pendingMessage.current = { id: crypto.randomUUID(), body: message.trim() };
    try {
      await requestPortal(`${endpoint}/messages`, "POST", pendingMessage.current);
      pendingMessage.current = null; setMessage(""); await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  const securityForm = <form onSubmit={secure} className="space-y-4">
    <label className="block text-sm">Your email<Input value={email} readOnly autoComplete="username" className="mt-1" /></label>
    <label className="block text-sm">{login ? "Password" : "Create a password"}<Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={login ? 1 : 12} maxLength={72} autoComplete={login ? "current-password" : "new-password"} className="mt-1" /></label>
    {!login && <><p className="text-xs text-muted-foreground">Use 12–72 characters with uppercase, lowercase, a number, and a symbol.</p><label className="block text-sm">Confirm password<Input type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="new-password" className="mt-1" /></label></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full"><LockKeyhole />{busy ? "Please wait…" : login ? "Sign in" : "Secure my account"}</Button>
    <p className="text-xs text-muted-foreground">{login ? "Forgot your password? Contact your sales representative for help." : "This QR code grants access to this invoice. Keep it private. After setting a password, future scans require sign-in."}</p>
  </form>;
  if (loading) return <main className="customer-portal flex min-h-svh items-center justify-center"><p role="status">Opening your customer portal…</p></main>;
  if (!data) return <main className="customer-portal flex min-h-svh items-center justify-center p-5"><section className="w-full max-w-sm space-y-5 rounded-2xl border bg-card p-7 shadow-sm"><ShieldCheck className="size-8 text-primary" /><h1 className="text-2xl font-semibold">Customer portal</h1><p className="text-sm text-muted-foreground">{login && email ? "Welcome back. Sign in to view your invoice and order." : "Scan the QR code on your invoice to open your private customer portal."}</p>{login && email ? securityForm : error && <p role="alert" className="text-sm text-destructive">{error}</p>}</section></main>;
  const invoice = data.invoice;
  const today = new Date().toISOString().slice(0, 10);
  const status = invoiceStatus(invoice, today);
  const balance = invoice.status === "void" ? 0 : Math.max(0, invoice.total_minor - invoice.paid_minor);
  const shipment = data.shipment;
  const steps = ["confirmed", "in_production", "shipped", "completed"];
  const activeStep = steps.indexOf(data.order?.status ?? "");
  return <main className="customer-portal min-h-svh bg-muted/30">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5"><div className="flex items-center gap-4"><BrandMark className="h-7 w-28" viewBox="20 18 284 62" /><span className="border-l pl-4 text-sm text-muted-foreground">Customer portal</span></div><div className="flex items-center gap-2"><span className="hidden text-xs text-muted-foreground sm:inline">{data.email}</span><LanguageSwitcher /><Button variant="ghost" size="sm" disabled={busy} onClick={() => { void requestPortal("/api/customer/session", "DELETE").then(() => { setData(null); setEmail(""); setLogin(false); setError(""); }).catch(err => setError(err.message)); }}><LogOut />Sign out</Button></div></div></header>
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Welcome, {invoice.document.customerName}</p><h1 className="mt-1 text-3xl font-semibold">Your invoice & order</h1><p className="mt-2 text-sm text-muted-foreground">{invoiceLabel(invoice)} · {invoice.document.reference || "Your customer workspace"}</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void refresh().then(() => setError("")).catch(err => setError(err.message))}><RefreshCw />Refresh</Button><a className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium" href={`${endpoint}/pdf`}><Download className="size-4" />Download invoice</a></div></div>
      {error && !setup && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      {data.needsPassword && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><span className="text-sm">Protect your customer account with a password.</span><Button onClick={() => { setError(""); setSetup(true); }}><ShieldCheck />Set password</Button></div>}
      <div className="grid gap-4 sm:grid-cols-3">{[["Payment status", status === "issued" ? "Unpaid" : status.replaceAll("_", " ")], ["Payments received", formatMoney(invoice.paid_minor, invoice.document.currency)], ["Amount due", formatMoney(balance, invoice.document.currency)]].map(([label, value]) => <section key={label} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className={`mt-2 text-2xl font-semibold capitalize ${label === "Payment status" && status === "paid" ? "text-emerald-600" : ""}`}>{value}</p></section>)}</div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Package className="size-5" />Order tracking</h2>
          {data.order ? <><p className="text-sm">Order {data.order.reference}</p>{data.order.status === "cancelled" ? <p className="font-medium">Order cancelled</p> : <ol className="grid grid-cols-4 gap-2">{steps.map((step, index) => <li key={step} className={`border-t-4 pt-3 text-xs ${index <= activeStep ? "border-primary font-medium" : "border-muted text-muted-foreground"}`}>{step === "in_production" ? "In production" : step[0].toUpperCase() + step.slice(1)}</li>)}</ol>}</> : <p className="text-sm text-muted-foreground">Your sales team will share order updates here.</p>}
          {shipment ? <div className="space-y-2 rounded-lg bg-muted/40 p-4 text-sm"><p className="font-semibold">{shipmentLabels[shipment.status]}</p>{shipment.location && <p>Latest location: {shipment.location}</p>}{shipment.carrier && <p>Carrier: {shipment.carrier}</p>}{shipment.tracking_number && <p className="break-all">Tracking number: {shipment.tracking_number}</p>}{(shipment.expected_delivery || data.order?.deliveryDate) && <p>Estimated delivery: {shipment.expected_delivery || data.order?.deliveryDate}</p>}{shipment.tracking_url && <a className="inline-block font-medium text-primary underline" href={shipment.tracking_url} target="_blank" rel="noopener noreferrer">Track with carrier</a>}{shipment.updated_at && <p className="text-xs text-muted-foreground">Updated {new Date(shipment.updated_at).toLocaleString()}</p>}</div> : <p className="text-sm text-muted-foreground">Shipping details will appear when your team adds them.{data.order?.deliveryDate ? ` Estimated delivery: ${data.order.deliveryDate}.` : ""}</p>}
        </section>
        <section className="rounded-xl border bg-card p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><MessageCircle className="size-5" />Chat with our team</h2><p className="mt-1 text-xs text-muted-foreground">Messages and order updates refresh every 15 seconds.</p><div role="log" aria-label="Customer conversation" aria-live="polite" className="my-4 max-h-80 space-y-3 overflow-y-auto">{data.messages.length ? data.messages.map(item => <article key={item.id} className={`max-w-[90%] rounded-xl p-3 text-sm ${item.sender === "customer" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}><p className="mb-1 text-xs font-semibold">{item.sender === "customer" ? "You" : "Sales team"}</p><p className="whitespace-pre-wrap break-words">{item.body}</p><time className="mt-2 block text-[10px] opacity-70">{new Date(item.created_at).toLocaleString()}</time></article>) : <p className="py-5 text-sm text-muted-foreground">Have a question about payment or delivery? Send us a message.</p>}</div><form onSubmit={send} className="space-y-2"><label className="sr-only" htmlFor="customer-message">Message our team</label><Textarea id="customer-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} required placeholder="Write your message…" /><Button type="submit" disabled={busy || !message.trim()}><Send />{busy ? "Sending…" : "Send message"}</Button></form></section>
      </div>
      <section aria-label="Your invoice" className="customer-invoice-preview"><InvoicePaper invoice={invoice} today={today} customerView /></section>
      <p className="pb-4 text-center text-xs text-muted-foreground">Your private customer portal · Invoice, payment updates, order tracking, and support</p>
    </div>
    <Dialog open={setup} onOpenChange={setSetup}><DialogContent><DialogHeader><DialogTitle>Secure your customer account</DialogTitle><DialogDescription>Your invoice email is already connected. Add a password to protect future visits.</DialogDescription></DialogHeader>{securityForm}<Button variant="ghost" disabled={busy} onClick={() => setSetup(false)}>Remind me later</Button></DialogContent></Dialog>
  </main>;
}
