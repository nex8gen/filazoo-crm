"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertCircle, ArrowUpRight, ChartNoAxesCombined, Info, Mail, MoreHorizontal, Pencil, Plus, Search, Trash2, Users, Workflow } from "lucide-react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { CreateSegmentDialog } from "@/components/create-segment-dialog";
import { DeleteSegmentDialog, type DeletableSegment } from "@/components/delete-segment-dialog";
import { PageActions } from "@/components/page-header";
import { EmptyState } from "@/components/data-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotificationToast } from "@/components/ui/notification-toast";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePreferences } from "@/components/preferences-provider";
import { segmentRuleLabels, matchesSegment, type SavedSegment, type SegmentCompany } from "@/lib/segments";
import { segmentFlowHref } from "@/lib/segment-flows";
import { totalWorkflowCounts, type SegmentWorkflowMetric, type WorkflowCounts } from "@/lib/segment-workflow-metrics";
import surfaces from "./analytics-surface.module.css";
import styles from "./segments-workspace.module.css";

const runStates = [
  { key: "completed", label: "Completed", color: "bg-emerald-500" },
  { key: "active", label: "In progress", color: "bg-blue-500" },
  { key: "blocked", label: "Blocked", color: "bg-amber-500" },
  { key: "cancelled", label: "Stopped", color: "bg-slate-400" },
  { key: "failed", label: "Failed", color: "bg-destructive" },
] as const;

function RunProgress({ counts, hasWorkflows, name }: { counts: WorkflowCounts; hasWorkflows: boolean; name: string }) {
  const total = counts.active + counts.blocked + counts.completed + counts.cancelled + counts.failed;
  if (!total) return <span className="text-muted-foreground" aria-label={hasWorkflows ? "No runs yet" : "No workflow yet"}>—</span>;
  const percent = Math.round(counts.completed / total * 100);
  return <Popover>
    <PopoverTrigger className={styles.progress} aria-label={`Run progress for ${name}: ${percent}% completed. ${counts.blocked} blocked. ${counts.failed} failed.`}>
      <span className={styles.progressReadout}>
        <span className="tabular-nums">{percent}%</span>
        <span className="flex items-center gap-2">
          {counts.blocked ? <span className="text-amber-700 dark:text-amber-400">{counts.blocked.toLocaleString()} blocked</span> : null}
          {counts.failed ? <span className="text-destructive">{counts.failed.toLocaleString()} failed</span> : null}
        </span>
      </span>
      <span className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {runStates.map(state => counts[state.key] ? <span key={state.key} className={state.color} style={{ width: `${counts[state.key] / total * 100}%` }} /> : null)}
      </span>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-56 p-4">
      <PopoverTitle>Run progress</PopoverTitle>
      <p className="text-xs text-muted-foreground">{total.toLocaleString()} runs · All time</p>
      <dl className="space-y-2 text-xs">{runStates.map(state => <div key={state.key} className="flex items-center justify-between gap-4">
        <dt className="flex items-center gap-2"><span aria-hidden="true" className={`size-1.5 rounded-full ${state.color}`} />{state.label}</dt>
        <dd className="tabular-nums">{counts[state.key].toLocaleString()}</dd>
      </div>)}</dl>
    </PopoverContent>
  </Popover>;
}

function WorkflowLinks({ workflows }: { workflows: SegmentWorkflowMetric[] }) {
  if (!workflows.length) return <span className="text-muted-foreground" aria-label="No workflow yet">—</span>;
  const statusDot = (status: string) => <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${status === "live" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-slate-400"}`} />;
  if (workflows.length === 1) {
    const flow = workflows[0];
    return <Link href={`/workflow?flow=${encodeURIComponent(flow.id)}`} className="flex min-w-0 items-center gap-2 hover:underline" title={`${flow.name} · ${flow.status}`}>
      {statusDot(flow.status)}<span data-no-translate className="truncate">{flow.name}</span><span className="sr-only">{flow.status}</span>
    </Link>;
  }
  return <Popover>
    <PopoverTrigger className="rounded text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{workflows.length} workflows</PopoverTrigger>
    <PopoverContent align="start" className="max-h-80 overflow-y-auto p-4">
      <PopoverTitle>Workflows</PopoverTitle>
      {workflows.map(flow => <Link key={flow.id} href={`/workflow?flow=${encodeURIComponent(flow.id)}`} className="flex min-w-0 items-center gap-2 rounded py-1 text-xs hover:underline" title={flow.name}>
        {statusDot(flow.status)}<span data-no-translate className="truncate">{flow.name}</span><span className="ml-auto text-muted-foreground">{flow.status}</span>
      </Link>)}
    </PopoverContent>
  </Popover>;
}

export function SegmentsWorkspace({ companies, savedSegments, workflows, canWrite, canDeleteBusiness }: { companies: SegmentCompany[]; savedSegments: SavedSegment[]; workflows: SegmentWorkflowMetric[] | null; canWrite: boolean; canDeleteBusiness: boolean }) {
  const { preferences } = usePreferences();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<SavedSegment | undefined>();
  const [deletingSegment, setDeletingSegment] = useState<DeletableSegment | undefined>();
  const [query, setQuery] = useWorkspaceState("segments.query", "");
  const [kind, setKind] = useWorkspaceState("segments.kind", "all");
  const [activity, setActivity] = useWorkspaceState("segments.activity", "all");
  const [sort, setSort] = useWorkspaceState("segments.workflow-sort", "active");
  const [page, setPage] = useWorkspaceState("segments.page", 1);
  const segments = useMemo(() => {
    const sources = Object.fromEntries(companies.map(company => [company.source, company.sourceLabel]));
    const groups = new Map<string, number>();
    for (const company of companies) groups.set(company.segment, (groups.get(company.segment) ?? 0) + 1);
    const bySegment = new Map<string, SegmentWorkflowMetric[]>();
    for (const workflow of workflows ?? []) bySegment.set(workflow.segmentKey, [...(bySegment.get(workflow.segmentKey) ?? []), workflow]);
    return [
      ...savedSegments.map(segment => ({ id: segment.id, name: segment.name, description: segment.description, kind: "saved" as const, manual: segment.rules.companyIds !== undefined, rules: segmentRuleLabels(segment.rules, sources), href: `/companies?segmentId=${encodeURIComponent(segment.id)}`, count: companies.filter(company => matchesSegment(company, segment.rules)).length })),
      ...[...groups].map(([name, count]) => ({ id: `business:${name}`, name, description: "", kind: "business" as const, manual: false, rules: [name], href: `/companies?segment=${encodeURIComponent(name)}`, count })),
    ].map(segment => {
      const linked = bySegment.get(segment.id) ?? [];
      return { ...segment, workflows: linked, counts: totalWorkflowCounts(linked), live: linked.filter(flow => flow.status === "live").length };
    });
  }, [companies, savedSegments, workflows]);
  // Only workflows represented by a visible audience contribute to the overview.
  const linkedWorkflows = useMemo(() => segments.flatMap(segment => segment.workflows), [segments]);
  const overview = useMemo(() => totalWorkflowCounts(linkedWorkflows), [linkedWorkflows]);
  const visible = useMemo(() => segments.filter(segment => (kind === "all" || segment.kind === kind)
    && (activity === "all" || workflows === null || (activity === "live" ? segment.live > 0 : activity === "attention" ? segment.counts.failed + segment.counts.blocked > 0 : segment.workflows.length === 0))
    && `${segment.name} ${segment.description} ${segment.rules.join(" ")} ${segment.workflows.map(flow => flow.name).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === "name" ? 0 : sort === "sent" ? b.counts.emailsSent - a.counts.emailsSent : sort === "largest" ? b.count - a.count : b.counts.active - a.counts.active) || a.name.localeCompare(b.name)), [segments, kind, activity, query, sort, workflows]);
  const pageCount = Math.max(1, Math.ceil(visible.length / preferences.tablePageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const rows = visible.slice((currentPage - 1) * preferences.tablePageSize, currentPage * preferences.tablePageSize);
  const createButton = <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!canWrite} title={canWrite ? "Create segment" : "Viewer access is read-only"}><Plus className="size-4" />Create segment</Button>;
  const selectClass = "h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const resetFilters = () => { setQuery(""); setKind("all"); setActivity("all"); setPage(1); };

  return <div className={`${styles.workspace} space-y-5 pb-8`}>
    <PageActions>{createButton}</PageActions>
    {workflows === null ? <NotificationToast tone="warning"><AlertCircle className="size-4 shrink-0 text-amber-600" /><span className="flex-1">Workflow activity is unavailable. Your segments are still accessible.</span><Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button></NotificationToast> : null}
    <section aria-label="Segment overview" className={styles.overview}>
      <div className={styles.overviewHeading}>
        <h2><ChartNoAxesCombined aria-hidden="true" />Overview</h2>
        <div className={styles.period}>All time<Popover>
          <PopoverTrigger aria-label="About workflow activity" className={styles.infoButton}><Info aria-hidden="true" className="size-3.5" /></PopoverTrigger>
          <PopoverContent align="start" className="p-4">
            <PopoverTitle>Workflow activity</PopoverTitle>
            <p className="text-xs leading-5 text-muted-foreground">Activity covers workflows triggered by each segment, including previous members. In progress includes wait steps. A company can have multiple runs; stopped runs are separate from completed runs. Emails sent counts confirmed sends, not deliveries.</p>
          </PopoverContent>
        </Popover></div>
      </div>
      <div className={styles.metrics}>{[
        { label: "Live workflows", value: linkedWorkflows.filter(flow => flow.status === "live").length, detail: "Live workflows", icon: Workflow },
        { label: "In progress", value: overview.active, detail: "Active runs, including wait steps", icon: Activity },
        { label: "Emails sent", value: overview.emailsSent, detail: "Confirmed workflow sends", icon: Mail },
        { label: "Needs attention", value: overview.failed + overview.blocked, detail: "Failed or blocked runs", icon: AlertCircle },
      ].map(({ label, value, detail, icon: Icon }) => <article key={label} className={surfaces.kpi} title={detail}>
        <div className={surfaces.kpiText}>
          <h3 className={surfaces.title}>{label}</h3>
          <div className={surfaces.readout}><strong className={label === "Needs attention" && value ? "text-destructive" : undefined}>{workflows === null ? "—" : value.toLocaleString()}</strong></div>
        </div>
        <Icon aria-hidden="true" className={styles.metricIcon} />
      </article>)}</div>
    </section>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search segments" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search segments or workflows…" className="pl-9" /></div>
        <select aria-label="Segment type" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className={selectClass}><option value="all">All segment types</option><option value="saved">Saved segments</option><option value="business">Business segments</option></select>
        <select aria-label="Workflow activity" value={activity} disabled={workflows === null} onChange={event => { setActivity(event.target.value); setPage(1); }} className={selectClass}><option value="all">All workflow activity</option><option value="live">Live workflows</option><option value="attention">Needs attention</option><option value="none">No workflow yet</option></select>
        <select aria-label="Sort segments" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }} className={`${selectClass} sm:ml-auto`}><option value="active">Most in progress</option><option value="sent">Most emails sent</option><option value="largest">Most companies</option><option value="name">Name A–Z</option></select>
      </div>
      <p aria-live="polite" className="text-xs text-muted-foreground">{visible.length === segments.length ? <>{segments.length} segments</> : <>{visible.length} of {segments.length} segments</>}</p>
      {visible.length ? <>
        <div className="crm-table-frame"><Table className={`${styles.table} min-w-[960px] table-fixed`}>
          <caption className="sr-only">Segments with linked workflows, company counts, confirmed email sends, and all-time workflow run progress</caption>
          <TableHeader><TableRow>
            <TableHead aria-sort={sort === "name" ? "ascending" : undefined}><button type="button" onClick={() => { setSort("name"); setPage(1); }}>Segment</button></TableHead>
            <TableHead>Workflows</TableHead>
            <TableHead className="w-24 text-right" aria-sort={sort === "largest" ? "descending" : undefined}><button type="button" onClick={() => { setSort("largest"); setPage(1); }}>Companies</button></TableHead>
            <TableHead className="w-28 text-right" aria-sort={sort === "sent" ? "descending" : undefined}><button type="button" onClick={() => { setSort("sent"); setPage(1); }}>Emails sent</button></TableHead>
            <TableHead className="w-28 text-right" aria-sort={sort === "active" ? "descending" : undefined}><button type="button" onClick={() => { setSort("active"); setPage(1); }}>In progress</button></TableHead>
            <TableHead className="w-[20%]">Run progress</TableHead><TableHead className="w-28 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(segment => <TableRow key={segment.id}>
            <TableCell><div className={styles.segmentName}>
              <Link href={segment.href} data-no-translate title={segment.name} className="font-medium hover:underline">{segment.name}</Link>
              <Popover>
                <PopoverTrigger className={styles.infoButton} aria-label={`Details for ${segment.name}`}><Info aria-hidden="true" className="size-3.5" /></PopoverTrigger>
                <PopoverContent align="start" className="max-h-80 overflow-y-auto p-4">
                  <PopoverTitle data-no-translate className="break-words">{segment.name}</PopoverTitle>
                  <p className="text-xs text-muted-foreground">{segment.kind === "business" ? "Business segment" : segment.manual ? "Manual selection" : "Rule based"}</p>
                  {segment.description ? <p data-no-translate className="break-words text-xs leading-5">{segment.description}</p> : null}
                  {segment.kind === "saved" ? <div className="space-y-2 border-t pt-3 text-xs">
                    <p className="font-medium">{segment.manual ? "Selected companies" : "Segment rules"}</p>
                    <ul className="space-y-1.5 pl-4 text-muted-foreground">{(segment.rules.length ? segment.rules : ["All companies"]).map((rule, index) => <li key={`${rule}:${index}`} className="list-disc break-words">{rule}</li>)}</ul>
                  </div> : null}
                  <Link href={segment.href} className="mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline">View companies<ArrowUpRight aria-hidden="true" className="size-3.5" /></Link>
                </PopoverContent>
              </Popover>
            </div>
            </TableCell>
            <TableCell>{workflows === null ? <span className="text-muted-foreground" aria-label="Activity unavailable">—</span> : <WorkflowLinks workflows={segment.workflows} />}</TableCell>
            <TableCell className="text-right tabular-nums"><Link href={segment.href} aria-label={`View ${segment.count} companies in ${segment.name}`} className="hover:underline">{segment.count.toLocaleString()}</Link></TableCell>
            <TableCell className="text-right font-medium tabular-nums">{workflows === null ? "—" : segment.counts.emailsSent.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums"><span className={segment.counts.active ? "font-medium text-blue-600 dark:text-blue-400" : "text-muted-foreground"}>{workflows === null ? "—" : segment.counts.active.toLocaleString()}</span></TableCell>
            <TableCell>{workflows === null ? <span className="text-muted-foreground" aria-label="Activity unavailable">—</span> : <RunProgress counts={segment.counts} hasWorkflows={segment.workflows.length > 0} name={segment.name} />}</TableCell>
            <TableCell><div className="flex items-center justify-end gap-1">
              {workflows === null ? <Link href="/workflow" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="View workflows" title="View workflows"><Workflow aria-hidden="true" className="size-4" /></Link> : segment.workflows.length ? <Link className={buttonVariants({ variant: "ghost", size: "icon-sm" })} href={`/workflow?flow=${encodeURIComponent(segment.workflows[0].id)}`} aria-label={`Open workflow for ${segment.name}`} title="Open workflow"><ArrowUpRight aria-hidden="true" className="size-4" /></Link> : canWrite ? <Link className={buttonVariants({ variant: "ghost", size: "icon-sm" })} href={segmentFlowHref(segment)} aria-label={`Create auto workflow for ${segment.name}`} title="Create workflow"><Plus aria-hidden="true" className="size-4" /></Link> : null}
              {canWrite ? <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${segment.name}`} />}><MoreHorizontal aria-hidden="true" className="size-4" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {segment.kind === "saved" ? <DropdownMenuItem onClick={() => setEditingSegment(savedSegments.find(saved => saved.id === segment.id))}><Pencil aria-hidden="true" />Edit segment</DropdownMenuItem> : null}
                  <DropdownMenuItem variant="destructive" disabled={segment.kind === "business" && (!canDeleteBusiness || segment.name === "Unclassified")} title={segment.kind === "business" && segment.name === "Unclassified" ? "Unclassified is the default group for companies without a business segment." : segment.kind === "business" && !canDeleteBusiness ? "Only admins and operators can delete business segments." : "Delete segment"} onClick={() => setDeletingSegment(segment)}><Trash2 aria-hidden="true" />Delete segment</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu> : null}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        <TablePagination page={currentPage} pageCount={pageCount} start={rows.length ? (currentPage - 1) * preferences.tablePageSize + 1 : 0} end={Math.min(currentPage * preferences.tablePageSize, visible.length)} total={visible.length} itemLabel="segments" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
      </> : <div className="rounded-xl border border-dashed p-6"><EmptyState title={segments.length ? "No matching segments" : "Create your first segment"} description={segments.length ? "Try a different search, segment type or workflow activity." : "Group customers to start targeted workflows."} icon={Users} /><div className="mt-4 flex justify-center">{segments.length ? <Button variant="outline" onClick={resetFilters}>Clear filters</Button> : createButton}</div></div>}
    </div>
    {createOpen ? <CreateSegmentDialog companies={companies} onClose={() => setCreateOpen(false)} /> : null}
    {editingSegment ? <CreateSegmentDialog key={editingSegment.id} companies={companies} segment={editingSegment} onClose={() => setEditingSegment(undefined)} /> : null}
    {deletingSegment ? <DeleteSegmentDialog key={deletingSegment.id} segment={deletingSegment} onClose={() => setDeletingSegment(undefined)} /> : null}
  </div>;
}
