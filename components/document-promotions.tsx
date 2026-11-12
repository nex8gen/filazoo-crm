"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDownToLine, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Gift, Megaphone, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableFilter, TableFilters } from "@/components/ui/table-filters";
import { MarketingAssetEditor } from "@/components/marketing-asset-editor";
import { marketingAssetText, marketingCategoryLabels, marketingDateRange, newMarketingAsset, type MarketingAsset, type MarketingCategory } from "@/lib/marketing-assets";
import { promotionEmailTemplate, promotionLibraryRows, type PromotionStatusFilter, type PromotionTemplateSeed } from "@/lib/document-promotions";
import "./email-campaigns-workspace.css";
import type { Product } from "@/lib/types";

const types = [{ id: "factory_sale", icon: Megaphone }, { id: "month_end", icon: CalendarDays }, { id: "holiday", icon: Gift }] as const;
const EmailCampaignBuilder = dynamic(() => import("@/components/email-campaign-builder").then(module => module.EmailCampaignBuilder));
type Snapshot = { year: number; assets: MarketingAsset[]; error?: string };

export function DocumentPromotions({ year, onYearChange, canWrite, onCreateTemplate, products = [] }: { year: number; onYearChange: (year: number) => void; canWrite: boolean; onCreateTemplate: (template: PromotionTemplateSeed) => void; products?: Product[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketingCategory>("factory_sale");
  const [filter, setFilter] = useState<PromotionStatusFilter>("all");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<MarketingAsset | null>(null);
  const [building, setBuilding] = useState<MarketingAsset | null>(null);
  const current = snapshot?.year === year ? snapshot : null;
  const assets = current?.assets ?? [];
  const loading = !current;
  const canEdit = canWrite && !!current && !current.error;
  const rows = promotionLibraryRows(assets, category, year, filter, query);
  const nextSlot = promotionLibraryRows(assets, category, year, "unplanned", "")[0]?.slot;
  const CategoryIcon = types.find(item => item.id === category)!.icon;

  function openCampaign(asset: MarketingAsset) {
    if (asset.category === "factory_sale") setBuilding(asset);
    else setEditing(asset);
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/marketing-assets?year=${year}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.assets)) throw new Error(body.error || "Unable to load campaign plans.");
        if (!controller.signal.aborted) setSnapshot({ year, assets: body.assets });
      } catch (cause) {
        if (!controller.signal.aborted) setSnapshot({ year, assets: [], error: cause instanceof Error ? cause.message : "Unable to load campaign plans." });
      }
    })();
    return () => controller.abort();
  }, [year, revision]);

  function exportPlans() {
    const content = assets.map(asset => marketingAssetText(asset)).join("\n\n" + "─".repeat(48) + "\n\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `marketing-campaigns-${year}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="campaign-planner">
    <div className="campaign-toolbar">
      <div className="campaign-types" role="group" aria-label="Campaign type">{types.map(item => <Button key={item.id} type="button" size="sm" variant={category === item.id ? "secondary" : "ghost"} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setFilter("all"); }}><item.icon aria-hidden="true" />{marketingCategoryLabels[item.id]}</Button>)}</div>
      <div className="campaign-yearPicker"><Button variant="ghost" size="icon-xs" aria-label="Previous planning year" disabled={year <= 2020} onClick={() => onYearChange(year - 1)}><ChevronLeft /></Button><select aria-label="Planning year" value={year} onChange={event => onYearChange(Number(event.target.value))}>{Array.from({ length: 81 }, (_, index) => 2020 + index).map(value => <option key={value} value={value}>{value}</option>)}</select><Button variant="ghost" size="icon-xs" aria-label="Next planning year" disabled={year >= 2100} onClick={() => onYearChange(year + 1)}><ChevronRight /></Button></div>
    </div>
    <div className="campaign-filters">
      <TableFilters actions={<><Button size="sm" variant="outline" disabled={!assets.length || loading || !!current?.error} onClick={exportPlans}><ArrowDownToLine />Export plans</Button>{canWrite ? <Button size="sm" disabled={!canEdit || (category !== "factory_sale" && !nextSlot)} onClick={() => openCampaign(newMarketingAsset(category, year, nextSlot))}><Plus />New campaign</Button> : null}</>}>
        <TableFilter label="Search campaigns" search><Input type="search" aria-label="Search campaigns" placeholder="Search campaigns" value={query} onChange={event => setQuery(event.target.value)} /></TableFilter>
        <TableFilter label="Campaign status"><select aria-label="Campaign status" value={filter} onChange={event => setFilter(event.target.value as PromotionStatusFilter)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready">Ready</option>{category === "factory_sale" ? <><option value="scheduled">Scheduled</option><option value="queued">Queued</option></> : <option value="unplanned">Not planned</option>}</select></TableFilter>
      </TableFilters>
    </div>
    <section className="campaign-campaigns" aria-label={marketingCategoryLabels[category]}>
      {current?.error ? <div className="campaign-empty" role="alert"><RefreshCw /><h4>Unable to load campaign plans</h4><p>{current.error}</p><Button size="sm" variant="outline" onClick={() => { setSnapshot(null); setRevision(value => value + 1); }}><RefreshCw />Try again</Button></div> : <>
        <div className="campaign-cardGrid" aria-label={year + " campaign plans"} aria-busy={loading}>
          {loading ? Array.from({ length: 6 }, (_, index) => <div key={index} className="campaign-cardSkeleton" aria-hidden="true" />) : rows.map(row => {
            const asset = row.asset;
            const status = asset?.dispatch ? asset.campaignConfig?.sendMode === "scheduled" ? "scheduled" : "queued" : asset?.status ?? "unplanned";
            const disabled = !asset && !canEdit;
            return <button type="button" key={row.key} className="campaign-card" disabled={disabled} onClick={() => openCampaign(asset ?? newMarketingAsset(category, year, row.slot))}>
              <div className="campaign-cardTop"><span className="campaign-cardIcon"><CategoryIcon aria-hidden="true" /></span><span className="campaign-status" data-status={status}><i aria-hidden="true" />{status === "scheduled" ? "Scheduled" : status === "queued" ? "Queued" : status === "ready" ? "Ready" : asset ? "Draft" : "Not planned"}</span></div>
              <strong>{row.title}</strong>
              {asset?.offer ? <span className="campaign-description">{asset.offer}</span> : null}
              <div className="campaign-cardBottom"><span className="campaign-dates">{marketingDateRange(row.startDate, row.endDate)}</span><ArrowUpRight aria-hidden="true" /></div>
            </button>;
          })}
        </div>
        {loading ? <span className="sr-only" role="status">Loading {year} campaign plans&hellip;</span> : null}
        {!loading && !rows.length ? <div className="campaign-empty"><CategoryIcon aria-hidden="true" /><h4>{query || filter !== "all" ? "No matching campaigns" : "No campaigns yet"}</h4>{query || filter !== "all" ? <Button size="sm" variant="outline" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</Button> : canWrite ? <Button size="sm" onClick={() => openCampaign(newMarketingAsset(category, year))}><Plus />New campaign</Button> : null}</div> : null}
      </>}
    </section>
    {building ? <EmailCampaignBuilder key={building.id} initial={building} products={products} canWrite={canEdit} onSaved={asset => setSnapshot(value => value?.year === asset.year ? { ...value, assets: [...value.assets.filter(item => item.id !== asset.id), asset] } : value)} onDeleted={id => setSnapshot(value => value ? { ...value, assets: value.assets.filter(asset => asset.id !== id) } : value)} onClose={() => setBuilding(null)} /> : null}
    {editing ? <MarketingAssetEditor key={editing.id} initial={editing} canWrite={canEdit} onClose={() => setEditing(null)} onSaved={asset => setSnapshot(value => value?.year === asset.year ? { ...value, assets: [...value.assets.filter(item => item.id !== asset.id), asset] } : value)} onDeleted={id => setSnapshot(value => value ? { ...value, assets: value.assets.filter(asset => asset.id !== id) } : value)} onCreateTemplate={asset => { const template = promotionEmailTemplate(asset); setEditing(null); onCreateTemplate(template); }} /> : null}
  </div>;
}
