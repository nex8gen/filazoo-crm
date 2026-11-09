"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowUpRight, CalendarDays, CheckCheck, ChevronLeft, ChevronRight, Factory, FileText, Gift, Megaphone, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarketingAssetEditor } from "@/components/marketing-asset-editor";
import { marketingAssetText, marketingCategoryLabels, marketingDateRange, holidaySlots, monthEndSlots, monthNames, newMarketingAsset, type MarketingAsset, type MarketingCategory, type MarketingProduct, type MarketingSlot } from "@/lib/marketing-assets";

const categories = [{ id: "month_end", icon: CalendarDays }, { id: "holiday", icon: Gift }, { id: "factory_sale", icon: Factory }] as const;
type StatusFilter = "all" | "draft" | "ready" | "unplanned";

export function MarketingAssetsWorkspace({ year, initialAssets, products, canWrite, loadError }: {
  year: number; initialAssets: MarketingAsset[]; products: MarketingProduct[]; canWrite: boolean; loadError?: string;
}) {
  const router = useRouter();
  const [assets, setAssets] = useState(initialAssets);
  const [previousAssets, setPreviousAssets] = useState(initialAssets);
  const [category, setCategory] = useState<MarketingCategory>("month_end");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editing, setEditing] = useState<MarketingAsset | null>(null);
  // Accept refreshed server records without remounting an unsaved editor.
  if (previousAssets !== initialAssets) {
    setPreviousAssets(initialAssets);
    setAssets(initialAssets);
  }
  const slots = category === "month_end" ? monthEndSlots(year) : category === "holiday" ? holidaySlots(year) : [];
  const currentAssets = assets.filter(asset => asset.category === category);
  const ready = assets.filter(asset => asset.status === "ready").length;
  const draftCount = assets.length - ready;
  const matches = (asset: MarketingAsset | undefined, title: string) => (filter === "all" || (filter === "unplanned" ? !asset : asset?.status === filter)) && `${title} ${asset?.title ?? ""} ${asset?.offer ?? ""} ${asset?.audience ?? ""}`.toLowerCase().includes(query.toLowerCase());
  const shownSlots = slots.filter(slot => matches(currentAssets.find(asset => asset.slot === slot.key), slot.title));
  const shownSales = currentAssets.filter(asset => matches(asset, asset.title));
  const canEdit = canWrite && !loadError;

  function open(slot?: MarketingSlot) {
    const existing = slot ? currentAssets.find(asset => asset.slot === slot.key) : undefined;
    if (!existing && !canEdit) return;
    setEditing(existing ?? newMarketingAsset(category, year, slot));
  }
  function create() {
    const next = slots.find(slot => !currentAssets.some(asset => asset.slot === slot.key));
    if (category !== "factory_sale" && !next) { open(slots[0]); return; }
    open(next);
  }
  function exportPlans() {
    const content = assets.map(asset => marketingAssetText(asset, products)).join("\n\n" + "─".repeat(48) + "\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `marketing-plans-${year}.txt`; link.click(); URL.revokeObjectURL(url);
  }
  function status(asset?: MarketingAsset) {
    return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${asset?.status === "ready" ? "bg-brand-soft text-primary" : asset ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${asset?.status === "ready" ? "bg-primary" : asset ? "bg-amber-500" : "bg-muted-foreground/40"}`} />{asset?.status === "ready" ? "Ready" : asset ? "Draft" : "Not planned"}</span>;
  }
  function slotRow(slot: MarketingSlot) {
    const asset = currentAssets.find(asset => asset.slot === slot.key);
    return <button key={slot.key} type="button" disabled={!asset && !canEdit} onClick={() => open(slot)} className="group flex w-full items-center gap-3 border-t px-5 py-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:opacity-60">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${asset ? "bg-brand-soft text-primary" : "bg-muted/70 text-muted-foreground"}`}>{category === "month_end" ? monthNames[slot.month - 1].slice(0, 3).toUpperCase() : <Gift className="size-4" />}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{asset?.title ?? (category === "month_end" ? monthNames[slot.month - 1] : slot.title)}</span><span className="mt-1 block text-xs text-muted-foreground">{marketingDateRange(asset?.startDate ?? slot.startDate, asset?.endDate ?? slot.endDate)}{asset?.productSkus.length ? ` · ${asset.productSkus.length} product${asset.productSkus.length > 1 ? "s" : ""}` : ""}</span></span>
      {status(asset)}<ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
    </button>;
  }
  return <div className="mx-auto flex max-w-[1440px] flex-col gap-6 pb-12 pt-4 sm:pt-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-primary">Your campaign workspace</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Make every promotion count.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Plan the moment, shape the offer, and keep your marketing assets in one place.</p></div>
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={!assets.length} onClick={exportPlans}><ArrowDownToLine />Export plans</Button><Button size="sm" disabled={!canEdit} onClick={create}><Plus />New promotion</Button></div>
    </header>

    {loadError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="text-destructive">{loadError}</p><Button variant="outline" size="sm" onClick={() => router.refresh()}>Try again</Button></div> : null}

    <section aria-label="Marketing overview" className="grid grid-cols-1 divide-y rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {[{ label: "Promotions planned", count: assets.length, icon: Megaphone, detail: `Across your ${year} calendar` }, { label: "In progress", count: draftCount, icon: FileText, detail: "Offers taking shape" }, { label: "Ready to use", count: ready, icon: CheckCheck, detail: "Reviewed and ready for your team" }].map(item => <div key={item.label} className="flex items-start gap-4 p-5"><span className="mt-1 flex size-10 items-center justify-center rounded-lg border bg-muted/20"><item.icon aria-hidden="true" className={`size-[18px] ${item.label === "Ready to use" ? "text-primary" : "text-muted-foreground"}`} /></span><div><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{loadError ? "—" : item.count}</p><p className="mt-1 text-xs text-muted-foreground">{item.detail}</p></div></div>)}
    </section>

    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b">
      <div role="tablist" aria-label="Promotion type" className="-mb-px flex max-w-full gap-4 overflow-x-auto sm:gap-7">{categories.map(item => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-controls="marketing-calendar" aria-selected={category === item.id} type="button" onClick={() => { setCategory(item.id); setFilter("all"); }} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const index = categories.findIndex(value => value.id === category); const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3; setCategory(categories[next].id); setFilter("all"); document.getElementById(`tab-${categories[next].id}`)?.focus(); } }} tabIndex={category === item.id ? 0 : -1} className={`flex shrink-0 items-center gap-2 border-b-2 py-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${category === item.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><item.icon aria-hidden="true" className="size-4" />{marketingCategoryLabels[item.id]}</button>)}</div>
      <div className="mb-2 flex items-center gap-1 rounded-lg border bg-card p-0.5"><Button variant="ghost" size="icon-xs" aria-label="Previous year" disabled={year <= 2020} onClick={() => router.push(`/workflow/marketing-assets?year=${year - 1}`)}><ChevronLeft /></Button><select aria-label="Planning year" value={year} onChange={event => router.push(`/workflow/marketing-assets?year=${event.target.value}`)} className="h-8 rounded bg-transparent px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{Array.from({ length: 81 }, (_, index) => 2020 + index).map(value => <option key={value} value={value} className="bg-background">{value}</option>)}</select><Button variant="ghost" size="icon-xs" aria-label="Next year" disabled={year >= 2100} onClick={() => router.push(`/workflow/marketing-assets?year=${year + 1}`)}><ChevronRight /></Button></div>
    </div>

    <section id="marketing-calendar" role="tabpanel" aria-labelledby={`tab-${category}`} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">{category === "month_end" ? "A year of opportunities" : category === "holiday" ? "Moments worth planning for" : "Your next factory sale"}</h2><p className="mt-1 text-xs text-muted-foreground">{category === "month_end" ? "Build a consistent rhythm with a promotion for each month." : category === "holiday" ? "U.S. holiday and retail occasions. Adjust campaign dates to suit your market." : "Create offers around production runs, excess inventory, and special releases."}</p></div><div className="flex w-full items-center gap-2 sm:w-auto"><div className="relative min-w-0 flex-1 sm:w-52"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" /><Input aria-label="Search promotions" placeholder="Search promotions…" value={query} onChange={event => setQuery(event.target.value)} className="h-9 pl-9" /></div><select aria-label="Filter by status" value={filter} onChange={event => setFilter(event.target.value as StatusFilter)} className="h-9 rounded-lg border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready">Ready</option>{category !== "factory_sale" ? <option value="unplanned">Not planned</option> : null}</select></div></div>

      {category === "month_end" && shownSlots.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map(quarter => {
        const quarterSlots = shownSlots.filter(slot => Math.floor((slot.month - 1) / 3) === quarter);
        if (!quarterSlots.length) return null;
        const planned = currentAssets.filter(asset => monthEndSlots(year).slice(quarter * 3, quarter * 3 + 3).some(slot => slot.key === asset.slot)).length;
        return <article key={quarter} className="overflow-hidden rounded-xl border bg-card"><header className="flex items-center justify-between gap-2 bg-muted/25 px-5 py-4"><div><p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">Quarter {quarter + 1}</p><h3 className="mt-1 text-sm font-semibold">{["Start strong", "Build momentum", "Keep growing", "Finish with impact"][quarter]}</h3></div><span className="text-xs tabular-nums text-muted-foreground">{planned}/3</span></header>{quarterSlots.map(slotRow)}</article>;
      })}</div> : category === "holiday" && shownSlots.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{shownSlots.map(slot => <article key={slot.key} className="overflow-hidden rounded-xl border bg-card [&_button]:border-t-0">{slotRow(slot)}</article>)}</div> : category === "factory_sale" && shownSales.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{shownSales.map(asset => <button key={asset.id} type="button" onClick={() => setEditing(asset)} className="group rounded-xl border bg-card p-5 text-left outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"><div className="mb-5 flex items-center justify-between"><span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-primary"><Factory className="size-5" /></span>{status(asset)}</div><h3 className="truncate font-semibold">{asset.title}</h3><p className="mt-2 text-xs text-muted-foreground">{marketingDateRange(asset.startDate, asset.endDate)}</p><p className="mt-4 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{asset.offer || "Add an offer to start shaping this promotion."}</p><span className="mt-5 flex items-center gap-2 text-xs font-medium text-primary">Open promotion<ArrowUpRight className="size-3.5" /></span></button>)}</div> : <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/10 px-6 py-12 text-center"><span className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-card"><Factory className="size-5 text-muted-foreground" /></span><h3 className="font-semibold">{query || filter !== "all" ? "No promotions match" : "Turn your next sale into a plan"}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{query || filter !== "all" ? "Try a different search or status to find what you need." : "Bring your products, offer, and customer message together. Your first factory sale starts here."}</p>{query || filter !== "all" ? <Button className="mt-5" variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("all"); }}><X />Clear filters</Button> : <Button className="mt-5" size="sm" disabled={!canEdit} onClick={create}><Plus />Plan a factory sale</Button>}</div>}
    </section>

    <aside className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/15 bg-brand-soft/30 px-5 py-5"><div className="flex items-start gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-primary"><Megaphone className="size-4" /></span><div><h2 className="text-sm font-medium">A little planning. A stronger campaign.</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Start with the offer and audience. Add products, draft your message with AI, then mark it ready when your team is happy.</p></div></div><span className="text-xs text-muted-foreground">Plans stay drafts until you use them.</span></aside>
    {!canWrite ? <p className="text-xs text-muted-foreground">You have view-only access. Open a saved promotion to view, copy, or download it.</p> : null}
    {editing ? <MarketingAssetEditor key={editing.id} initial={editing} products={products} canWrite={!!canEdit} onClose={() => setEditing(null)} onSaved={asset => setAssets(current => [...current.filter(value => value.id !== asset.id), asset])} onDeleted={id => setAssets(current => current.filter(asset => asset.id !== id))} /> : null}
  </div>;
}
