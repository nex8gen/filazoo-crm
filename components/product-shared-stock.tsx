"use client";

import { useState } from "react";
import { adjustProductStock, loadProductStock } from "@/app/product-stock-actions";
import { manualStockTotal } from "@/lib/shared-product-inventory";
import type { SharedManualStock, StockAdjustment } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function ProductSharedStock({ productSku, sku, stock, onChange, disabled: inputDisabled, persisted, onBusyChange }: {
  productSku: string; sku: string; stock: SharedManualStock; onChange: (stock: SharedManualStock) => void;
  disabled: boolean; persisted: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const disabled = inputDisabled || Boolean(stock.readOnly);
  const [location, setLocation] = useState(stock.locations[0]?.location ?? "Main location");
  const [quantity, setQuantity] = useState(stock.locations[0]?.quantity?.toString() ?? "");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<StockAdjustment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const total = manualStockTotal(stock);
  const locationId = `stock-location-${sku}`;
  const qtyId = `stock-quantity-${sku}`;
  const reasonId = `stock-reason-${sku}`;

  function chooseLocation(value: string) {
    setLocation(value); setQuantity(stock.locations.find(row => row.location === value)?.quantity?.toString() ?? "");
  }
  async function refresh() {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try {
      const result = await loadProductStock({ productSku, sku });
      if (result.error || !result.stock) { setError(result.error ?? "Unable to load stock."); return; }
      onChange({ ...stock, ...result.stock }); setHistory(result.history ?? []);
      setQuantity(result.stock.locations.find(row => row.location === location)?.quantity?.toString() ?? "");
    } catch { setError("Unable to load shared stock. Please retry."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function save() {
    if (busy || disabled || !persisted) return;
    const count = quantity.trim() === "" ? null : Number(quantity);
    if (count !== null && (!Number.isSafeInteger(count) || count < 0) || !location.trim() || !reason.trim()) { setError("Enter a location, a whole quantity or leave blank, and a reason."); return; }
    setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try {
      const result = await adjustProductStock({ productSku, sku, location: location.trim(), quantity: count, revision: stock.locations.find(row => row.location === location.trim())?.revision ?? null, reason: reason.trim() });
      if (result.error || !result.revision) { setError(result.error ?? "Unable to save shared stock."); return; }
      const updated = { location: location.trim(), quantity: count, revision: result.revision, updated_at: new Date().toISOString() };
      onChange({ ...stock, locations: [...stock.locations.filter(row => row.location !== updated.location), updated] });
      setLocation(updated.location); setReason(""); setHistory(null); setMessage("Stock updated for the team.");
    } catch { setError("Unable to save shared stock. Please retry."); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="shared-stock-editor" aria-busy={busy}>
    <p className="text-xs text-muted-foreground">Manual stock is shared across the team. Updates save immediately, separately from product details.</p>
    {stock.locations.length ? <div className="shared-stock-table"><Table aria-label="Shared stock by location"><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Available</TableHead></TableRow></TableHeader><TableBody>{stock.locations.map(row => <TableRow key={row.location}><TableCell><Button type="button" variant="link" size="sm" onClick={() => chooseLocation(row.location)} disabled={busy}>{row.location}</Button></TableCell><TableCell>{row.quantity?.toLocaleString("en") ?? "Unknown"}</TableCell></TableRow>)}</TableBody><TableFooter><TableRow><TableHead>Total</TableHead><TableCell>{total?.toLocaleString("en") ?? "Unknown"}</TableCell></TableRow></TableFooter></Table></div> : <p className="text-sm">No shared stock entered.</p>}
    {!stock.locations.length && stock.legacyQuantity != null ? <p className="text-xs text-muted-foreground">Your previous personal quantity: {stock.legacyQuantity.toLocaleString("en")}. Enter the verified team quantity below.</p> : null}
    {persisted ? <><div className="shared-stock-fields"><div className="space-y-2"><Label htmlFor={locationId}>Location</Label><Input id={locationId} value={location} list={`locations-${sku}`} maxLength={100} onChange={event => chooseLocation(event.target.value)} disabled={disabled || busy} /><datalist id={`locations-${sku}`}>{stock.locations.map(row => <option key={row.location} value={row.location} />)}</datalist></div><div className="space-y-2"><Label htmlFor={qtyId}>Available quantity</Label><Input id={qtyId} value={quantity} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" placeholder="Unknown" onChange={event => setQuantity(event.target.value)} disabled={disabled || busy} /></div></div><div className="space-y-2"><Label htmlFor={reasonId}>Adjustment reason</Label><Input id={reasonId} value={reason} maxLength={300} placeholder="e.g. Received stock or stock count" onChange={event => setReason(event.target.value)} disabled={disabled || busy} /></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={disabled || busy} onClick={save}>{busy ? "Updating…" : "Update shared stock"}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={refresh}>Reload stock / history</Button></div></> : <p className="text-xs text-muted-foreground">Save this product and SKU before entering shared stock.</p>}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}{message ? <p role="status" className="text-xs text-primary">{message}</p> : null}
    {history ? <details open><summary className="text-xs">Recent adjustments</summary>{history.length ? <ol className="shared-stock-history">{history.map(item => <li key={item.id}><span>{item.location}: {item.previous_quantity ?? "Unknown"} → {item.quantity ?? "Unknown"}</span><span>{item.reason}</span><small>{item.actor_name} · {new Date(item.created_at).toLocaleString()}</small></li>)}</ol> : <p className="mt-2 text-xs text-muted-foreground">No adjustments yet.</p>}</details> : null}
  </div>;
}
