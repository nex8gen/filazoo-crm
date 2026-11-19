"use client";

import Image from "next/image";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageIcon, Plus, Search, Trash2 } from "lucide-react";
import type { DataMode, ProductVariant } from "@/lib/types";
import { newProductVariant, variantOptionGroups, variantOptionsError, variantSettingsError, variantSwatch } from "@/lib/product-variants";
import { stockLabel } from "@/lib/product-inventory";
import { parseCurrencyAmount } from "@/lib/product-utils";
import { ProductVariantWorkspace } from "@/components/product-variant-workspace";
import { ProductOptionsEditor } from "@/components/product-options-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import "./product-variants-editor.css";

export function ProductVariantsEditor({ variants, onChange, sku, currency, basePrice, mediaUrls, disabled, mode, onBusyChange, productName = sku, productImage = null, sharedInventory = false, savedVariants = [] }: {
  variants: ProductVariant[];
  onChange: (variants: ProductVariant[]) => void;
  sku: string;
  currency: string;
  basePrice: string;
  mediaUrls: string[];
  disabled: boolean;
  mode: DataMode;
  onBusyChange: (busy: boolean) => void;
  productName?: string;
  productImage?: string | null;
  sharedInventory?: boolean;
  savedVariants?: Pick<ProductVariant, "id" | "sku">[];
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [workspace, setWorkspace] = useState<{ activeId: string; variants: ProductVariant[] } | null>(null);
  const editing = workspace?.variants.find(variant => variant.id === workspace.activeId) ?? null;
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [optionEditing, setOptionEditing] = useState(false);
  const groups = variantOptionGroups(variants);
  const [groupBy, setGroupBy] = useState<string | null>(() => groups.length > 1 ? groups[0].name : null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const root = useRef<HTMLElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousScroll = useRef(0);
  const workspaceOpen = workspace !== null;
  useEffect(() => {
    const surface = root.current?.closest<HTMLElement>(".product-profile-scroll");
    if (workspaceOpen) {
      if (surface) surface.scrollTop = 0;
      root.current?.querySelector<HTMLButtonElement>("[data-variant-back]")?.focus({ preventScroll: true });
    } else {
      if (surface) surface.scrollTop = previousScroll.current;
      previousFocus.current?.focus({ preventScroll: true });
    }
  }, [workspaceOpen]);
  const symbol = new Intl.NumberFormat("en", { style: "currency", currency }).formatToParts(0).find(part => part.type === "currency")?.value ?? currency;
  const visible = variants.filter(variant => (!query.trim() || `${variant.name} ${variant.sku}`.toLowerCase().includes(query.trim().toLowerCase())) && (source === "all" || (source === "connected" ? Boolean(variant.stock) : !variant.stock)));
  const selectedVariants = variants.filter(variant => selected.has(variant.id));
  const selectedVisible = visible.filter(variant => selected.has(variant.id)).length;
  const allVisible = visible.length > 0 && selectedVisible === visible.length;
  const activeGroup = groups.find(group => group.name === groupBy);
  const tableGroups = activeGroup ? activeGroup.values.map(value => ({
    key: JSON.stringify([activeGroup.name, value]), value,
    variants: visible.filter(variant => (variant.options ?? [{ name: "Color", value: variant.name }]).some(option => option.name === activeGroup.name && option.value === value)),
  })).filter(group => group.variants.length) : [{ key: "all", value: null, variants: visible }];

  function toggleSelection(items: ProductVariant[]) {
    setSelected(current => {
      const next = new Set(current), all = items.every(variant => next.has(variant.id));
      items.forEach(variant => all ? next.delete(variant.id) : next.add(variant.id));
      return next;
    });
  }
  function groupPrice(items: ProductVariant[]) {
    const amounts = items.map(variant => parseCurrencyAmount(variant.price));
    const money = (amount: number) => new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
    const low = Math.min(...amounts), high = Math.max(...amounts);
    return low === high ? money(low) : `${money(low)} – ${money(high)}`;
  }
  function groupStock(items: ProductVariant[]) {
    const amounts = items.map(variant => variant.stock?.available ?? variant.manualInventory);
    return amounts.every((quantity): quantity is number => typeof quantity === "number") ? amounts.reduce((sum, quantity) => sum + quantity, 0).toLocaleString("en") : "—";
  }

  function patch(id: string, changes: Partial<ProductVariant>) {
    onChange(variants.map(variant => variant.id === id ? { ...variant, ...changes } : variant));
  }
  function rememberProductView() {
    previousFocus.current = document.activeElement as HTMLElement | null;
    previousScroll.current = root.current?.closest<HTMLElement>(".product-profile-scroll")?.scrollTop ?? 0;
  }
  function edit(variant: ProductVariant) { if (optionEditing) return; rememberProductView(); setError(""); setAdding(false); setWorkspace({ activeId: variant.id, variants: variants.map(item => ({ ...item })) }); }
  function add() {
    if (disabled || optionEditing || variants.length >= 100) return;
    rememberProductView();
    setError(""); setAdding(true);
    const variant = newProductVariant(sku, variants, basePrice);
    if (sharedInventory) variant.sharedInventory = { locations: [] };
    if (variants[0]?.options) variant.options = variants[0].options.map(option => ({ ...option, value: "" }));
    setWorkspace({ activeId: variant.id, variants: [...variants.map(item => ({ ...item })), variant] });
  }
  function apply() {
    if (!workspace || disabled || imageBusy) return;
    for (const variant of workspace.variants) {
      const error = !variant.name.trim() || !variant.sku.trim() ? "Enter a variant name and SKU." : variantSettingsError(variant) ?? (variant.manualInventory != null && (!Number.isSafeInteger(variant.manualInventory) || variant.manualInventory < 0) ? "Enter a whole inventory quantity of zero or more." : null);
      if (error) { setError(error); setWorkspace({ ...workspace, activeId: variant.id }); return; }
    }
    if (new Set(workspace.variants.map(variant => variant.sku.trim().toUpperCase())).size !== workspace.variants.length) { setError("Each variant needs a unique SKU."); return; }
    const optionsError = variantOptionsError(workspace.variants);
    if (optionsError) { setError(optionsError); return; }
    onChange(workspace.variants.map(variant => ({ ...variant, name: variant.name.trim(), sku: variant.sku.trim() })));
    setWorkspace(null);
  }

  function renderVariant(variant: ProductVariant) {
    const index = variants.findIndex(item => item.id === variant.id);
    return <TableRow key={variant.id} data-variant-id={variant.id} data-grouped={Boolean(activeGroup) || undefined} data-selected={selected.has(variant.id) || undefined}>
      <TableCell><Checkbox aria-label={`Select variant ${variant.name || index + 1}`} checked={selected.has(variant.id)} onCheckedChange={() => toggleSelection([variant])} /></TableCell>
      <TableCell><Button type="button" variant="ghost" className="product-variant-identity" onClick={() => edit(variant)} disabled={disabled || optionEditing} aria-label={`Edit variant ${variant.name || index + 1}`}>
        <span className="product-variant-image">{variant.imageUrl ? <Image src={variant.imageUrl} alt="" width={40} height={40} unoptimized /> : <ImageIcon />}</span>
        <span className="product-variant-text"><span className="product-variant-name">{variant.name || "Name this variant"}</span><span className="product-variant-sku">{variant.sku || "Add SKU"}</span></span>
      </Button></TableCell>
      <TableCell><InputGroup className="product-variant-price"><InputGroupAddon aria-hidden="true">{symbol}</InputGroupAddon><InputGroupInput type="number" min="0" max="1000000" step="0.01" required aria-label={`Variant ${index + 1} price`} value={variant.price.replace(/[^0-9.-]/g, "")} onChange={event => patch(variant.id, { price: event.target.value })} disabled={disabled} /></InputGroup></TableCell>
      <TableCell>{variant.stock ? <span className={variant.stock.available < 0 ? "text-destructive" : ""} title={stockLabel(variant.stock)}>{variant.stock.available.toLocaleString("en")}</span> : sharedInventory ? <Button type="button" variant="link" size="sm" onClick={() => edit(variant)} disabled={disabled || optionEditing} aria-label={`Manage stock for ${variant.name}`}>{variant.manualInventory?.toLocaleString("en") ?? "Enter stock"}</Button> : <Input type="number" className="product-variant-quantity" min="0" max={Number.MAX_SAFE_INTEGER} step="1" aria-label={`Variant ${index + 1} available quantity`} placeholder="Not set" title="Manual inventory" value={variant.manualInventory ?? ""} onChange={event => patch(variant.id, { manualInventory: event.target.value === "" ? null : Number(event.target.value), stockStatus: event.target.value === "" ? "Stock unknown" : `${Number(event.target.value).toLocaleString("en")} available` })} disabled={disabled} />}</TableCell>
      <TableCell>{!disabled ? <Button type="button" variant="ghost" size="icon-sm" className="product-variant-remove" aria-label={`Remove variant ${variant.name || index + 1}`} disabled={optionEditing || variants.length === 1} onClick={() => { onChange(variants.filter(item => item.id !== variant.id)); setSelected(current => { const next = new Set(current); next.delete(variant.id); return next; }); }}><Trash2 /></Button> : null}</TableCell>
    </TableRow>;
  }

  return <section ref={root} className="product-variants-editor" aria-labelledby="product-variants-heading">
    <Card className="product-variants-card">
      <div className="product-variants-heading"><h3 id="product-variants-heading">Variants <span>{variants.length}</span></h3>{!disabled ? <Button type="button" size="sm" variant="outline" disabled={optionEditing || variants.length >= 100} onClick={add}><Plus />Add variant</Button> : null}</div>
      <ProductOptionsEditor variants={variants} onChange={onChange} sku={sku} disabled={disabled} onEditingChange={setOptionEditing} />
      {error && !workspace ? <p role="alert" className="variant-workspace-error">{error}</p> : null}

      <div className="product-variants-toolbar">
        <div className="product-variant-group-by"><span>Group by</span><Select value={activeGroup ? `option:${activeGroup.name}` : "all"} onValueChange={value => setGroupBy(value?.startsWith("option:") ? value.slice(7) : null)}><SelectTrigger size="sm" aria-label="Group variants by"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All variants</SelectItem>{groups.map(group => <SelectItem key={group.name} value={`option:${group.name}`}>{group.name}</SelectItem>)}</SelectContent></Select></div>
        {selectedVariants.length ? <div className="product-variant-selection"><span role="status">{selectedVariants.length} selected</span><Button type="button" size="xs" variant="ghost" disabled={disabled || optionEditing || selectedVariants.length === variants.length} onClick={() => { onChange(variants.filter(variant => !selected.has(variant.id))); setSelected(new Set()); }}><Trash2 />Remove selected</Button></div> : null}
        <div className="product-variant-filters"><InputGroup className="product-variant-search"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput type="search" aria-label="Search variants" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} placeholder="Search variants" /></InputGroup><Select value={source} onValueChange={value => setSource(value ?? "all")}><SelectTrigger aria-label="Filter variant inventory" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All inventory</SelectItem><SelectItem value="connected">Connected inventory</SelectItem><SelectItem value="manual">Manual inventory</SelectItem></SelectContent></Select></div>
      </div>

      <div className="product-variants-table-scroll"><Table className="product-variants-table">
        <TableCaption className="sr-only">Product variants with prices and available inventory</TableCaption>
        <colgroup><col className="product-variant-check-column" /><col /><col className="product-variant-price-column" /><col className="product-variant-stock-column" /><col className="product-variant-action-column" /></colgroup>
        <TableHeader><TableRow><TableHead><Checkbox aria-label="Select visible variants" checked={allVisible} indeterminate={selectedVisible > 0 && !allVisible} disabled={!visible.length} onCheckedChange={() => setSelected(current => { const next = new Set(current); visible.forEach(variant => allVisible ? next.delete(variant.id) : next.add(variant.id)); return next; })} /></TableHead><TableHead>Variant</TableHead><TableHead>Price <span className="product-variant-currency">{currency}</span></TableHead><TableHead>Available</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
        <TableBody>{tableGroups.map(group => <Fragment key={group.key}>
          {group.value !== null ? <TableRow data-variant-group={group.value} className="product-variant-group-row">
            <TableCell><Checkbox aria-label={`Select ${activeGroup!.name} ${group.value} variants`} checked={group.variants.every(variant => selected.has(variant.id))} indeterminate={group.variants.some(variant => selected.has(variant.id)) && !group.variants.every(variant => selected.has(variant.id))} onCheckedChange={() => toggleSelection(group.variants)} /></TableCell>
            <TableCell><Button type="button" variant="ghost" className="product-variant-group-toggle" aria-label={`${expandedGroups.has(group.key) ? "Collapse" : "Expand"} ${group.value} variants`} aria-expanded={expandedGroups.has(group.key)} onClick={() => setExpandedGroups(current => { const next = new Set(current); if (!next.delete(group.key)) next.add(group.key); return next; })}><ChevronRight className={expandedGroups.has(group.key) ? "rotate-90" : ""} />{activeGroup!.name.toLowerCase() === "color" ? <span className="product-color-swatch" style={{ backgroundColor: variantSwatch({ name: group.value, colorHex: group.variants[0]?.colorHex }) ?? "var(--muted)" }} /> : null}<span>{group.value}<small>{group.variants.length} {group.variants.length === 1 ? "variant" : "variants"}</small></span></Button></TableCell>
            <TableCell><span className="product-variant-group-price">{groupPrice(group.variants)}</span></TableCell><TableCell>{groupStock(group.variants)}</TableCell><TableCell />
          </TableRow> : null}
          {group.value === null || expandedGroups.has(group.key) ? group.variants.map(renderVariant) : null}
        </Fragment>)}{!visible.length ? <TableRow><TableCell colSpan={5} className="product-variants-empty">No variants match your filters.</TableCell></TableRow> : null}</TableBody>
      </Table></div>
    </Card>

    {editing && workspace ? <div className="variant-workspace-inline" role="region" aria-label="Variant settings" aria-busy={imageBusy} onKeyDownCapture={event => {
      if ((event.target as HTMLElement).closest('[data-slot="select-content"], [data-slot="dialog-content"]')) return;
      if (event.key === "Escape" && event.currentTarget.querySelector('[data-slot="select-trigger"][aria-expanded="true"]')) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!imageBusy) setWorkspace(null); }
      if (event.key === "Enter" && ["INPUT", "SELECT"].includes((event.target as HTMLElement).tagName)) event.preventDefault();
    }}>
      <header className="variant-workspace-header">
        <Button type="button" variant="ghost" size="sm" className="variant-workspace-back" data-variant-back aria-label={`Back from ${editing.name || (adding ? "new variant" : "variant")}`} disabled={imageBusy} onClick={apply}>
          <ChevronLeft aria-hidden="true" />
          <span className="variant-workspace-back-text" aria-hidden="true">
            <span className="variant-workspace-back-name">{editing.name || (adding ? "Add variant" : "Edit variant")}</span>
            <span className="variant-workspace-back-action">Back</span>
          </span>
        </Button>
      </header>
      <ProductVariantWorkspace variant={editing} variants={workspace.variants} productName={productName} productImage={productImage} productSku={sku} sharedInventory={sharedInventory} persisted={savedVariants.some(variant => variant.id === editing.id && variant.sku === editing.sku)} onStockChange={stock => {
        patch(editing.id, stock);
        setWorkspace(current => current ? { ...current, variants: current.variants.map(variant => variant.sku === editing.sku ? { ...variant, ...stock } : variant) } : null);
      }} currency={currency} mediaUrls={mediaUrls} disabled={disabled} mode={mode} onSelect={activeId => { setWorkspace(current => current ? { ...current, activeId } : null); setError(""); }} onChange={patch => setWorkspace(current => current ? { ...current, variants: current.variants.map(variant => variant.id === current.activeId ? { ...variant, ...patch } : variant) } : null)} onBusyChange={busy => { setImageBusy(busy); onBusyChange(busy); }} />
      {error ? <p role="alert" className="variant-workspace-error">{error}</p> : null}
      <footer className="variant-workspace-footer"><Button type="button" variant="outline" disabled={imageBusy} onClick={() => setWorkspace(null)}>Cancel</Button><Button type="button" disabled={disabled || imageBusy} onClick={apply}>{adding ? "Add variant" : "Apply changes"}</Button></footer>
    </div> : null}
  </section>;
}
