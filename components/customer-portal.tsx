"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronRight, LoaderCircle, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { PortalExperience } from "@/components/portal-experience";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type PortalData } from "@/lib/customer-portal";
import "@/app/invoices/invoices.css";
import "@/app/customer/customer.css";

async function requestPortal(url: string, method = "GET", input?: unknown) {
  const response = await fetch(url, { method, cache: "no-store", headers: input ? { "Content-Type": "application/json" } : undefined, body: input ? JSON.stringify(input) : undefined });
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error || "Unable to load the customer portal."), { status: response.status });
  return body;
}

export function CustomerPortal({ invoiceId, page = "home" }: { invoiceId: string; page?: string }) {
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
    {error && <NotificationToast>{error}</NotificationToast>}
    <Button type="submit" disabled={busy} className="w-full"><LockKeyhole />{busy ? "Please wait…" : login ? "Sign in" : "Secure my account"}</Button>
    <p className="text-xs text-muted-foreground">{login ? "Forgot your password? Contact your sales representative for help." : "This QR code grants access to this invoice. Keep it private. After setting a password, future scans require sign-in."}</p>
  </form>;
  if (loading) return <main className="customer-portal portal-entry"><div className="portal-entry-card"><BrandMark viewBox="20 18 284 62" style={{ width: 128, height: 28 }} /><LoaderCircle className="portal-spinner" /><p role="status">Opening your customer portal…</p></div></main>;
  if (!data) return <main className="customer-portal portal-entry"><section className="portal-entry-card"><BrandMark viewBox="20 18 284 62" style={{ width: 128, height: 28 }} /><span className="portal-section-icon"><ShieldCheck /></span><div><p className="portal-eyebrow">YOUR PRIVATE WORKSPACE</p><h1>Customer portal</h1></div><p className="portal-muted">{login && email ? "Welcome back. Sign in to view your invoice and order." : "Scan the QR code on your invoice to open your private customer portal."}</p>{login && email ? securityForm : error && <NotificationToast>{error}</NotificationToast>}<p className="portal-entry-footer"><LockKeyhole />Private access. Connected to your invoice.</p></section></main>;
  return <>
    <PortalExperience data={data} invoiceId={invoiceId} page={page} busy={busy || sending} refreshing={refreshing} onRefresh={() => void manualRefresh()}
      onSignout={() => { setBusy(true); void requestPortal("/api/customer/session", "DELETE").then(() => { setData(null); setEmail(""); setLogin(false); setError(""); setNotice(""); setSetup(false); }).catch(err => setError(err.message)).finally(() => setBusy(false)); }}
      conversation={conversation} onConversationScroll={() => { const log = conversation.current; if (log) followConversation.current = log.scrollHeight - log.scrollTop - log.clientHeight < 64; }}
      notifications={<>{error && !setup && <NotificationToast>{error}</NotificationToast>}{notice && <p role="status" className="portal-notice">{notice}</p>}</>}
      security={data.needsPassword && <aside className="portal-security"><ShieldCheck /><div><strong>A little extra peace of mind</strong><p>Add a password to keep your invoice and conversations protected.</p></div><Button variant="outline" disabled={busy || sending} onClick={() => { setError(""); setSetup(true); }}>Set password<ChevronRight /></Button></aside>}
      composer={<form onSubmit={send} className="portal-composer" aria-busy={sending}><label className="sr-only" htmlFor="customer-message">Message our team</label><Textarea id="customer-message" disabled={sending} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} required placeholder="How can we help?" />{messageError && <NotificationToast>{messageError}</NotificationToast>}<div className="portal-composer-actions"><p><LockKeyhole />Private conversation</p><Button type="submit" disabled={busy || sending || !message.trim()}>{sending ? <LoaderCircle className="portal-spinner" /> : <Send />}{sending ? "Sending…" : "Send message"}</Button></div></form>}
    />
    <Dialog open={setup} onOpenChange={setSetup}><DialogContent><DialogHeader><DialogTitle>Secure your customer account</DialogTitle><DialogDescription>Create a password to protect your invoice and conversations.</DialogDescription></DialogHeader>{securityForm}</DialogContent></Dialog>
  </>;
}
