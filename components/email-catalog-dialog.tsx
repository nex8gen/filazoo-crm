"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, Library, LoaderCircle, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildCatalogPdfWithImages } from "@/lib/catalog-pdf";
import type { Catalog, Product } from "@/lib/types";

const inputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass = "inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40";

export function EmailCatalogDialog({ products, catalogs, customer, busy, onClose, onAttach }: {
  products: Product[];
  catalogs: Catalog[];
  customer: string;
  busy: boolean;
  onClose: () => void;
  onAttach: (title: string, bytes: Uint8Array) => Promise<void>;
}) {
  const [title, setTitle] = useState(customer ? `${customer} product catalog` : "Filazoo product catalog");
  const [customerName, setCustomerName] = useState(customer);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("");
  const [stock, setStock] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [sort, setSort] = useState("original");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ key: string; url: string; bytes: Uint8Array } | null>(null);
  const previewRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { if (preview) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [preview]);

  const locked = busy || generating;
  const materials = [...new Set(products.map((p) => p.material).filter(Boolean))].sort();
  const stockStatuses = [...new Set(products.map((p) => p.stockStatus).filter(Boolean))].sort();
  const visible = products.filter((p) => (!material || p.material === material) && (!stock || p.stockStatus === stock)
    && (!onlySelected || selected.has(p.sku)) && `${p.name} ${p.sku} ${p.material} ${p.colors.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = products.filter((p) => selected.has(p.sku));
  if (sort !== "original") chosen.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : a.material.localeCompare(b.material) || a.name.localeCompare(b.name)));
  const key = JSON.stringify([chosen, title.trim(), customerName.trim(), note.trim()]);
  const currentPreview = preview?.key === key ? preview : null;

  function loadSelection(skus: string[], name: string) {
    setSelected(new Set(products.filter((p) => skus.includes(p.sku)).map((p) => p.sku)));
    setTitle(name);
    setQuery(""); setMaterial(""); setStock(""); setOnlySelected(false); setError("");
  }

  async function generate(attach: boolean) {
    if (locked || !chosen.length || !title.trim()) return;
    setGenerating(true); setError("");
    try {
      const bytes = currentPreview?.bytes ?? await buildCatalogPdfWithImages(chosen, { title: title.trim(), customer: customerName.trim() || undefined, note: note.trim() || undefined });
      if (!mounted.current) return;
      if (bytes.byteLength > 7_500_000) throw new Error("This PDF exceeds 7.5 MB. Select fewer products and try again.");
      if (attach) await onAttach(title.trim(), bytes);
      else if (!currentPreview) setPreview({ key, bytes, url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" })) });
      else previewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not generate this PDF. Try again.");
    } finally { if (mounted.current) setGenerating(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !locked) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl" showCloseButton={!locked}>
      <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-primary"><Library className="size-4" />CATALOG BUILDER</div>
        <DialogTitle className="text-xl font-semibold">Attach a product catalog</DialogTitle>
        <DialogDescription>Choose products, tailor the details, and review your PDF before attaching.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto">
        <fieldset disabled={locked} className="grid min-w-0 disabled:opacity-70 md:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4 p-5">
            <label className="block text-xs font-medium">Start from a catalog
              <select className={`${inputClass} mt-1.5`} value="" onChange={(event) => {
                if (event.target.value === "all") loadSelection(products.map((p) => p.sku), "Filazoo complete catalog");
                else { const saved = catalogs.find((c) => c.id === event.target.value); if (saved) loadSelection(saved.productSkus, `${saved.company} catalog v${saved.version}`); }
              }}>
                <option value="">Choose a saved selection or select products below</option>
                <option value="all">Complete Filazoo catalog ({products.length} products)</option>
                {catalogs.map((c) => <option key={c.id} value={c.id}>{c.company} · v{c.version} · {products.filter((p) => c.productSkus.includes(p.sku)).length} available products · {c.currency}</option>)}
              </select>
            </label>
            <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><input aria-label="Search products" placeholder="Search name, SKU, material, or color…" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-9`} /></div>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Filter by material" value={material} onChange={(e) => setMaterial(e.target.value)} className={inputClass}><option value="">All materials</option>{materials.map((value) => <option key={value}>{value}</option>)}</select>
              <select aria-label="Filter by stock status" value={stock} onChange={(e) => setStock(e.target.value)} className={inputClass}><option value="">All stock statuses</option>{stockStatuses.map((value) => <option key={value}>{value}</option>)}</select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground" role="status">{visible.length} shown · {chosen.length} selected</span>
              <div className="flex items-center gap-3"><button type="button" className="font-medium text-primary hover:underline disabled:opacity-40" disabled={!visible.length} onClick={() => setSelected((current) => new Set([...current, ...visible.map((p) => p.sku)]))}>Select shown</button><button type="button" className="text-muted-foreground hover:underline disabled:opacity-40" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear all</button></div>
            </div>
            <div className="max-h-[350px] min-h-40 divide-y overflow-y-auto rounded-lg border">
              {visible.length ? visible.map((product) => <label key={product.sku} className={`flex cursor-pointer items-center gap-3 p-3 transition-colors ${selected.has(product.sku) ? "bg-primary/5" : "hover:bg-muted/50"}`}>
                <input type="checkbox" checked={selected.has(product.sku)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(product.sku)) next.delete(product.sku); else next.add(product.sku); return next; })} className="size-4 shrink-0 accent-primary" />
                <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{product.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{[product.sku, product.material, product.stockStatus].filter(Boolean).join(" · ")}</span></span>
                <span className="shrink-0 text-xs font-medium">{product.price || "On request"}</span>
              </label>) : <div className="px-5 py-12 text-center"><Search className="mx-auto mb-2 size-5 text-muted-foreground" /><p className="text-sm font-medium">No products found</p><p className="mt-1 text-xs text-muted-foreground">Try another search or adjust your filters.</p></div>}
            </div>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} className="accent-primary" />Show selected products only</label>
          </div>
          <aside className="space-y-4 border-t bg-muted/25 p-5 md:border-l md:border-t-0">
            <div><h3 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" />PDF details</h3><p className="mt-1 text-xs text-muted-foreground">Landscape PDF with product photos, variants, and current CRM pricing.</p></div>
            <label className="block text-xs font-medium">Catalog title <span className="text-muted-foreground">(required)</span><input maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputClass} mt-1.5`} /></label>
            <label className="block text-xs font-medium">Prepared for<input maxLength={100} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer or company (optional)" className={`${inputClass} mt-1.5`} /></label>
            <details className="rounded-lg border bg-background p-3" open>
              <summary className="cursor-pointer text-xs font-semibold">Advanced options</summary>
              <div className="mt-4 space-y-4">
                <label className="block text-xs font-medium">Product order<select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputClass} mt-1.5`}><option value="original">Catalog order</option><option value="name">Name: A–Z</option><option value="material">Material, then name</option></select></label>
                <label className="block text-xs font-medium">PDF footer note<textarea maxLength={80} rows={3} value={note} onChange={(e) => setNote(e.target.value.replace(/\r?\n/g, " "))} placeholder="e.g. Prices valid for 30 days" className="mt-1.5 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-ring" /><span className="mt-1 block text-right font-normal text-muted-foreground">{note.length}/80</span></label>
              </div>
            </details>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs"><p className="flex items-center gap-2 font-medium"><Check className="size-4" />{chosen.length} products in your PDF</p><p className="mt-1.5 text-muted-foreground">Filters help you find products. Your selection stays saved as you search.</p></div>
          </aside>
        </fieldset>
        {currentPreview ? <section ref={previewRef} className="border-t p-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">PDF preview</h3><a href={currentPreview.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary underline">Open in new tab</a></div><iframe title="Catalog PDF preview" src={currentPreview.url} className="h-[400px] w-full rounded-lg border" /></section> : null}
      </div>
      <div className="shrink-0 border-t bg-background px-5 py-4">
        {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground" role="status">{locked ? "Preparing your catalog PDF…" : !chosen.length ? "Select products to preview or attach." : !title.trim() ? "Enter a catalog title to continue." : `${chosen.length} products · PDF · Up to 7.5 MB`}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={locked} onClick={onClose} className={buttonClass}>Cancel</button><button type="button" disabled={locked || !chosen.length || !title.trim()} onClick={() => void generate(false)} className={buttonClass}>Preview PDF</button><button type="button" disabled={locked || !chosen.length || !title.trim()} onClick={() => void generate(true)} className={`${buttonClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`}>{locked ? <LoaderCircle className="size-4 animate-spin" /> : <FileText className="size-4" />}Attach PDF</button></div></div>
      </div>
    </DialogContent>
  </Dialog>;
}
