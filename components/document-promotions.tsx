"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, CalendarDays, Gift, Megaphone, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableFilter, TableFilters } from "@/components/ui/table-filters";
import { MarketingAssetEditor } from "@/components/marketing-asset-editor";
import { marketingCategoryLabels, marketingDateRange, newMarketingAsset, type MarketingAsset, type MarketingCategory } from "@/lib/marketing-assets";
import { promotionEmailTemplate, promotionLibraryRows, type PromotionStatusFilter, type PromotionTemplateSeed } from "@/lib/document-promotions";
import "./email-campaigns-workspace.css";
import type { Product } from "@/lib/types";
import { useCampaignLocation, navigateCampaign } from "@/components/use-campaign-location";
import { campaignSessionKey, clearCampaignSession, readCampaignSession, writeCampaignSession } from "@/lib/campaign-editor-session";
import { marketingAssetInputSchema } from "@/lib/marketing-assets";

const types = [{ id: "factory_sale", icon: Megaphone }, { id: "month_end", icon: CalendarDays }, { id: "holiday", icon: Gift }] as const;
const EmailCampaignBuilder = dynamic(() => import("@/components/email-campaign-builder").then(module => module.EmailCampaignBuilder));
type Snapshot = { year: number; assets: MarketingAsset[]; error?: string };

export function DocumentPromotions({ year, canWrite, sessionScope, onCreateTemplate, products = [] }: { year: number; canWrite: boolean; sessionScope: string; onCreateTemplate: (template: PromotionTemplateSeed) => void; products?: Product[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketingCategory>("factory_sale");
  const [filter, setFilter] = useState<PromotionStatusFilter>("all");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<MarketingAsset | null>(null);
  const [newCampaign, setNewCampaign] = useState<MarketingAsset | null>(null);
  const location = useCampaignLocation();
  const sessionKey = location.campaign ? campaignSessionKey(sessionScope, location.campaign) : null;
  const current = snapshot?.year === year ? snapshot : null;
  const assets = current?.assets ?? [];
  const loading = !current;
  const canEdit = canWrite && !!current && !current.error;
  const rows = promotionLibraryRows(assets, category, year, filter, query);
  const nextSlot = promotionLibraryRows(assets, category, year, "unplanned", "")[0]?.slot;
  const CategoryIcon = types.find(item => item.id === category)!.icon;
  const seed = newCampaign?.id === location.campaign ? newCampaign : sessionKey ? readCampaignSession(`${sessionKey}:seed`, marketingAssetInputSchema) : null;
  const building = current && !current.error ? assets.find(asset => asset.id === location.campaign && asset.category === "factory_sale") ?? (canEdit && seed && !seed.updatedAt && seed.id === location.campaign && seed.year === year && seed.category === "factory_sale" ? seed : null) : null;

  function closeCampaign() {
    if (sessionKey) for (const suffix of ["", ":seed", ":designer"]) clearCampaignSession(sessionKey + suffix);
    setNewCampaign(null);
    navigateCampaign({ campaign: null }, true);
  }

  function openCampaign(asset: MarketingAsset) {
    if (asset.category === "factory_sale") {
      if (!asset.updatedAt) {
        setNewCampaign(asset);
        writeCampaignSession(`${campaignSessionKey(sessionScope, asset.id)}:seed`, asset);
      }
      navigateCampaign({ campaign: asset.id, year: asset.year });
    }
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

  if (location.campaign && !building) return <div className="campaign-planner"><div className="campaign-empty" role={loading ? "status" : "alert"}>
    <h4>{loading ? "Opening campaign…" : current?.error ? "Unable to open campaign" : "Campaign not found"}</h4>
    {!loading ? <p>{current?.error || "This campaign may have been deleted, or the unsaved draft is no longer available in this tab."}</p> : null}
    {current?.error ? <Button variant="outline" onClick={() => { setSnapshot(null); setRevision(value => value + 1); }}>Try again</Button> : null}
    <Button variant="outline" onClick={closeCampaign}>Back to campaigns</Button>
  </div></div>;

  return <div className="campaign-planner">
    <div className="campaign-toolbar">
      <div className="campaign-types" role="group" aria-label="Campaign type">{types.map(item => <Button key={item.id} type="button" size="sm" variant={category === item.id ? "secondary" : "ghost"} aria-pressed={category === item.id} onClick={() => { setCategory(item.id); setFilter("all"); }}><item.icon aria-hidden="true" />{marketingCategoryLabels[item.id]}</Button>)}</div>
      {canWrite ? <Button size="sm" disabled={!canEdit || (category !== "factory_sale" && !nextSlot)} onClick={() => openCampaign(newMarketingAsset(category, year, nextSlot))}><Plus />New campaign</Button> : null}
    </div>
    <div className="campaign-filters">
      <TableFilters>
        <TableFilter label="Search campaigns" search><Input type="search" aria-label="Search campaigns" placeholder="Search campaigns" value={query} onChange={event => setQuery(event.target.value)} /></TableFilter>
        <TableFilter label="Campaign status"><select aria-label="Campaign status" value={filter} onChange={event => setFilter(event.target.value as PromotionStatusFilter)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="ready">Ready</option>{category === "factory_sale" ? <><option value="scheduled">Scheduled</option><option value="queued">Queued</option></> : <option value="unplanned">Not planned</option>}</select></TableFilter>
      </TableFilters>
    </div>
    <section className="campaign-campaigns" aria-label={marketingCategoryLabels[category]}>
      {current?.error ? <NotificationToast><RefreshCw /><h4>Unable to load campaign plans</h4><p>{current.error}</p><Button size="sm" variant="outline" onClick={() => { setSnapshot(null); setRevision(value => value + 1); }}><RefreshCw />Try again</Button></NotificationToast> : <>
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
    {building && sessionKey ? <EmailCampaignBuilder key={building.id} sessionKey={sessionKey} initial={building} products={products} canWrite={canEdit} onSaved={asset => { clearCampaignSession(`${sessionKey}:seed`); setSnapshot(value => value?.year === asset.year ? { ...value, assets: [...value.assets.filter(item => item.id !== asset.id), asset] } : value); }} onDeleted={id => setSnapshot(value => value ? { ...value, assets: value.assets.filter(asset => asset.id !== id) } : value)} onClose={closeCampaign} /> : null}
    {editing ? <MarketingAssetEditor key={editing.id} initial={editing} canWrite={canEdit} onClose={() => setEditing(null)} onSaved={asset => setSnapshot(value => value?.year === asset.year ? { ...value, assets: [...value.assets.filter(item => item.id !== asset.id), asset] } : value)} onDeleted={id => setSnapshot(value => value ? { ...value, assets: value.assets.filter(asset => asset.id !== id) } : value)} onCreateTemplate={asset => { const template = promotionEmailTemplate(asset); setEditing(null); onCreateTemplate(template); }} /> : null}
  </div>;
}
