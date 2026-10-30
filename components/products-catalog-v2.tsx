"use client";

import { PackageSearch } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { useMemo, useState } from "react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Box, CheckSquare2, ChevronLeft, ChevronRight, Clipboard, Download, FileDown, ImageIcon, PackagePlus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createProduct, updateProduct } from "@/app/crm-actions";
import { downloadCatalogPdf } from "@/lib/catalog-pdf";
import { parseCurrencyAmount } from "@/lib/product-utils";
import { quantityPriceRanges, quantityPricingError, quantityRangeLabel } from "@/lib/quantity-pricing";
import type { DataMode, Product, ProductVariant } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilters, TableFilter } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { ProductImagePicker } from "@/components/product-image-picker";
import { stockLabel } from "@/lib/product-inventory";

const pageSize = 25;
const amount = (value: string) => parseCurrencyAmount(value).toFixed(2);

function formatUpdatedAt(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Not synced";
}

function emptyVariant(sku = "NEW"): ProductVariant {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return { id, name: "", sku: `${sku}-01`, price: "$0.00", stockStatus: "Quote available", imageUrl: null };
}

function productFromForm(form: FormData, variants: ProductVariant[]): Product {
  const currency = String(form.get("currency") || "USD");
  const money = (value: FormDataEntryValue | number | null) => new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(value || 0));
  const priceTiers = [1, 2, 3].flatMap((index) => {
    const minimum = form.get(`minimum${index}`);
    const price = form.get(`price${index}`);
    return minimum && price ? [{ minimumQuantity: Number(minimum), price: money(price) }] : [];
  }).sort((a, b) => a.minimumQuantity - b.minimumQuantity);
  const normalizedVariants = variants.map((variant) => ({ ...variant, price: money(amount(variant.price)), imageUrl: variant.imageUrl || null }));
  return {
    sku: String(form.get("sku")).toUpperCase(),
    name: String(form.get("name")),
    imageUrl: String(form.get("imageUrl") || "") || null,
    material: String(form.get("material")),
    color: normalizedVariants.length === 1 ? normalizedVariants[0].name : `${normalizedVariants.length} variants`,
    colors: normalizedVariants.map((variant) => variant.name),
    diameter: String(form.get("diameter") || "Not specified"),
    weight: String(form.get("weight") || "Not specified"),
    price: priceTiers[0]?.price || money(0),
    moq: priceTiers[0]?.minimumQuantity ?? 1,
    priceTiers,
    stockStatus: String(form.get("stockStatus") || "Not specified"),
    leadTime: String(form.get("leadTime") || "Not specified"),
    status: form.get("active") === "false" ? "Inactive" : "Active",
    updatedAt: new Date().toISOString(),
    variants: normalizedVariants,
  };
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

export function ProductEditor({ product, open = true, onOpenChange, canWrite, mode, onSaved, fullPage = false }: {
  product: Product | null;
  open?: boolean;
  fullPage?: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  mode: DataMode;
  onSaved: (saved: Product, originalSku?: string) => void;
}) {
  const router = useRouter();
  const [variants, setVariants] = useState<ProductVariant[]>(() => product?.variants.length ? product.variants.map((variant) => ({ ...variant })) : [emptyVariant(product?.sku)]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? null);
  const [pricing, setPricing] = useState(() => product?.priceTiers.length
    ? [...product.priceTiers].sort((a, b) => a.minimumQuantity - b.minimumQuantity).map((tier) => ({ minimumQuantity: String(tier.minimumQuantity), price: amount(tier.price) }))
    : [{ minimumQuantity: "1", price: amount(product?.price ?? "0") }]);
  const [uploadCount, setUploadCount] = useState(0);
  const uploading = uploadCount > 0;
  const onImageBusyChange = (busy: boolean) => setUploadCount((count) => count + (busy ? 1 : -1));

  const updateVariant = (index: number, patch: Partial<ProductVariant>) => {
    setVariants((current) => current.map((variant, position) => position === index ? { ...variant, ...patch } : variant));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || saving || uploading) return;
    if (!variants.length || variants.some((variant) => !variant.name.trim() || !variant.sku.trim())) {
      setError("Every variant needs a name and SKU.");
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set("colors", variants.map((variant) => variant.name.trim()).join(", "));
    form.set("overrideVersion", product?.overrideVersion ?? "");
    const pricingError = quantityPricingError(pricing.map((tier) => ({ ...tier, minimumQuantity: Number(tier.minimumQuantity) })));
    if (pricingError) { setError(pricingError); return; }
    if (product?.stock !== undefined) form.set("stockStatus", "ERP managed");
    const currency = String(form.get("currency") || "USD");
    form.set("variants", JSON.stringify(variants.map(variant => ({ ...variant, price: new Intl.NumberFormat("en", { style: "currency", currency }).format(parseCurrencyAmount(variant.price)), stockStatus: variant.stock !== undefined ? "ERP managed" : variant.stockStatus }))));
    if (product) form.set("originalSku", product.sku);
    setSaving(true);
    setError("");
    try {
      if (mode === "live") {
        const result = product ? await updateProduct(undefined, form) : await createProduct(undefined, form);
        if (result?.error) { setError(result.error); return; }
        router.refresh();
      }
      const saved = productFromForm(form, variants);
      onSaved(saved, product?.sku);
      if (!fullPage) onOpenChange(false);
      toast.success(mode === "demo" ? `${saved.name} saved for this demo session.` : `${saved.name} saved.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save this product. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const contents = <div className="space-y-5">
      {fullPage ? <div><h1 className="text-xl font-semibold">{product?.name}</h1><p className="mt-1 text-sm text-muted-foreground">Your prices, product details, and photos are private to your account. Your catalogs and AI automations use these saved details.</p></div> : <DialogHeader><DialogTitle>{product ? product.name : "Add product"}</DialogTitle><DialogDescription>{canWrite ? "Edit product details and manage every variant individually." : "View product details and variants."}</DialogDescription></DialogHeader>}
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <fieldset disabled={saving || uploading} className="contents">
        <input type="hidden" name="variants" />
        <Field label="Product name" id="product-name"><Input id="product-name" name="name" defaultValue={product?.name} required disabled={!canWrite} /></Field>
        <Field label="SKU" id="product-sku"><Input id="product-sku" name="sku" defaultValue={product?.sku} placeholder="PLA-CUSTOM" required readOnly={Boolean(product)} disabled={!canWrite} /></Field>
        <Field label="Material" id="product-material"><Input id="product-material" name="material" defaultValue={product?.material} placeholder="PLA" required disabled={!canWrite} /></Field>
        <Field label="Status" id="product-status"><Select name="active" defaultValue={product?.status === "Inactive" ? "false" : "true"} disabled={!canWrite}><SelectTrigger id="product-status" size="sm" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="true">Active</SelectItem><SelectItem value="false">Inactive</SelectItem></SelectContent></Select></Field>
        <Field label="Diameter" id="product-diameter"><Input id="product-diameter" name="diameter" defaultValue={product?.diameter === "Not specified" ? "" : product?.diameter} placeholder="1.75 mm" disabled={!canWrite} /></Field>
        <Field label="Pack weight" id="product-weight"><Input id="product-weight" name="weight" defaultValue={product?.weight === "Not specified" ? "" : product?.weight} placeholder="1 kg" disabled={!canWrite} /></Field>
        <Field label="Stock status" id="product-stock"><Input id="product-stock" name="stockStatus" defaultValue={product?.stockStatus} placeholder="In stock" disabled={!canWrite || product?.stock !== undefined} />{product?.stock !== undefined ? <p className="text-xs text-muted-foreground">Stock comes from Lingxing ERP. Sync stock to refresh quantities.</p> : null}</Field>
        <Field label="Lead time" id="product-lead"><Input id="product-lead" name="leadTime" defaultValue={product?.leadTime} placeholder="Ships in 3–5 days" disabled={!canWrite} /></Field>
        <div className="sm:col-span-2"><input type="hidden" name="imageUrl" value={imageUrl ?? ""} /><ProductImagePicker id="product-image" label="Product image" value={imageUrl} onChange={setImageUrl} disabled={!canWrite || saving || uploading} mode={mode} onBusyChange={onImageBusyChange} /></div>

        <section className="space-y-3 border-t pt-4 sm:col-span-2">
          <div className="flex items-center justify-between gap-3"><div><p className="font-medium">Volume pricing</p><p className="text-xs text-muted-foreground">Set quantity ranges for this product.</p></div><label className="text-xs text-muted-foreground">Currency <Select name="currency" defaultValue={product?.currency ?? (product?.price.startsWith("€") ? "EUR" : product?.price.startsWith("£") ? "GBP" : /[¥￥]|CNY|CN¥/.test(product?.price ?? "") ? "CNY" : "USD")} disabled={!canWrite}><SelectTrigger size="sm" className="ml-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="GBP">GBP</SelectItem><SelectItem value="CNY">CNY</SelectItem></SelectContent></Select></label></div>
          <div className="grid gap-3 sm:grid-cols-3">{pricing.map((tier, index) => <div key={index} className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <div className="flex h-8 items-center justify-between gap-1"><p className="text-sm font-medium" aria-live="polite">{quantityRangeLabel(Number(tier.minimumQuantity) || 1, pricing[index + 1] ? Number(pricing[index + 1].minimumQuantity) : undefined)}</p>{canWrite && index === pricing.length - 1 && index > 0 ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove quantity range" onClick={() => setPricing((current) => current.slice(0, -1))}><Trash2 /></Button> : null}</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From qty" id={`minimum-${index + 1}`}><Input id={`minimum-${index + 1}`} name={`minimum${index + 1}`} type="number" min={index > 0 ? Number(pricing[index - 1].minimumQuantity) + 1 : 1} step="1" value={tier.minimumQuantity} onChange={(event) => setPricing((current) => current.map((item, position) => position === index ? { ...item, minimumQuantity: event.target.value } : item))} required disabled={!canWrite} /></Field>
              {pricing[index + 1] ? <Field label="To qty" id={`maximum-${index + 1}`}><Input id={`maximum-${index + 1}`} type="number" min={Number(tier.minimumQuantity) || 1} step="1" value={pricing[index + 1].minimumQuantity === "" ? "" : Number(pricing[index + 1].minimumQuantity) - 1} onChange={(event) => setPricing((current) => current.map((item, position) => position === index + 1 ? { ...item, minimumQuantity: event.target.value === "" ? "" : String(Number(event.target.value) + 1) } : item))} required disabled={!canWrite} /></Field> : <div className="space-y-2"><Label>To qty</Label><p className="flex h-9 items-center text-xs text-muted-foreground">No upper limit</p></div>}
            </div>
            <Field label="Unit price" id={`price-${index + 1}`}><Input id={`price-${index + 1}`} name={`price${index + 1}`} type="number" min="0" step="0.01" value={tier.price} onChange={(event) => setPricing((current) => current.map((item, position) => position === index ? { ...item, price: event.target.value } : item))} required disabled={!canWrite} /></Field>
          </div>)}</div>
          {canWrite && pricing.length < 3 ? <Button type="button" variant="outline" size="sm" onClick={() => setPricing((current) => [...current, { minimumQuantity: String(Number(current[current.length - 1].minimumQuantity) + 100), price: "" }])}><Plus />Add quantity range</Button> : null}
        </section>

        <section className="space-y-3 border-t pt-4 sm:col-span-2">
          <div className="flex items-center justify-between"><div><p className="font-medium">Variants <Badge variant="secondary" className="ml-1">{variants.length}</Badge></p><p className="text-xs text-muted-foreground">Each variant has its own SKU, price, availability, and image.</p></div>{canWrite ? <Button type="button" variant="outline" size="sm" onClick={() => setVariants((current) => [...current, emptyVariant(product?.sku)])}><Plus />Add variant</Button> : null}</div>
          <div className={fullPage ? "space-y-3" : "max-h-80 space-y-2 overflow-y-auto pr-1"}>{variants.map((variant, index) => <div key={variant.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1.2fr_1fr_.7fr_1fr_auto]">
            <Input value={variant.name} onChange={(event) => updateVariant(index, { name: event.target.value })} placeholder="Name / color" aria-label={`Variant ${index + 1} name`} disabled={!canWrite} />
            <Input value={variant.sku} onChange={(event) => updateVariant(index, { sku: event.target.value })} placeholder="Variant SKU" aria-label={`Variant ${index + 1} SKU`} disabled={!canWrite} />
            <Input value={variant.price.replace(/[^0-9.-]/g, "")} onChange={(event) => updateVariant(index, { price: event.target.value })} type="number" min="0" step="0.01" placeholder="Price" aria-label={`Variant ${index + 1} price`} disabled={!canWrite} />
            <Input value={variant.stock !== undefined ? stockLabel(variant.stock) : variant.stockStatus} onChange={(event) => updateVariant(index, { stockStatus: event.target.value })} placeholder="Availability" aria-label={`Variant ${index + 1} availability`} disabled={!canWrite || variant.stock !== undefined} />
            {canWrite ? <Button type="button" variant="ghost" size="icon-sm" disabled={variants.length === 1 || saving || uploading} onClick={() => setVariants((current) => current.filter((_, position) => position !== index))} aria-label={`Remove ${variant.name || "variant"}`}><Trash2 /></Button> : null}
            <div className="sm:col-span-full"><ProductImagePicker id={`variant-image-${variant.id}`} label={`Variant ${index + 1} image (optional)`} value={variant.imageUrl} onChange={(imageUrl) => updateVariant(index, { imageUrl })} disabled={!canWrite || saving || uploading} mode={mode} onBusyChange={onImageBusyChange} /></div>
          </div>)}</div>
        </section>
        </fieldset>
        {error ? <p role="alert" className="text-xs text-destructive sm:col-span-2">{error}</p> : null}
        <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" disabled={saving || uploading} onClick={() => onOpenChange(false)}>Close</Button>{canWrite ? <Button type="submit" disabled={saving || uploading}>{uploading ? "Uploading image…" : saving ? "Saving…" : product ? "Save changes" : "Add product"}</Button> : null}</DialogFooter>
      </form>
  </div>;
  return fullPage ? contents : <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving && !uploading) onOpenChange(nextOpen); }}><DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-4xl">{contents}</DialogContent></Dialog>;
}

export function ProductDetail({ product, mode }: { product: Product; mode: DataMode }) {
  const router = useRouter();
  const [downloadOpen, setDownloadOpen] = useState(false);
  return <div className="mx-auto w-full max-w-5xl space-y-5 pb-8">
    <div className="flex items-center justify-between gap-3"><Link href="/catalogs" className="text-sm text-muted-foreground hover:text-foreground">← All products</Link><Button variant="outline" onClick={() => setDownloadOpen(true)}><FileDown />Download saved product PDF</Button></div>
    <ProductEditor key={`${product.sku}-${product.overrideVersion ?? "base"}`} product={product} canWrite mode={mode} fullPage onSaved={() => router.refresh()} onOpenChange={() => router.push("/catalogs")} />
    {downloadOpen ? <CatalogDownloadDialog products={[product]} open onOpenChange={setDownloadOpen} /> : null}
  </div>;
}

function CatalogDownloadDialog({ products, open, onOpenChange }: { products: Product[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState("Product catalog");
  const [customer, setCustomer] = useState("");
  const [downloading, setDownloading] = useState(false);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>Download custom catalog</DialogTitle><DialogDescription>Landscape quotation with {products.length} selected products, current CRM pricing, and every variant. Missing images use a default photo.</DialogDescription></DialogHeader>
    <div className="space-y-6"><Field label="Catalog title" id="catalog-title"><Input id="catalog-title" value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Prepared for (optional)" id="catalog-customer"><Input id="catalog-customer" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Customer or company name" /></Field><div className="max-h-32 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Selected products</p><p className="mt-1">{products.map((product) => product.name).join(", ")}</p></div></div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={downloading} onClick={async () => { setDownloading(true); try { await downloadCatalogPdf(products, { title, customer }); toast.success("Custom catalog downloaded."); onOpenChange(false); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not generate catalog. Please try again."); } finally { setDownloading(false); } }}><FileDown />{downloading ? "Preparing PDF…" : "Download PDF"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function ProductsCatalogV2({ products: initialProducts, canWrite, mode }: { products: Product[]; canWrite: boolean; mode: DataMode }) {
  const router = useRouter();
  const [products, setProducts] = useState(initialProducts);
  const [previousProducts, setPreviousProducts] = useState(initialProducts);
  if (initialProducts !== previousProducts) {
    setPreviousProducts(initialProducts);
    setProducts(initialProducts);
  }
  const [query, setQuery] = useWorkspaceState("products.query", "");
  const [material, setMaterial] = useWorkspaceState("products.material", "all");
  const [status, setStatus] = useWorkspaceState("products.status", "all");
  const [draft, setDraft] = useWorkspaceState("products.filters", { query: "", material: "all", status: "all" });
  const [page, setPage] = useWorkspaceState("products.page", 1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const materials = useMemo(() => [...new Set(products.map((product) => product.material))].sort(), [products]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => (!needle || [product.name, product.sku, product.material, ...product.colors].some((value) => value.toLowerCase().includes(needle))) && (material === "all" || product.material === material) && (status === "all" || product.status === status));
  }, [material, products, query, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visibleProducts = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedProducts = products.filter((product) => selected.has(product.sku));
  const visibleSelected = visibleProducts.length > 0 && visibleProducts.every((product) => selected.has(product.sku));

  function saveLocal(saved: Product, originalSku?: string) {
    setProducts((current) => originalSku ? current.map((product) => product.sku === originalSku ? saved : product) : [saved, ...current]);
    if (originalSku && originalSku !== saved.sku) setSelected((current) => { const next = new Set(current); if (next.delete(originalSku)) next.add(saved.sku); return next; });
  }
  function toggleSelected(sku: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(sku)) next.delete(sku); else next.add(sku); return next; });
  }
  function exportCsv() {
    const fields = ["Name", "SKU", "Material", "Variants", "Volume pricing", "Stock", "Lead time", "Status", "Image URL"];
    const rows = filtered.map((product) => [product.name, product.sku, product.material, product.variants.map((variant) => `${variant.name} (${variant.sku})`).join(" | "), quantityPriceRanges(product.priceTiers).map((tier) => `${tier.label} ${tier.price}`).join(" | "), product.stockStatus, product.leadTime, product.status, product.imageUrl || ""]);
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [fields, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `filazoo-products-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
    toast.success(`${filtered.length} products exported.`);
  }

  return <><div className="crm-products-catalog flex min-w-0 flex-col gap-6">
    <TableFilters onApply={() => { setQuery(draft.query); setMaterial(draft.material); setStatus(draft.status); setPage(1); }} actions={<><Button type="button" variant="outline" onClick={exportCsv} disabled={!filtered.length}><Download />CSV</Button><Button type="button" onClick={() => { setEditingProduct(null); setEditorOpen(true); }} disabled={!canWrite}><Plus />Add product</Button></>}>
      <TableFilter label="Search product" search><Input value={draft.query} onChange={(event) => setDraft({ ...draft, query: event.target.value })} placeholder="Name, SKU, material, or variant" /></TableFilter>
      <TableFilter label="Material"><Select value={draft.material} onValueChange={(value) => setDraft({ ...draft, material: value ?? "all" })}><SelectTrigger><SelectValue>{draft.material === "all" ? "All materials" : draft.material}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All materials</SelectItem>{materials.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></TableFilter>
      <TableFilter label="Status"><Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: value ?? "all" })}><SelectTrigger><SelectValue>{draft.status === "all" ? "All statuses" : draft.status}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent></Select></TableFilter>
    </TableFilters>
    {selected.size ? <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><CheckSquare2 className="size-4 text-primary" /><p className="text-sm font-medium">{selected.size} product{selected.size === 1 ? "" : "s"} selected</p><Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>Clear</Button></div><Button size="sm" onClick={() => setDownloadOpen(true)}><PackagePlus />Create custom catalog</Button></div> : null}
    <Card className="crm-table-frame crm-table-page-wide gap-0 overflow-hidden py-0 shadow-none"><div className="crm-product-desktop"><Table className="min-w-[1180px] table-fixed"><colgroup><col className="w-10" /><col className="w-[280px]" /><col className="w-[280px]" /><col className="w-[250px]" /><col className="w-[165px]" /><col className="w-[85px]" /><col className="w-[120px]" /></colgroup><TableHeader><TableRow className="hover:bg-transparent"><TableHead className="pl-4"><Checkbox checked={visibleSelected} onCheckedChange={() => setSelected((current) => { const next = new Set(current); visibleProducts.forEach((product) => visibleSelected ? next.delete(product.sku) : next.add(product.sku)); return next; })} aria-label="Select visible products" /></TableHead><TableHead>Product</TableHead><TableHead>Specifications</TableHead><TableHead>EXW volume pricing</TableHead><TableHead>Availability</TableHead><TableHead>Status</TableHead><TableHead className="pr-4 text-right">Updated</TableHead></TableRow></TableHeader><TableBody>
      {visibleProducts.map((product) => <TableRow key={product.sku} className="cursor-pointer" onClick={() => router.push(`/catalogs/products/${encodeURIComponent(product.sku)}`)}>
        <TableCell className="pl-4" onClick={(event) => event.stopPropagation()}><Checkbox checked={selected.has(product.sku)} onCheckedChange={() => toggleSelected(product.sku)} aria-label={`Select ${product.name}`} /></TableCell>
        <TableCell className="overflow-hidden"><Link href={`/catalogs/products/${encodeURIComponent(product.sku)}`} onClick={(event) => event.stopPropagation()} className="flex w-full min-w-0 items-center gap-3 overflow-hidden text-left"><div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">{product.imageUrl ? <Image src={product.imageUrl} alt="" width={48} height={48} unoptimized className="size-full object-cover" /> : <ImageIcon className="size-4 text-muted-foreground" />}</div><div className="min-w-0 overflow-hidden"><p className="truncate font-medium hover:text-primary" title={product.name}>{product.name}</p><p className="truncate font-mono text-xs text-muted-foreground" title={product.sku}>{product.sku}</p><p className="mt-1 truncate text-xs text-muted-foreground">{product.variants.length} variant{product.variants.length === 1 ? "" : "s"} · Click to view</p></div></Link></TableCell>
        <TableCell className="overflow-hidden whitespace-normal"><div className="min-w-0 space-y-1 overflow-hidden"><p className="truncate font-medium">{product.material} · {product.variants.length} variant{product.variants.length === 1 ? "" : "s"}</p><p className="truncate text-xs text-muted-foreground" title={product.colors.join(", ")}>{product.colors.join(" · ")}</p>{product.weight !== "Not specified" && product.weight !== "—" ? <p className="truncate text-xs text-muted-foreground">Pack weight: {product.weight}</p> : null}</div></TableCell>
        <TableCell className="overflow-hidden whitespace-normal">{product.priceTiers.length ? <div className="flex max-w-full flex-wrap gap-1.5">{quantityPriceRanges(product.priceTiers).map((tier) => <span key={`${tier.minimumQuantity}-${tier.price}`} className="shrink-0 rounded-md border bg-muted/40 px-2 py-1 text-xs"><span className="text-muted-foreground">{tier.label}</span> <span className="font-medium">{tier.price}</span></span>)}</div> : <span className="text-muted-foreground">Price unavailable</span>}</TableCell>
        <TableCell className="overflow-hidden whitespace-normal"><div className="flex min-w-0 items-start gap-2"><Box className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate" title={product.stock !== undefined ? stockLabel(product.stock) : product.stockStatus}>{product.stock !== undefined ? stockLabel(product.stock) : product.stockStatus}</p>{product.stock ? <p className="mt-0.5 text-xs text-muted-foreground" title={product.stock.syncedAt}>{product.stock.onHand.toLocaleString("en")} on hand · {product.stock.locked.toLocaleString("en")} locked</p> : null}<p className="mt-0.5 truncate text-xs text-muted-foreground" title={product.leadTime}>{product.leadTime}</p></div></div></TableCell>
        <TableCell><Badge variant={product.status === "Active" ? "secondary" : "outline"}>{product.status}</Badge></TableCell>
        <TableCell className="overflow-hidden pr-4"><div className="flex items-center justify-end gap-1"><span className="truncate text-xs text-muted-foreground">{formatUpdatedAt(product.updatedAt)}</span><Button className="shrink-0" variant="ghost" size="icon-sm" aria-label={`Copy ${product.sku}`} onClick={async (event) => { event.stopPropagation(); await navigator.clipboard.writeText(product.sku); toast.success(`${product.sku} copied.`); }}><Clipboard /></Button></div></TableCell>
      </TableRow>)}
      {!visibleProducts.length ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground"><EmptyState compact icon={PackageSearch} title="No products match these filters." description="Try another search or adjust your filters." className="border-0 bg-transparent" /></TableCell></TableRow> : null}
    </TableBody></Table></div>

    
    </Card>
<TablePagination page={currentPage} pageCount={pages} start={visibleProducts.length ? (currentPage - 1) * pageSize + 1 : 0} end={Math.min(currentPage * pageSize, filtered.length)} total={filtered.length} itemLabel="products" previousIcon={ChevronLeft} nextIcon={ChevronRight} onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
  </div>
    {editorOpen ? <ProductEditor key={editingProduct?.sku ?? "new"} product={editingProduct} open={editorOpen} onOpenChange={setEditorOpen} canWrite={canWrite} mode={mode} onSaved={saveLocal} /> : null}
    {downloadOpen ? <CatalogDownloadDialog products={selectedProducts} open={downloadOpen} onOpenChange={setDownloadOpen} /> : null}
  </>;
}
