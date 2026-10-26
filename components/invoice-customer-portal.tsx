"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { shipmentLabels, shipmentStatuses, type PortalMessage, type PortalShipment } from "@/lib/customer-portal";

const blankShipment: PortalShipment = { status: "preparing", location: "", carrier: "", tracking_number: "", tracking_url: "", expected_delivery: "" };
export function InvoiceCustomerPortal({ id, canWrite, portalUrl, companyId, embedded = false, onUpdated }: { id: string; canWrite: boolean; portalUrl?: string; companyId?: string; embedded?: boolean; onUpdated?: () => void }) {
  const [messages, setMessages] = useState<PortalMessage[]>([]);
  const [shipment, setShipment] = useState<PortalShipment>(blankShipment);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pendingReply = useRef<{ id: string; body: string } | null>(null);
  const endpoint = `/api/invoices/${id}/portal${companyId ? `?companyId=${companyId}` : ""}`;
  const load = useCallback(async (signal?: AbortSignal, loadShipment = false) => {
    const response = await fetch(endpoint, { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load customer conversation.");
    setMessages(result.messages);
    if (loadShipment) setShipment(result.shipment ?? blankShipment);
  }, [endpoint]);
  useEffect(() => {
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => { void load(controller.signal, true).catch(err => { if (!controller.signal.aborted) setError(err.message); }); }, 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(controller.signal).catch(err => { if (!controller.signal.aborted) setError(err.message); }); }, 15000);
    return () => { controller.abort(); window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, [load]);
  async function save(input: unknown, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save customer update.");
      setNotice(success); await load(); onUpdated?.(); return true;
    } catch (err) { setError((err as Error).message); return false; }
    finally { setBusy(false); }
  }
  async function reply(event: FormEvent) {
    event.preventDefault();
    if (pendingReply.current?.body !== body.trim()) pendingReply.current = { id: crypto.randomUUID(), body: body.trim() };
    if (await save({ action: "reply", ...pendingReply.current }, "Reply sent to the customer portal.")) { pendingReply.current = null; setBody(""); }
  }
  return <section className="invoice-customer-tools space-y-5 rounded-xl border p-5">
    {!embedded && <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-semibold">Customer portal</h2><p className="mt-1 text-sm text-muted-foreground">Customers scan the invoice QR to view payment status, track delivery and chat here.</p></div>{portalUrl && <a href={portalUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Open customer view</a>}</div>}
    {!portalUrl && <p className="text-sm text-amber-700">Add a customer billing email before issuing an invoice to enable QR access.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <Tabs defaultValue="conversation" className="gap-5"><TabsList variant="line"><TabsTrigger value="conversation"><MessageCircle />Conversation</TabsTrigger><TabsTrigger value="delivery"><Truck />Delivery tracking</TabsTrigger></TabsList>
      <TabsContent value="conversation" keepMounted><div role="log" aria-label="Customer portal messages" aria-live="polite" className="max-h-96 space-y-3 overflow-y-auto">{messages.length ? messages.map(message => <article key={message.id} className={`max-w-[90%] rounded-lg p-3 text-sm ${message.sender === "staff" ? "ml-auto bg-primary/10" : "bg-muted"}`}><p className="mb-1 text-xs font-semibold">{message.sender === "staff" ? "Your team" : "Customer"}</p><p data-no-translate className="whitespace-pre-wrap break-words">{message.body}</p><time className="mt-1 block text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time></article>) : <p className="py-5 text-sm text-muted-foreground">Customer messages will appear here. Refreshes every 15 seconds.</p>}</div>{canWrite && <form onSubmit={reply} className="mt-4 space-y-2"><label htmlFor={`staff-portal-reply-${id}`} className="sr-only">Reply to customer</label><Textarea id={`staff-portal-reply-${id}`} value={body} onChange={e => setBody(e.target.value)} required maxLength={4000} placeholder="Reply to the customer…" /><Button type="submit" disabled={busy || !body.trim()}><Send />Send reply</Button></form>}</TabsContent>
      <TabsContent value="delivery" keepMounted><form onSubmit={event => { event.preventDefault(); const { updated_at: _updated, ...input } = shipment; void _updated; void save({ action: "shipment", shipment: input }, "Tracking details updated in the customer portal."); }} className="space-y-4"><fieldset disabled={!canWrite || busy} className="grid gap-4 sm:grid-cols-2"><label className="block text-sm sm:col-span-2">Shipment status<select value={shipment.status} onChange={e => setShipment({ ...shipment, status: e.target.value as PortalShipment["status"] })} className="mt-1 h-9 w-full rounded-md border bg-background px-3">{shipmentStatuses.map(status => <option key={status} value={status}>{shipmentLabels[status]}</option>)}</select></label>{([["location", "Latest location"], ["carrier", "Carrier"], ["tracking_number", "Tracking number"], ["tracking_url", "Carrier tracking URL"], ["expected_delivery", "Estimated delivery"]] as const).map(([field, label]) => <label key={field} className={`block text-sm ${field === "tracking_url" ? "sm:col-span-2" : ""}`}>{label}<Input type={field === "expected_delivery" ? "date" : field === "tracking_url" ? "url" : "text"} value={shipment[field]} onChange={e => setShipment({ ...shipment, [field]: e.target.value })} className="mt-1" maxLength={field === "location" || field === "tracking_number" ? 200 : field === "carrier" ? 100 : 2000} placeholder={field === "tracking_url" ? "https://…" : undefined} /></label>)}{canWrite && <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save tracking update</Button></div>}</fieldset></form></TabsContent>
    </Tabs>
  </section>;
}
