"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import type { DataMode, ProductVariant } from "@/lib/types";
import { variantOptionGroups, variantPriceSummary, variantSwatch } from "@/lib/product-variants";
import { stockLabel } from "@/lib/product-inventory";
import { ProductImagePicker } from "@/components/product-image-picker";
import { ProductSharedStock } from "@/components/product-shared-stock";
import { manualStockTotal } from "@/lib/shared-product-inventory";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ProductVariantWorkspace({ variant, variants, onChange, onSelect, productName, productImage, currency, mediaUrls, disabled, mode, onBusyChange, productSku, sharedInventory, persisted, onStockChange }: {
  variant: ProductVariant; variants: ProductVariant[]; onChange: (patch: Partial<ProductVariant>) => void; onSelect: (id: string) => void;
  productName: string; productImage: string | null; currency: string; mediaUrls: string[]; disabled: boolean; mode: DataMode; onBusyChange: (busy: boolean) => void;
  productSku: string; sharedInventory: boolean; persisted: boolean; onStockChange: (patch: Partial<ProductVariant>) => void;
}) {
  const [query, setQuery] = useState("");
  const money = (value: number) => new Intl.NumberFormat("en", { style: "currency", currency }).format(value);
  const summary = variantPriceSummary(variant);
  const visible = variants.filter(item => `${item.name} ${item.sku} ${item.barcode ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const unit = variant.unitPricing;
  const numeric = (value: string | null | undefined) => value?.replace(/[^0-9.-]/g, "") ?? "";

  return <div className="variant-workspace">
    <aside className="variant-workspace-sidebar" aria-label="Product variants">
      <div className="variant-workspace-product">{productImage ? <Image src={productImage} alt="" width={40} height={40} unoptimized /> : <ImageIcon />}<div><strong title={productName}>{productName}</strong><span>{variants.length} variant{variants.length === 1 ? "" : "s"}</span></div></div>
      <InputGroup className="variant-workspace-search"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput type="search" aria-label="Search variant details" placeholder="Search variants" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></InputGroup>
      <nav aria-label="Choose variant">{visible.map(item => <Button type="button" variant="ghost" key={item.id} title={`${item.name || "Untitled variant"} · ${item.sku}`} aria-current={item.id === variant.id ? "true" : undefined} disabled={disabled} onClick={() => onSelect(item.id)}>{item.imageUrl ? <Image src={item.imageUrl} alt="" width={36} height={36} unoptimized /> : <span className="product-color-swatch" style={{ backgroundColor: variantSwatch(item) ?? "var(--muted)" }} />}<span className="variant-workspace-nav-text"><span className="variant-workspace-nav-name">{item.name || "Untitled variant"}</span><small>{item.sku}</small></span></Button>)}{!visible.length ? <p className="text-xs text-muted-foreground">No variants match.</p> : null}</nav>
    </aside>

    <div className="variant-workspace-main">
      <Card role="region" className="variant-settings-card" aria-label="Variant identity">
        <div className="variant-workspace-identity">{variant.imageUrl ? <Image src={variant.imageUrl} alt="Variant image" width={80} height={80} unoptimized /> : <span className="variant-workspace-image"><ImageIcon /></span>}<div><h3>{variant.name || "Untitled variant"}</h3><p>{variant.sku}</p></div></div>
        <div className="product-variant-dialog-fields">{variant.options ? variant.options.map((option, index) => <div className="space-y-2" key={option.name}><Label htmlFor={`variant-option-${index}`}>{option.name}</Label><Input id={`variant-option-${index}`} list={`variant-values-${index}`} value={option.value} maxLength={120} onChange={event => { const options = variant.options!.map((item, position) => position === index ? { ...item, value: event.target.value } : item); onChange({ options, name: options.map(item => item.value).join(" / ") }); }} disabled={disabled} /><datalist id={`variant-values-${index}`}>{variantOptionGroups(variants)[index]?.values.map(value => <option key={value} value={value} />)}</datalist></div>) : <div className="space-y-2"><Label htmlFor="variant-edit-name">Color</Label><Input id="variant-edit-name" value={variant.name} maxLength={120} onChange={event => onChange({ name: event.target.value })} disabled={disabled} /></div>}<div className="space-y-2"><Label htmlFor="variant-edit-swatch">Swatch</Label><Input id="variant-edit-swatch" type="color" value={variantSwatch(variant) ?? "#cbd5e1"} onChange={event => onChange({ colorHex: event.target.value })} disabled={disabled} /></div></div>
      </Card>

      <Card role="region" className="variant-settings-card" aria-labelledby="variant-pricing-heading"><h3 id="variant-pricing-heading">Price</h3>
        <div className="product-variant-dialog-fields"><div className="space-y-2"><Label htmlFor="variant-edit-price">Selling price ({currency})</Label><Input id="variant-edit-price" type="number" min="0" max="1000000" step="0.01" value={numeric(variant.price)} onChange={event => onChange({ price: event.target.value })} disabled={disabled} /></div><div className="space-y-2"><Label htmlFor="variant-compare-price">Compare-at price</Label><Input id="variant-compare-price" type="number" min="0" max="1000000" step="0.01" placeholder="Not set" value={numeric(variant.compareAtPrice)} onChange={event => onChange({ compareAtPrice: event.target.value || null })} disabled={disabled} /></div></div>
        <div className="product-variant-dialog-fields"><div className="space-y-2"><Label htmlFor="variant-cost">Cost per item ({currency})</Label><Input id="variant-cost" type="number" min="0" max="1000000" step="0.01" placeholder="Not set" value={numeric(variant.costPerItem)} onChange={event => onChange({ costPerItem: event.target.value || null })} disabled={disabled} /><p className="text-xs text-muted-foreground">Internal cost. Excluded from customer PDFs and order lines.</p></div><dl className="variant-margin"><div><dt>Profit per item</dt><dd>{summary.profit === null ? "—" : money(summary.profit)}</dd></div><div><dt>Margin</dt><dd className={summary.margin !== null && summary.margin < 0 ? "text-destructive" : ""}>{summary.margin === null ? "—" : `${summary.margin.toFixed(1)}%`}</dd></div></dl></div>
        <div className="variant-unit-pricing"><div className="variant-setting-toggle"><Checkbox id="variant-unit-pricing" checked={Boolean(unit)} disabled={disabled} onCheckedChange={checked => onChange({ unitPricing: checked ? { quantity: 1, referenceQuantity: 1, unit: "kg" } : null })} /><Label htmlFor="variant-unit-pricing">Show unit price</Label></div>
          {unit ? <><div className="variant-unit-fields"><div className="space-y-2"><Label htmlFor="variant-package-quantity">Package quantity</Label><Input id="variant-package-quantity" type="number" min="0.000001" max="1000000" step="any" value={unit.quantity || ""} onChange={event => onChange({ unitPricing: { ...unit, quantity: Number(event.target.value) } })} disabled={disabled} /></div><div className="space-y-2"><Label htmlFor="variant-reference-quantity">Price per</Label><Input id="variant-reference-quantity" type="number" min="0.000001" max="1000000" step="any" value={unit.referenceQuantity || ""} onChange={event => onChange({ unitPricing: { ...unit, referenceQuantity: Number(event.target.value) } })} disabled={disabled} /></div><div className="space-y-2"><Label htmlFor="variant-unit">Unit</Label><Select value={unit.unit} onValueChange={value => { if (value) onChange({ unitPricing: { ...unit, unit: value as NonNullable<ProductVariant["unitPricing"]>["unit"] } }); }} disabled={disabled}><SelectTrigger id="variant-unit" aria-label="Unit" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["g", "kg", "ml", "l", "cm", "m", "item"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div></div><p className="variant-unit-preview">{summary.unitPrice === null ? "Enter package and reference quantities." : `${money(summary.unitPrice)} / ${unit.referenceQuantity} ${unit.unit}`}</p></> : null}
        </div>
      </Card>

      <Card role="region" className="variant-settings-card" aria-labelledby="variant-inventory-heading"><h3 id="variant-inventory-heading">Inventory</h3>
        {variant.stock ? <><p className="text-xs text-muted-foreground" title={variant.stock.syncedAt}>{stockLabel(variant.stock)} · Connected inventory</p><div className="variant-stock-summary"><div><span>On hand</span><strong>{variant.stock.onHand.toLocaleString("en")}</strong></div><div><span>Locked</span><strong>{variant.stock.locked.toLocaleString("en")}</strong></div><div><span>Available</span><strong>{variant.stock.available.toLocaleString("en")}</strong></div></div>{variant.stock.warehouseIds.length ? <p className="text-xs text-muted-foreground">Warehouse IDs: {variant.stock.warehouseIds.join(", ")}</p> : null}</> : sharedInventory ? <ProductSharedStock key={variant.sku} productSku={productSku} sku={variant.sku} stock={variant.sharedInventory ?? { locations: [] }} onChange={stock => onStockChange({ sharedInventory: stock, manualInventory: manualStockTotal(stock) })} disabled={disabled} persisted={persisted} onBusyChange={onBusyChange} /> : <div className="space-y-2"><Label htmlFor="variant-edit-quantity">Available quantity</Label><Input id="variant-edit-quantity" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" placeholder="Not set" value={variant.manualInventory ?? ""} onChange={event => onChange({ manualInventory: event.target.value === "" ? null : Number(event.target.value), stockStatus: event.target.value === "" ? "Stock unknown" : `${Number(event.target.value).toLocaleString("en")} available` })} disabled={disabled} /></div>}
      </Card>

      <Card role="region" className="variant-settings-card" aria-labelledby="variant-identifiers-heading"><h3 id="variant-identifiers-heading">Identifiers</h3><div className="space-y-2"><Label htmlFor="variant-edit-sku">SKU</Label><Input id="variant-edit-sku" value={variant.sku} maxLength={120} onChange={event => onChange({ sku: event.target.value, ...(sharedInventory ? { sharedInventory: { locations: [] }, manualInventory: null, stock: undefined } : {}) })} disabled={disabled} /></div><div className="space-y-2"><Label htmlFor="variant-barcode">Barcode</Label><Input id="variant-barcode" value={variant.barcode ?? ""} maxLength={100} placeholder="ISBN, UPC, GTIN, or another barcode" onChange={event => onChange({ barcode: event.target.value || null })} disabled={disabled} /></div></Card>

      <Card role="region" className="variant-settings-card" aria-labelledby="variant-media-heading"><h3 id="variant-media-heading">Media</h3>{mediaUrls.length ? <div className="product-variant-media">{mediaUrls.map((url, index) => <Button type="button" variant="outline" className="p-0" key={url} aria-label={`Choose product image ${index + 1} for variant`} aria-pressed={variant.imageUrl === url} disabled={disabled} onClick={() => onChange({ imageUrl: url })}><Image src={url} alt="" width={64} height={64} unoptimized /></Button>)}</div> : null}<ProductImagePicker id="variant-edit-image" label="Variant image" value={variant.imageUrl} onChange={imageUrl => onChange({ imageUrl })} disabled={disabled} mode={mode} onBusyChange={onBusyChange} /></Card>
    </div>
  </div>;
}
