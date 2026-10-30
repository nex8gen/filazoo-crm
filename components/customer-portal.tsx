"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDownToLine, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleCheck, CreditCard, Download, FileText, Headphones, LoaderCircle, LockKeyhole, LogOut, MapPin, MessageCircle, Package, RefreshCw, Send, ShieldCheck, Truck } from "lucide-react";
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

const orderSteps = [
  { value: "confirmed", label: "Confirmed", icon: Check },
  { value: "in_production", label: "In production", icon: Package },
  { value: "shipped", label: "Shipped", icon: Truck },
  { value: "completed", label: "Completed", icon: CircleCheck },
];

function portalDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

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
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const started = useRef(false);
  const conversation = useRef<HTMLDivElement>(null);
  const followConversation = useRef(true);
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
        await refresh();
      } catch (err) { setError((err as Error).message); }
      finally { setLoading(false); }
    })();
  }, [invoiceId, refresh]);
  useEffect(() => {
    if (!hasSession) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh().catch(err => setError(err.message)); }, 15000);
    return () => window.clearInterval(timer);
  }, [hasSession, refresh]);
  const messageCount = data?.messages.length ?? 0;
  useEffect(() => {
    if (conversation.current && followConversation.current) conversation.current.scrollTop = conversation.current.scrollHeight;
  }, [messageCount, hasSession]);
  async function manualRefresh() {
    setRefreshing(true); setError("");
    try { await refresh(); setNotice("Everything is up to date."); }
    catch (err) { setError((err as Error).message); }
    finally { setRefreshing(false); }
  }
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
    if (!message.trim() || sending) return;
    setSending(true); setMessageError("");
    if (pendingMessage.current?.body !== message.trim()) pendingMessage.current = { id: crypto.randomUUID(), body: message.trim() };
    try {
      await requestPortal(`${endpoint}/messages`, "POST", pendingMessage.current);
      pendingMessage.current = null; setMessage(""); followConversation.current = true; await refresh();
    } catch (err) { setMessageError((err as Error).message); }
    finally { setSending(false); }
  }
  const securityForm = <form onSubmit={secure} className="space-y-4">
    <label className="block text-sm">Your email<Input value={email} readOnly autoComplete="username" className="mt-1" /></label>
    <label className="block text-sm">{login ? "Password" : "Create a password"}<Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={login ? 1 : 12} maxLength={72} autoComplete={login ? "current-password" : "new-password"} className="mt-1" /></label>
    {!login && <><p className="text-xs text-muted-foreground">Use 12–72 characters with uppercase, lowercase, a number, and a symbol.</p><label className="block text-sm">Confirm password<Input type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required autoComplete="new-password" className="mt-1" /></label></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full"><LockKeyhole />{busy ? "Please wait…" : login ? "Sign in" : "Secure my account"}</Button>
    <p className="text-xs text-muted-foreground">{login ? "Forgot your password? Contact your sales representative for help." : "This QR code grants access to this invoice. Keep it private. After setting a password, future scans require sign-in."}</p>
  </form>;
  if (loading) return <main className="customer-portal portal-entry"><div className="portal-entry-card"><BrandMark viewBox="20 18 284 62" style={{ width: 128, height: 28 }} /><LoaderCircle className="portal-spinner" /><p role="status">Opening your customer portal…</p></div></main>;
  if (!data) return <main className="customer-portal portal-entry"><section className="portal-entry-card"><BrandMark viewBox="20 18 284 62" style={{ width: 128, height: 28 }} /><span className="portal-section-icon"><ShieldCheck /></span><div><p className="portal-eyebrow">YOUR PRIVATE WORKSPACE</p><h1>Customer portal</h1></div><p className="portal-muted">{login && email ? "Welcome back. Sign in to view your invoice and order." : "Scan the QR code on your invoice to open your private customer portal."}</p>{login && email ? securityForm : error && <p role="alert" className="text-sm text-destructive">{error}</p>}<p className="portal-entry-footer"><LockKeyhole />Private access. Connected to your invoice.</p></section></main>;
  const invoice = data.invoice;
  const today = new Date().toISOString().slice(0, 10);
  const status = invoiceStatus(invoice, today);
  const balance = invoice.status === "void" ? 0 : Math.max(0, invoice.total_minor - invoice.paid_minor);
  const shipment = data.shipment;
  const activeStep = orderSteps.findIndex(step => step.value === data.order?.status);
  const deliveryDate = shipment?.expected_delivery || data.order?.deliveryDate;
  const paid = status === "paid";
  return <main className="customer-portal">
    <a className="portal-skip-link" href="#portal-content">Skip to your order</a>
    <header className="portal-header"><div className="portal-container portal-header-inner">
      <div className="portal-brand"><BrandMark viewBox="20 18 284 62" style={{ width: 118, height: 26 }} role="img" aria-label="Filazoo" aria-hidden={false} /><span>Customer portal</span></div>
      <div className="portal-account"><span className="portal-email" title={data.email} data-no-translate>{data.email}</span><LanguageSwitcher /><Button variant="ghost" className="portal-signout" disabled={busy || sending} onClick={() => { setBusy(true); void requestPortal("/api/customer/session", "DELETE").then(() => { setData(null); setEmail(""); setLogin(false); setError(""); setNotice(""); setSetup(false); }).catch(err => setError(err.message)).finally(() => setBusy(false)); }}><LogOut /><span>Sign out</span></Button></div>
    </div></header>
    <div className="portal-container portal-content" id="portal-content" tabIndex={-1}>
      <div className="portal-intro">
        <div><p className="portal-eyebrow">YOUR CUSTOMER WORKSPACE</p><h1>Your order, at a glance.</h1><p className="portal-welcome">Welcome, <span data-no-translate>{invoice.document.customerName}</span>. Everything you need, all in one place.</p></div>
        <a className="portal-download" href={`${endpoint}/pdf`}><Download /><span>Download invoice</span><ArrowUpRight /></a>
      </div>
      <div className="portal-context"><div className="portal-reference"><FileText /><span data-no-translate>{invoiceLabel(invoice)}</span>{invoice.document.reference && <><ChevronRight /><span data-no-translate>{invoice.document.reference}</span></>}</div><Button variant="ghost" className="portal-refresh" disabled={refreshing} onClick={() => void manualRefresh()}><RefreshCw className={refreshing ? "portal-spinner" : ""} /><span>{refreshing ? "Refreshing…" : "Refresh"}</span></Button></div>
      {error && !setup && <p role="alert" className="portal-alert">{error}</p>}
      {notice && <p role="status" className="portal-notice"><CircleCheck />{notice}</p>}
      <section className="portal-summary" aria-label="Payment overview">
        <div className="portal-stat portal-stat-status"><span className={`portal-stat-icon ${paid ? "is-paid" : ""}`}>{paid ? <CheckCheck /> : <CreditCard />}</span><div><p>Payment status</p><strong className={`portal-status ${paid ? "is-paid" : ""}`}>{status === "issued" ? "Unpaid" : status === "partial" ? "Partially paid" : status === "void" ? "Voided" : status}</strong><span className="portal-stat-note">{paid ? "Thank you for your payment" : status === "void" ? "This invoice has been voided" : "See your invoice for payment details"}</span></div></div>
        <div className="portal-stat"><p>Payments received</p><strong data-no-translate>{formatMoney(invoice.paid_minor, invoice.document.currency)}</strong><span className="portal-stat-note">of {formatMoney(invoice.total_minor, invoice.document.currency)} total</span></div>
        <div className="portal-stat"><p>Amount due <span className="portal-currency" data-no-translate>{invoice.document.currency}</span></p><strong data-no-translate>{formatMoney(balance, invoice.document.currency)}</strong><span className="portal-stat-note">{paid ? "You're all settled" : status === "void" ? "No payment required" : `Due ${portalDate(invoice.document.dueDate)}`}</span></div>
      </section>
      {data.needsPassword && <aside className="portal-security"><ShieldCheck /><div><strong>A little extra peace of mind</strong><p>Add a password to keep your invoice and conversations protected.</p></div><Button variant="outline" disabled={busy || sending} onClick={() => { setError(""); setSetup(true); }}>Set password<ChevronRight /></Button></aside>}
      <nav className="portal-section-nav" aria-label="Your workspace"><a href="#order-tracking"><Package />Order tracking</a><a href="#your-invoice"><FileText />Your invoice</a><a href="#customer-support"><MessageCircle />Messages{data.messages.length > 0 && <span>{data.messages.length}</span>}</a><p><span className="portal-live-dot" />Updates automatically</p></nav>
      <div className="portal-workspace">
        <section id="order-tracking" className="portal-card portal-tracking" aria-labelledby="tracking-title">
          <div className="portal-card-heading"><div className="portal-heading-group"><span className="portal-section-icon"><Package /></span><div><h2 id="tracking-title">Order tracking</h2><p>{data.order ? <>Order <span data-no-translate>{data.order.reference}</span></> : "Follow your order from start to finish"}</p></div></div>{data.order?.status === "cancelled" && <span className="portal-tag">Cancelled</span>}</div>
          {data.order && data.order.status !== "cancelled" && <ol className="portal-timeline" aria-label="Order progress">{orderSteps.map((step, index) => <li key={step.value} data-complete={index <= activeStep} aria-current={index === activeStep ? "step" : undefined}><span className="portal-step-icon">{index < activeStep ? <Check /> : <step.icon />}</span><span>{step.label}</span>{index === activeStep && <small>Current stage</small>}</li>)}</ol>}
          {!data.order && !shipment && <div className="portal-empty"><span className="portal-empty-icon"><Package /></span><h3>Your order updates will appear here</h3><p>We’re keeping everything in one place. Your sales team will share progress as soon as it’s available.</p></div>}
          {shipment ? <div className="portal-shipment"><div className="portal-shipment-status"><Truck /><strong>{shipmentLabels[shipment.status]}</strong></div><dl>{shipment.location && <div><dt>Latest location</dt><dd><MapPin /><span data-no-translate>{shipment.location}</span></dd></div>}{shipment.carrier && <div><dt>Carrier</dt><dd data-no-translate>{shipment.carrier}</dd></div>}{shipment.tracking_number && <div><dt>Tracking number</dt><dd data-no-translate>{shipment.tracking_number}</dd></div>}{deliveryDate && <div><dt>Estimated delivery</dt><dd>{portalDate(deliveryDate)}</dd></div>}</dl>{shipment.tracking_url && <a className="portal-carrier-link" href={shipment.tracking_url} target="_blank" rel="noopener noreferrer">Track with carrier<ArrowUpRight /></a>}{shipment.updated_at && <p className="portal-updated">Updated {new Date(shipment.updated_at).toLocaleString()}</p>}</div> : <div className="portal-tracking-footnote"><Truck /><p>{data.order?.status === "cancelled" ? "Contact our team if you have questions about this order." : "Shipping details will be added when available."}{deliveryDate && <> Estimated delivery: {portalDate(deliveryDate)}.</>}</p></div>}
        </section>
        <section id="customer-support" className="portal-card portal-support" aria-labelledby="support-title">
          <div className="portal-card-heading"><div className="portal-heading-group"><span className="portal-section-icon"><Headphones /></span><div><h2 id="support-title">Here to help</h2><p>A direct line to your sales team</p></div></div><span className="portal-tag"><MessageCircle />Support</span></div>
          <div ref={conversation} onScroll={() => { const log = conversation.current; if (log) followConversation.current = log.scrollHeight - log.scrollTop - log.clientHeight < 64; }} role="log" aria-label="Customer conversation" aria-live="polite" tabIndex={0} className="portal-conversation">
            {data.messages.length ? data.messages.map(item => <article key={item.id} className={`portal-message ${item.sender === "customer" ? "portal-message-own" : ""}`}><p className="portal-message-sender">{item.sender === "customer" ? "You" : "Sales team"}</p><p className="portal-message-body" data-no-translate>{item.body}</p><time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString()}>{new Date(item.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></article>) : <div className="portal-empty"><span className="portal-empty-icon"><MessageCircle /></span><h3>Let’s talk about your order</h3><p>Questions about your invoice or delivery? Leave a message and your team will get back to you here.</p></div>}
          </div>
          <form onSubmit={send} className="portal-composer" aria-busy={sending}><label className="sr-only" htmlFor="customer-message">Message our team</label><Textarea id="customer-message" disabled={sending} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} required placeholder="How can we help?" />{messageError && <p role="alert" className="portal-message-error">{messageError}</p>}<div className="portal-composer-actions"><p><LockKeyhole />Private conversation</p><Button type="submit" disabled={busy || sending || !message.trim()}>{sending ? <LoaderCircle className="portal-spinner" /> : <Send />}{sending ? "Sending…" : "Send message"}</Button></div></form>
          <p className="portal-support-note">Messages and order updates refresh every 15 seconds.</p>
        </section>
        <section id="your-invoice" className="portal-card portal-invoice" aria-labelledby="invoice-title"><div className="portal-card-heading"><div className="portal-heading-group"><span className="portal-section-icon"><FileText /></span><div><h2 id="invoice-title">Your invoice</h2><p>All the details, whenever you need them</p></div></div><a className="portal-invoice-download" href={`${endpoint}/pdf`} aria-label="Download invoice PDF"><ArrowDownToLine /><span>PDF</span></a></div><div className="customer-invoice-preview"><InvoicePaper invoice={invoice} today={today} customerView /></div></section>
      </div>
      <footer className="portal-footer"><span><LockKeyhole />Your private customer portal</span><p>Invoice, order updates, and a team that has your back.</p></footer>
    </div>
    <Dialog open={setup} onOpenChange={setSetup}><DialogContent className="portal-security-dialog"><DialogHeader><DialogTitle>Secure your customer account</DialogTitle><DialogDescription>Your invoice email is already connected. Add a password to protect future visits.</DialogDescription></DialogHeader>{securityForm}<Button variant="ghost" disabled={busy} onClick={() => setSetup(false)}>Remind me later</Button></DialogContent></Dialog>
  </main>;
}
