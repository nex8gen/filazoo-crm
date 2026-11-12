"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Loader2, Package2, UploadCloud } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { DocumentRecordLinks } from "@/components/document-record-links";
import { documentCategories, type DocumentCategory } from "@/lib/documents";
import { emptyDocumentConnections, documentConnectionError } from "@/lib/document-connections";

export function DocumentAddDialog({ category, onClose, onUpload, onCreated }: { category: DocumentCategory; onClose: () => void; onUpload: () => void; onCreated: () => void }) {
  const router = useRouter();
  const [create, setCreate] = useState(false);
  const [connections, setConnections] = useState(emptyDocumentConnections);
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quotation = category === "quotation";
  const orders = ["proforma", "invoice", "purchase_order", "payment"].includes(category);
  const title = documentCategories.find(item => item.id === category)?.label ?? "Files";
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="sm:max-w-[600px]"><DialogHeader><DialogTitle>{create ? "Create quotation from products" : `Add to ${title.toLowerCase()}`}</DialogTitle><DialogDescription>{create ? "Choose a customer and products. The saved quotation opens for quantities, shipping and payment terms." : "Create from your CRM records or upload an existing document."}</DialogDescription></DialogHeader>
    {create ? <form className="library-form" onSubmit={async event => { event.preventDefault(); const issue = documentConnectionError("quotation", connections); if (issue) { setError(issue); return; } setBusy(true); setError(""); try { const response = await fetch("/api/documents/quotation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId: connections.company_id, productSkus: connections.product_skus, currency }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); onCreated(); onClose(); router.push(body.href); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create quotation."); } finally { setBusy(false); } }}><DocumentRecordLinks category="quotation" value={connections} onChange={setConnections} disabled={busy} /><label>Currency<select value={currency} disabled={busy} onChange={event => setCurrency(event.target.value)}>{["USD", "EUR", "GBP", "CNY", "CAD", "AUD", "HKD"].map(value => <option key={value}>{value}</option>)}</select></label>{error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setCreate(false)}>Back</Button><Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <FileText />}Create quotation draft</Button></div></form> : <div className="library-add-options">
      {quotation ? <button type="button" onClick={() => setCreate(true)}><span><Package2 /></span><div><strong>Create from products</strong><p>Select products and a customer, then prepare a quotation.</p></div><ArrowRight /></button> : null}
      {orders ? <><Link href="/purchase-orders/new" onClick={onClose}><span><FileText /></span><div><strong>Create purchase order</strong><p>{category === "payment" ? "Create the order first, then record its payment." : "Saving the order creates its draft invoice automatically."}</p></div><ArrowRight /></Link><Link href="/purchase-orders" onClick={onClose}><span><Package2 /></span><div><strong>{category === "payment" ? "Record payment on an order" : "Use an existing purchase order"}</strong><p>{category === "invoice" ? "Open an order to review and issue its invoice." : category === "payment" ? "Choose an order and record the received payment there." : "Open an order to review products and its linked invoice."}</p></div><ArrowRight /></Link></> : null}
      <button type="button" onClick={onUpload}><span><UploadCloud /></span><div><strong>Upload from computer</strong><p>{quotation ? "Upload a quotation and link its customer and products." : orders ? "Upload a document and connect it to the correct order." : "Choose files and add their related products or customer."}</p></div><ArrowRight /></button>
      <div className="flex justify-end"><button type="button" className={buttonVariants({ size: "sm", variant: "outline" })} onClick={onClose}>Cancel</button></div>
    </div>}
  </DialogContent></Dialog>;
}
