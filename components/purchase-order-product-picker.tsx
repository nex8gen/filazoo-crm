"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useEffect, useState } from "react";
import { searchPurchaseOrderProducts } from "@/app/purchase-order-actions";
import { orderProductLine } from "@/lib/purchase-order-links";
import { productUnitPrice, type InvoiceProduct } from "@/lib/invoice-links";
import { formatMoney } from "@/lib/invoices";
import type { PurchaseOrderDocument } from "@/lib/purchase-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PurchaseOrderProductPicker({
  currency,
  disabled,
  onAdd,
}: {
  currency: string;
  disabled: boolean;
  onAdd: (
    item: PurchaseOrderDocument["items"][number],
    product: InvoiceProduct,
  ) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    products: InvoiceProduct[];
    count: number;
  } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const key = JSON.stringify([currency, search, page]);
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchPurchaseOrderProducts(search, page, currency)
        .then((data) => {
          if (!cancelled) setResult({ ...data, key });
        })
        .catch((error) => {
          if (!cancelled)
            setError({
              key,
              message:
                error instanceof Error
                  ? error.message
                  : "Unable to load catalog products.",
            });
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currency, search, page, key, disabled]);
  if (disabled) return null;
  const current = result?.key === key ? result : null;
  return (
    <section
      className="space-y-4 rounded-lg border bg-muted/20 p-4"
      aria-label="Product catalog"
    >
      <div>
        <h3 className="font-medium">Add from product catalog</h3>
        <p className="text-sm text-muted-foreground">
          Select a product and variant. SKU, image, minimum quantity, and
          quantity pricing come from Products.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="po-product-search">
          Search products by name or SKU
        </Label>
        <Input
          id="po-product-search"
          value={search}
          maxLength={100}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder={`Search ${currency} catalog`}
        />
      </div>
      {error?.key === key ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : !current ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading products…
        </p>
      ) : (
        <>
          <div className="grid max-h-96 gap-3 overflow-y-auto lg:grid-cols-2">
            {current.products.map((product) => (
              <ProductChoice
                key={`${currency}-${product.sku}`}
                product={product}
                onAdd={onAdd}
              />
            ))}
          </div>
          {!current.products.length && (
            <p className="text-sm text-muted-foreground">
              No active products match this currency and search. Try another
              search or add a custom item.
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              {current.count} products · Page {page + 1}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous products
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={(page + 1) * 25 >= current.count}
                onClick={() => setPage((value) => value + 1)}
              >
                Next products
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ProductChoice({
  product,
  onAdd,
}: {
  product: InvoiceProduct;
  onAdd: (
    item: PurchaseOrderDocument["items"][number],
    product: InvoiceProduct,
  ) => void;
}) {
  const [variantId, setVariantId] = useState(product.variants[0]?.id ?? "");
  const variant = product.variants.find((item) => item.id === variantId);
  const price = productUnitPrice(product, product.moq, variantId || undefined);
  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{product.name}</p>
          <p className="text-xs text-muted-foreground">
            {variant?.sku || product.sku} · MOQ {product.moq}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {variant?.stockStatus || product.stockStatus}
          </p>
        </div>
      </div>
      {product.variants.length > 0 && (
        <label className="grid gap-1 text-xs">
          Variant / color for {product.sku}
          <Select value={variantId} onValueChange={(value) => { if (value !== null) setVariantId(value); }}>
            <SelectTrigger size="sm" className="w-full min-w-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              {product.variants.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {price === null
            ? "Enter agreed price after adding"
            : `${formatMoney(price, product.currency)} / unit`}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onAdd(
              orderProductLine(product, product.moq, variantId || undefined),
              product,
            )
          }
        >
          Add product<span className="sr-only"> {product.name}</span>
        </Button>
      </div>
    </div>
  );
}
