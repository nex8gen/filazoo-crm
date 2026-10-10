"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Box, ChevronLeft, ChevronRight, Clipboard, Download, FileDown, ImageIcon, Plus, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { createProduct, type CrmActionState } from "@/app/crm-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Product } from "@/lib/types";

const pageSize = 20;

function formatUpdatedAt(value: string | null) {
  if (!value) return "Not synced";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function AddProductDialog({ canWrite }: { canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (previousState: CrmActionState, formData: FormData) => {
    const result = await createProduct(previousState, formData);
    if (result?.success) {
      toast.success(result.success);
      setOpen(false);
    }
    return result;
  }, undefined);

  return (
    <>
      <Button size="sm" disabled={!canWrite} title={canWrite ? "Add a product" : "Viewer access is read-only"} onClick={() => setOpen(true)}><Plus />Add product</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Add product</DialogTitle><DialogDescription>Add specifications, color variants, up to three volume-price tiers, and an optional image URL.</DialogDescription></DialogHeader>
          <form action={action} className="grid gap-4 sm:grid-cols-2">
            <Field label="Product name" id="product-name"><Input id="product-name" name="name" required autoFocus /></Field>
            <Field label="SKU" id="product-sku"><Input id="product-sku" name="sku" placeholder="PLA-CUSTOM" required /></Field>
            <Field label="Material" id="product-material"><Input id="product-material" name="material" placeholder="PLA" required /></Field>
            <Field label="Colors" id="product-colors"><Input id="product-colors" name="colors" placeholder="Black, White, Red" required /></Field>
            <Field label="Diameter" id="product-diameter"><Input id="product-diameter" name="diameter" placeholder="1.75 mm" /></Field>
            <Field label="Pack weight" id="product-weight"><Input id="product-weight" name="weight" placeholder="1 kg" /></Field>
            <Field label="Stock status" id="product-stock"><Input id="product-stock" name="stockStatus" placeholder="In stock" /></Field>
            <Field label="Lead time" id="product-lead"><Input id="product-lead" name="leadTime" placeholder="Ships in 3–5 days" /></Field>
            <div className="sm:col-span-2"><Field label="Image URL (optional)" id="product-image"><Input id="product-image" name="imageUrl" type="url" placeholder="https://..." /></Field></div>
            <div className="sm:col-span-2 border-t pt-4"><div className="flex items-end justify-between"><div><p className="text-sm font-medium">Volume pricing</p><p className="text-xs text-muted-foreground">Tier one is required; add tiers two and three when available.</p></div><label className="space-y-1 text-xs text-muted-foreground">Currency<select name="currency" defaultValue="USD" className="ml-2 h-8 rounded-md border bg-background px-2 text-foreground"><option>USD</option><option>EUR</option><option>GBP</option><option>CNY</option></select></label></div></div>
            {[1, 2, 3].map((tier) => (
              <div key={tier} className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 sm:col-span-2">
                <Field label={`Tier ${tier} minimum`} id={`minimum-${tier}`}><Input id={`minimum-${tier}`} name={`minimum${tier}`} type="number" min="1" required={tier === 1} /></Field>
                <Field label={`Tier ${tier} unit price`} id={`price-${tier}`}><Input id={`price-${tier}`} name={`price${tier}`} type="number" min="0" step="0.01" required={tier === 1} /></Field>
              </div>
            ))}
            {state?.error ? <p role="alert" className="text-xs text-destructive sm:col-span-2">{state.error}</p> : null}
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add product"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProductsCatalog({ products, canWrite }: { products: Product[]; canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [material, setMaterial] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const materials = useMemo(() => [...new Set(products.map((product) => product.material))].sort(), [products]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesQuery = !normalizedQuery || [product.name, product.sku, product.material, ...product.colors].some((value) => value.toLowerCase().includes(normalizedQuery));
      return matchesQuery && (material === "all" || product.material === material) && (status === "all" || product.status === status);
    });
  }, [material, products, query, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleProducts = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => setPage(1), [query, material, status]);
  useEffect(() => setPage((current) => Math.min(current, pages)), [pages]);

  const exportCsv = () => {
    const fields = ["Name", "SKU", "Material", "Colors", "Volume pricing", "Stock", "Lead time", "Status", "Image URL"];
    const rows = filtered.map((product) => [product.name, product.sku, product.material, product.colors.join(" | "), product.priceTiers.map((tier) => `${tier.minimumQuantity}+ ${tier.price}`).join(" | "), product.stockStatus, product.leadTime, product.status, product.imageUrl || ""]);
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const csv = [fields, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `filazoo-products-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} products exported.`);
  };

  const copySku = async (sku: string) => {
    await navigator.clipboard.writeText(sku);
    toast.success(`${sku} copied.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" placeholder="Search name, SKU, material, or color…" aria-label="Search products" /></div>
        <div className="flex flex-wrap items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" />
          <select value={material} onChange={(event) => setMaterial(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Filter by material"><option value="all">All materials</option>{materials.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Filter by status"><option value="all">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!filtered.length}><Download />CSV</Button>
          <Button nativeButton={false} size="sm" variant="outline" render={<a href="/downloads/filazoo-b2b-catalog.pdf" download />}><FileDown />Catalog PDF</Button>
          <AddProductDialog canWrite={canWrite} />
        </div>
      </div>

      <Card className="gap-0 py-0 shadow-none">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="min-w-72 pl-4">Product</TableHead><TableHead>Specifications</TableHead><TableHead className="min-w-64">EXW volume pricing</TableHead><TableHead>Availability</TableHead><TableHead>Status</TableHead><TableHead className="pr-4 text-right">Options</TableHead></TableRow></TableHeader>
          <TableBody>
            {visibleProducts.map((product) => (
              <TableRow key={product.sku}>
                <TableCell className="pl-4"><div className="flex items-center gap-3"><div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/50">{product.imageUrl ? <><img src={product.imageUrl} alt="" width={48} height={48} className="size-full object-cover" /></> : <ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" />}</div><div className="min-w-0"><p className="truncate font-medium">{product.name}</p><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{product.sku}</p></div></div></TableCell>
                <TableCell><div className="max-w-64 space-y-1"><p className="font-medium">{product.material} · {product.color}</p>{product.colors.length ? <p className="truncate text-xs text-muted-foreground" title={product.colors.join(", ")}>{product.colors.join(" · ")}</p> : null}{product.weight !== "Not specified" && product.weight !== "—" ? <p className="text-xs text-muted-foreground">Pack weight: {product.weight}</p> : null}</div></TableCell>
                <TableCell>{product.priceTiers.length ? <div className="flex flex-wrap gap-1.5">{product.priceTiers.map((tier) => <span key={`${tier.minimumQuantity}-${tier.price}`} className="rounded-md border bg-muted/40 px-2 py-1 text-xs"><span className="text-muted-foreground">{tier.minimumQuantity}+</span> <span className="font-medium">{tier.price}</span></span>)}</div> : <span className="text-muted-foreground">Price unavailable</span>}</TableCell>
                <TableCell><div className="flex items-start gap-2"><Box className="mt-0.5 size-3.5 text-muted-foreground" /><div><p>{product.stockStatus}</p><p className="mt-0.5 text-xs text-muted-foreground">{product.leadTime}</p></div></div></TableCell>
                <TableCell><Badge variant={product.status === "Active" ? "secondary" : "outline"}>{product.status}</Badge></TableCell>
                <TableCell className="pr-4"><div className="flex items-center justify-end gap-1"><span className="mr-2 text-xs text-muted-foreground">{formatUpdatedAt(product.updatedAt)}</span><Button variant="ghost" size="icon-sm" aria-label={`Copy ${product.sku}`} title="Copy SKU" onClick={() => copySku(product.sku)}><Clipboard /></Button></div></TableCell>
              </TableRow>
            ))}
            {!visibleProducts.length ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">No products match these filters.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </Card>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>Showing {visibleProducts.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} products</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft />Previous</Button><span>Page {page} of {pages}</span><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight /></Button></div></div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}
