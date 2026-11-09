"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, Loader2, Package2, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { marketingAssetInputSchema, marketingAssetText, marketingCategoryLabels, type MarketingAsset, type MarketingProduct } from "@/lib/marketing-assets";

export function MarketingAssetEditor({ initial, products, canWrite, onSaved, onDeleted, onClose }: {
  initial: MarketingAsset; products: MarketingProduct[]; canWrite: boolean;
  onSaved: (asset: MarketingAsset) => void; onDeleted: (id: string) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState<"save" | "ai" | "delete" | null>(null);
  const [error, setError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [confirmation, setConfirmation] = useState<"discard" | "delete" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = <K extends keyof MarketingAsset>(key: K, value: MarketingAsset[K]) => { setDraft(current => ({ ...current, [key]: value })); setError(""); };
  const disabled = !canWrite || busy !== null;
  const selected = new Set(draft.productSkus);
  const filteredProducts = products.filter(product => `${product.name} ${product.sku} ${product.material}`.toLowerCase().includes(productSearch.toLowerCase()));
  const unavailable = draft.productSkus.filter(sku => !products.some(product => product.sku === sku));

  useEffect(() => {
    if (!dirty) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [dirty]);

  async function save() {
    const parsed = marketingAssetInputSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the promotion fields."); return; }
    setBusy("save"); setError("");
    try {
      const response = await fetch("/api/marketing-assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This plan could not be saved.");
      setDraft(body.asset); setSaved(body.asset); onSaved(body.asset); toast.success("Promotion saved");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This plan could not be saved."); }
    finally { setBusy(null); }
  }
  async function generate() {
    if (!draft.offer.trim()) { setError("Describe your offer first so AI can draft an accurate message."); return; }
    setBusy("ai"); setError("");
    try {
      const response = await fetch("/api/marketing-assets/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "AI drafting is temporarily unavailable.");
      update("message", body.message); toast.success("Message drafted. Review it before saving.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "AI drafting is temporarily unavailable."); }
    finally { setBusy(null); }
  }
  async function remove() {
    setBusy("delete"); setError("");
    try {
      const response = await fetch("/api/marketing-assets", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: saved.id, updatedAt: saved.updatedAt }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This plan could not be deleted.");
      onDeleted(saved.id); toast.success("Promotion deleted"); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This plan could not be deleted."); }
    finally { setBusy(null); setConfirmation(null); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(marketingAssetText(draft, products)); toast.success("Promotion copied"); }
    catch { setError("Clipboard access is unavailable. You can download this promotion instead."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([marketingAssetText(draft, products)], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${draft.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 80) || "promotion"}.txt`; link.click(); URL.revokeObjectURL(url);
  }
  return <>
    <Sheet open onOpenChange={open => { if (!open && !busy) { if (dirty) setConfirmation("discard"); else onClose(); } }}>
      <SheetContent side="right" className="!z-[65] !w-full gap-0 sm:!max-w-[620px]">
        <SheetHeader className="border-b px-6 py-5 pr-14">
          <p className="text-xs font-medium text-primary">{marketingCategoryLabels[draft.category]} · {draft.year}</p>
          <SheetTitle className="text-xl">{saved.updatedAt ? "Edit promotion" : "Plan a promotion"}</SheetTitle>
          <SheetDescription>Shape your offer and keep the message ready to use.</SheetDescription>
        </SheetHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
            {!canWrite ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">You have view-only access to marketing assets.</p> : null}
            <fieldset disabled={disabled} className="space-y-5 disabled:opacity-80">
              <legend className="mb-4 text-sm font-semibold">Promotion details</legend>
              <label className="block space-y-2 text-sm font-medium">Promotion name<Input value={draft.title} maxLength={160} required onChange={event => update("title", event.target.value)} placeholder="Give your promotion a name" /></label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block space-y-2 text-sm font-medium">Start date<Input type="date" required min={`${draft.year}-01-01`} max={`${draft.year}-12-31`} value={draft.startDate} onChange={event => update("startDate", event.target.value)} /></label>
                <label className="block space-y-2 text-sm font-medium">End date<Input type="date" required min={draft.startDate} value={draft.endDate} onChange={event => update("endDate", event.target.value)} /></label>
              </div>
              <label className="block space-y-2 text-sm font-medium">Target audience<Input value={draft.audience} maxLength={2000} onChange={event => update("audience", event.target.value)} placeholder="e.g. Wholesale partners and returning buyers" /></label>
            </fieldset>

            <fieldset disabled={disabled} className="space-y-3">
              <legend className="mb-3 flex w-full items-center justify-between text-sm font-semibold"><span>Featured products</span><span className="text-xs font-normal text-muted-foreground">{selected.size} selected</span></legend>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search products" placeholder="Search your product catalog…" className="pl-9" value={productSearch} onChange={event => setProductSearch(event.target.value)} /></div>
              <div className="max-h-44 overflow-y-auto rounded-lg border">
                {filteredProducts.length ? filteredProducts.map(product => <label key={product.sku} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm last:border-0 hover:bg-muted/40 has-[:checked]:bg-brand-soft/50">
                  <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.has(product.sku)} onChange={event => update("productSkus", event.target.checked ? [...draft.productSkus, product.sku] : draft.productSkus.filter(sku => sku !== product.sku))} />
                  <Package2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{product.name}<span className="ml-2 text-xs text-muted-foreground">{product.sku}</span></span>
                </label>) : <p className="p-4 text-sm text-muted-foreground">{products.length ? "No products match your search." : "Your active product catalog will appear here."}</p>}
              </div>
              {unavailable.map(sku => <label key={sku} className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked onChange={() => update("productSkus", draft.productSkus.filter(value => value !== sku))} />{sku} — unavailable; uncheck to remove</label>)}
            </fieldset>

            <fieldset disabled={disabled} className="space-y-2">
              <legend className="mb-3 text-sm font-semibold">The offer</legend>
              <Textarea aria-label="Promotion offer" value={draft.offer} maxLength={8000} onChange={event => update("offer", event.target.value)} placeholder="What are you offering? Include pricing, minimum order, eligibility, and any terms your customers should know." className="min-h-28 resize-y" />
            </fieldset>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="marketing-message" className="text-sm font-semibold">Message draft</label><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void generate()}>{busy === "ai" ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy === "ai" ? "Drafting…" : draft.message ? "Improve with AI" : "Draft with AI"}</Button></div>
              <Textarea id="marketing-message" disabled={disabled} value={draft.message} maxLength={12000} onChange={event => update("message", event.target.value)} placeholder="Write your email or campaign message, or let AI help you get started." className="min-h-48 resize-y leading-relaxed" />
              <p className="text-xs text-muted-foreground">AI uses your offer and permitted product details. Review the draft before use.</p>
            </div>
            <fieldset disabled={disabled} className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-4">
              <label htmlFor="marketing-status" className="flex-1 text-sm font-medium">Plan status</label>
              <select id="marketing-status" className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" value={draft.status} onChange={event => update("status", event.target.value as MarketingAsset["status"])}><option value="draft">Draft</option><option value="ready">Ready to use</option></select>
              <p className="w-full text-xs text-muted-foreground">Ready plans need an offer and a message. Saving a plan does not send emails.</p>
            </fieldset>
            <div className="flex flex-wrap items-center gap-2 border-t pt-4"><Button type="button" variant="outline" size="sm" onClick={() => void copy()}><Copy />Copy plan</Button><Button type="button" variant="outline" size="sm" onClick={download}><Download />Download</Button>{saved.updatedAt && canWrite ? <Button type="button" variant="ghost" size="sm" className="ml-auto text-destructive" disabled={busy !== null} onClick={() => setConfirmation("delete")}><Trash2 />Delete</Button> : null}</div>
            {error ? <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="flex items-center justify-between gap-3 border-t bg-background px-6 py-4">
            <span role="status" className="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : saved.updatedAt ? "All changes saved" : "New promotion"}</span>
            <Button type="submit" disabled={disabled || (!dirty && !!saved.updatedAt)}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Check />}{busy === "save" ? "Saving…" : "Save promotion"}</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
    <Dialog open={confirmation !== null} onOpenChange={open => { if (!open && !busy) setConfirmation(null); }}>
      <DialogContent className="!z-[80]">
        <DialogHeader><DialogTitle>{confirmation === "delete" ? "Delete this promotion?" : "Discard unsaved changes?"}</DialogTitle><DialogDescription>{confirmation === "delete" ? "This removes the saved plan and its message from your workspace." : "Your latest edits have not been saved. Keep editing to save them."}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy !== null} onClick={() => setConfirmation(null)}>Keep editing</Button><Button variant="destructive" disabled={busy !== null} onClick={() => { if (confirmation === "delete") void remove(); else onClose(); }}>{busy === "delete" ? "Deleting…" : confirmation === "delete" ? "Delete promotion" : "Discard changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
