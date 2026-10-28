"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Globe2, Mail, Plus, Search, Tags, Users, Zap } from "lucide-react";
import { CreateSegmentDialog } from "@/components/create-segment-dialog";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { segmentRuleLabels, matchesSegment, summarizeSegment, type SavedSegment, type SegmentCompany } from "@/lib/segments";
import type { PipelineStageValue } from "@/lib/types";

const stageColors: Record<PipelineStageValue, string> = { new: "bg-slate-300", contacted: "bg-sky-400", replied: "bg-violet-400", interested: "bg-amber-400", big_order: "bg-orange-400", won: "bg-emerald-500", lost: "bg-rose-300" };

export function SegmentsWorkspace({ companies, savedSegments, canWrite }: { companies: SegmentCompany[]; savedSegments: SavedSegment[]; canWrite: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<SavedSegment | undefined>();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [sort, setSort] = useState("largest");
  const overview = useMemo(() => summarizeSegment(companies), [companies]);
  const segments = useMemo(() => {
    const sources = Object.fromEntries(companies.map((company) => [company.source, company.sourceLabel]));
    const groups = new Map<string, SegmentCompany[]>();
    for (const company of companies) {
      const members = groups.get(company.segment) ?? [];
      members.push(company);
      groups.set(company.segment, members);
    }
    return [
      ...savedSegments.map((segment) => ({ id: segment.id, name: segment.name, description: segment.description, kind: "saved", manual: segment.rules.companyIds !== undefined, rules: segmentRuleLabels(segment.rules, sources), href: `/companies?segmentId=${encodeURIComponent(segment.id)}`, summary: summarizeSegment(companies.filter((company) => matchesSegment(company, segment.rules))) })),
      ...[...groups].map(([name, members]) => ({ id: `business:${name}`, name, description: "Companies with this business segment on their profile.", kind: "business", manual: false, rules: [name], href: `/companies?segment=${encodeURIComponent(name)}`, summary: summarizeSegment(members) })),
    ];
  }, [companies, savedSegments]);
  const visible = useMemo(() => segments.filter((segment) => (kind === "all" || segment.kind === kind) && `${segment.name} ${segment.description} ${segment.rules.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "fit") return (b.summary.averageFit ?? -1) - (a.summary.averageFit ?? -1) || a.name.localeCompare(b.name);
    return b.summary.count - a.summary.count || a.name.localeCompare(b.name);
  }), [segments, kind, query, sort]);
  const emailCoverage = overview.count ? Math.round(overview.withEmail / overview.count * 100) : 0;
  const createButton = <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!canWrite} title={canWrite ? "Create segment" : "Viewer access is read-only"}><Plus className="size-4" />Create segment</Button>;

  return <div className="min-w-0 space-y-6 pb-8">
    <PageHeader title="Segments" description="Understand your audiences and turn company data into focused sales opportunities." actions={createButton} />
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: "Total segments", value: segments.length.toLocaleString(), detail: `${savedSegments.length} saved · ${segments.length - savedSegments.length} business`, icon: Tags },
        { label: "Companies", value: overview.count.toLocaleString(), detail: "Unique companies in your workspace", icon: Building2 },
        { label: "With contact email", value: `${emailCoverage}%`, detail: `${overview.withEmail.toLocaleString()} companies with an email`, icon: Mail },
        { label: "Markets", value: overview.countries.toLocaleString(), detail: "Countries across all companies", icon: Globe2 },
      ].map(({ label, value, detail, icon: Icon }) => <div key={label} className="rounded-xl border bg-card p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium text-muted-foreground">{label}</p><Icon className="size-4 text-primary" /></div><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search segments" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search segments or rules…" className="pl-9" /></div>
      <select aria-label="Segment type" value={kind} onChange={(event) => setKind(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="all">All segments</option><option value="saved">Saved segments</option><option value="business">Business segments</option></select>
      <select aria-label="Sort segments" value={sort} onChange={(event) => setSort(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="largest">Most companies</option><option value="name">Name A–Z</option><option value="fit">Highest fit score</option></select>
      <p aria-live="polite" className="ml-auto text-xs text-muted-foreground">{visible.length} of {segments.length} segments</p>
    </div>
    {visible.length ? <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {visible.map((segment) => {
        const summary = segment.summary;
        const coverage = summary.count ? Math.round(summary.withEmail / summary.count * 100) : 0;
        return <li key={segment.id} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card"><Link href={segment.href} className="group flex min-w-0 flex-1 flex-col p-5 outline-none transition-colors hover:bg-muted/20 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{segment.kind === "saved" ? <Zap className="size-4" /> : <Tags className="size-4" />}</div><div className="min-w-0 flex-1"><h2 data-no-translate className="break-words text-sm font-semibold">{segment.name}</h2><p className="mt-1 text-xs text-muted-foreground">{segment.kind === "saved" ? segment.manual ? "Saved segment · Manual selection" : "Saved segment · Auto-updating" : "Business segment"}</p></div><ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></div>
          <p className="mt-4 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{segment.description || "A saved audience built from your company profiles."}</p>
          {segment.kind === "saved" ? <div className="mt-3 flex flex-wrap gap-1.5">{(segment.rules.length ? segment.rules : ["All companies"]).map((rule, index) => <span key={`${rule}:${index}`} className="max-w-full truncate rounded-md border bg-muted/40 px-2 py-1 text-[11px]">{rule}</span>)}</div> : null}
          <dl className="mt-auto grid grid-cols-3 gap-2 pt-5"><div><dt className="text-xs text-muted-foreground">Companies</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{summary.count.toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">With email</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{coverage}%</dd></div><div><dt className="text-xs text-muted-foreground">Avg. fit</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{summary.averageFit === null ? "—" : <>{summary.averageFit.toFixed(1)}<span className="text-xs font-normal text-muted-foreground"> / 10</span></>}</dd></div></dl>
          <div className="mt-4 border-t pt-4"><div className="mb-2 flex justify-between gap-2 text-xs text-muted-foreground"><span>Sales pipeline</span><span>{summary.active} active · {summary.won} won</span></div><div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={summary.stages.filter((stage) => stage.count).map((stage) => `${stage.label}: ${stage.count}`).join(", ") || "No companies yet"}>{summary.stages.filter((stage) => stage.count).map((stage) => <span key={stage.stage} title={`${stage.label}: ${stage.count}`} className={stageColors[stage.stage]} style={{ width: `${stage.count / summary.count * 100}%` }} />)}</div><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{summary.stages.filter((stage) => stage.count).map((stage) => <span key={stage.stage} className="inline-flex items-center gap-1"><span className={`size-1.5 rounded-full ${stageColors[stage.stage]}`} />{stage.label} {stage.count}</span>)}</div></div>
          <div className="mt-4 flex items-center justify-between gap-2 text-xs"><span className="inline-flex items-center gap-1 text-muted-foreground"><Globe2 className="size-3" />{summary.countries} markets</span><span className="font-medium text-primary">View companies <span aria-hidden="true">→</span></span></div>
        </Link>{segment.kind === "saved" && canWrite ? <div className="flex justify-end border-t px-3 py-2"><Button type="button" variant="ghost" size="sm" onClick={() => setEditingSegment(savedSegments.find((saved) => saved.id === segment.id))}>Edit segment</Button></div> : null}</li>;
      })}
    </ul> : <div className="rounded-xl border border-dashed p-6"><EmptyState title={segments.length ? "No matching segments" : "Create your first segment"} description={segments.length ? "Try a different search or segment type." : "Use company data to build audiences for your sales team."} icon={Users} /><div className="mt-4 flex justify-center">{segments.length ? <Button variant="outline" onClick={() => { setQuery(""); setKind("all"); }}>Clear filters</Button> : createButton}</div></div>}
    <p className="text-xs leading-5 text-muted-foreground">Manual segments contain the companies you select. Rule-based segments update as company profiles change. Companies can belong to multiple saved segments.</p>
    {createOpen ? <CreateSegmentDialog companies={companies} onClose={() => setCreateOpen(false)} /> : null}
    {editingSegment ? <CreateSegmentDialog key={editingSegment.id} companies={companies} segment={editingSegment} onClose={() => setEditingSegment(undefined)} /> : null}
  </div>;
}
