"use client";

import { Fragment, useEffect, useState } from "react";
import Image from "next/image";
import { Package2, Search } from "lucide-react";
import { searchPurchaseOrderProducts } from "@/app/purchase-order-actions";
import { orderProductChoices } from "@/lib/purchase-order-draft";
import { formatMoney } from "@/lib/invoices";
import type { InvoiceProduct } from "@/lib/invoice-links";
import type { PurchaseOrderDocument } from "@/lib/purchase-orders";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PurchaseOrderProductDialog({ currency, existingKeys, limit, onClose, onAdd }: {
  currency: string;
  existingKeys: Set<string>;
  limit: number;
  onClose: () => void;
  onAdd: (choices: { item: PurchaseOrderDocument["items"][number]; product: InvoiceProduct }[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState(new Map<string, { item: PurchaseOrderDocument["items"][number]; product: InvoiceProduct }>());
  const [result, setResult] = useState<{ key: string; products: InvoiceProduct[]; count: number } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const key = JSON.stringify([currency, search, page, retry]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      searchPurchaseOrderProducts(search, page, currency).then(result => { if (active) setResult({ ...result, key }); })
        .catch(() => { if (active) setError({ key, message: "Products could not be loaded. Please try again." }); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [currency, search, page, retry, key]);
  const current = result?.key === key ? result : null;
  function toggle(product: InvoiceProduct, keys: string[], checked: boolean) {
    setSelected(previous => {
      const next = new Map(previous);
      for (const choice of orderProductChoices(product).filter(choice => keys.includes(choice.key))) {
        if (!checked) next.delete(choice.key);
        else if (choice.price !== null && !existingKeys.has(choice.key) && next.size < limit) next.set(choice.key, { item: choice.item, product });
      }
      return next;
    });
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex max-h-[min(820px,90dvh)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[640px]">
      <DialogHeader className="border-b p-5 pr-12"><DialogTitle>Select products</DialogTitle><DialogDescription className="sr-only">Choose products and variants to add to this purchase order.</DialogDescription></DialogHeader>
      <div className="border-b p-4"><div className="relative"><Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden /><Input autoFocus value={search} maxLength={100} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder="Search products by name or SKU" aria-label="Search products" className="pl-9" /></div><p className="mt-2 text-xs text-muted-foreground">{currency} · Select variants at their minimum order quantity.</p></div>
      <div className="grid grid-cols-[minmax(0,1fr)_90px_90px] gap-2 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground"><span>Product</span><span>Availability</span><span className="text-right">Price</span></div>
      <div className="min-h-48 flex-1 overflow-y-auto px-4">
        {error?.key === key ? <div role="alert" className="space-y-3 py-10 text-center"><p className="text-sm text-destructive">{error.message}</p><Button variant="outline" onClick={() => setRetry(value => value + 1)}>Try again</Button></div> : !current ? <p role="status" className="py-10 text-center text-sm text-muted-foreground">Loading products...</p> : current.products.length ? current.products.map(product => {
          const choices = orderProductChoices(product);
          const selectable = choices.filter(choice => choice.price !== null && !existingKeys.has(choice.key));
          const checked = selectable.length > 0 && selectable.every(choice => selected.has(choice.key));
          return <Fragment key={product.sku}>
            <div className="flex items-center gap-3 border-b py-3"><Checkbox aria-label={`Select all variants of ${product.name}`} checked={checked} disabled={!selectable.length || (!checked && selected.size >= limit)} onCheckedChange={value => toggle(product, selectable.map(choice => choice.key), value === true)} />{product.imageUrl ? <Image src={product.imageUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded-lg border object-cover" /> : <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-muted"><Package2 className="size-5 text-muted-foreground" /></div>}<div className="min-w-0"><p className="text-sm font-medium">{product.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{product.sku} · MOQ {product.moq}</p></div></div>
            {choices.map(choice => {
              const added = existingKeys.has(choice.key);
              return <label key={choice.key} className="grid cursor-pointer grid-cols-[minmax(0,1fr)_90px_90px] items-center gap-2 border-b py-3 pl-8 text-sm hover:bg-muted/20"><span className="flex min-w-0 items-center gap-3"><Checkbox checked={added || selected.has(choice.key)} disabled={added || choice.price === null || (!selected.has(choice.key) && selected.size >= limit)} onCheckedChange={value => toggle(product, [choice.key], value === true)} aria-label={`Select ${product.name} ${choice.variant?.name ?? ""}`} /><span className="truncate">{choice.variant?.name || product.name}{added ? <span className="ml-1 text-xs text-muted-foreground">(added)</span> : null}</span></span><span className="truncate text-xs text-muted-foreground" title={choice.variant?.stockStatus || product.stockStatus}>{choice.variant?.stockStatus || product.stockStatus}</span><span className="text-right text-xs tabular-nums">{choice.price === null ? "Quote required" : formatMoney(choice.price, currency)}</span></label>;
            })}
          </Fragment>;
        }) : <p className="py-10 text-center text-sm text-muted-foreground">No products match this search and currency.</p>}
      </div>
      {current && current.count > 25 ? <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground"><span>Page {page + 1} of {Math.ceil(current.count / 25)}</span><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous</Button><Button variant="ghost" size="sm" disabled={(page + 1) * 25 >= current.count} onClick={() => setPage(value => value + 1)}>Next</Button></div></div> : null}
      <div className="flex items-center justify-between gap-3 border-t p-4"><span role="status" className="text-xs text-muted-foreground">{selected.size}/{limit} variants selected</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!selected.size} onClick={() => onAdd([...selected.values()])}>Add</Button></div></div>
    </DialogContent>
  </Dialog>;
}
