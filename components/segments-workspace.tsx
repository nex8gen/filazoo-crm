"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertCircle, ArrowUpRight, Mail, Pencil, Plus, Search, Trash2, Users, Workflow } from "lucide-react";
import { useWorkspaceState } from "@/components/workspace-memory";
import { CreateSegmentDialog } from "@/components/create-segment-dialog";
import { DeleteSegmentDialog, type DeletableSegment } from "@/components/delete-segment-dialog";
import { PageActions } from "@/components/page-header";
import { EmptyState } from "@/components/data-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination } from "@/components/ui/table-pagination";
import { usePreferences } from "@/components/preferences-provider";
import { segmentRuleLabels, matchesSegment, type SavedSegment, type SegmentCompany } from "@/lib/segments";
import { segmentFlowHref } from "@/lib/segment-flows";
import { totalWorkflowCounts, type SegmentWorkflowMetric, type WorkflowCounts } from "@/lib/segment-workflow-metrics";

const runStates = [
  { key: "completed", label: "Completed", color: "bg-emerald-500" },
  { key: "active", label: "In progress", color: "bg-blue-500" },
  { key: "blocked", label: "Blocked", color: "bg-amber-500" },
  { key: "cancelled", label: "Stopped", color: "bg-slate-400" },
  { key: "failed", label: "Failed", color: "bg-destructive" },
] as const;

function RunProgress({ counts, hasWorkflows }: { counts: WorkflowCounts; hasWorkflows: boolean }) {
  const total = counts.active + counts.blocked + counts.completed + counts.cancelled + counts.failed;
  const description = runStates.map(state => `${state.label}: ${counts[state.key].toLocaleString()}`).join(". ");
  return <div className="min-w-44 max-w-60">
    <div className="mb-2 flex items-center justify-between gap-3 text-xs">
      <span className={counts.completed ? "font-medium" : "text-muted-foreground"}>{total ? `${Math.round(counts.completed / total * 100)}% completed` : hasWorkflows ? "No runs yet" : "No workflow yet"}</span>
      {total ? <span className="tabular-nums text-muted-foreground">{total.toLocaleString()} runs</span> : null}
    </div>
    {counts.blocked ? <p className="mt-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">{counts.blocked.toLocaleString()} blocked · waiting for a fix</p> : null}
    <div role="img" aria-label={total ? description : hasWorkflows ? "No runs yet" : "No workflow yet"} title={total ? description : undefined} className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {total ? runStates.map(state => counts[state.key] ? <span key={state.key} className={state.color} style={{ width: `${counts[state.key] / total * 100}%` }} /> : null) : null}
    </div>
    {counts.failed || counts.cancelled ? <p className="mt-1.5 text-xs text-muted-foreground">{counts.failed ? <span className="font-medium text-destructive">{counts.failed.toLocaleString()} failed</span> : null}{counts.failed && counts.cancelled ? " · " : ""}{counts.cancelled ? `${counts.cancelled.toLocaleString()} stopped` : null}</p> : null}
  </div>;
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

  return <div className="min-w-0 space-y-5 pb-8">
    <PageActions>{createButton}</PageActions>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Organize customers into segments and track the workflows moving them forward.</p>
      <span className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">Workflow activity · All time</span>
    </div>
    {workflows === null ? <NotificationToast tone="warning"><AlertCircle className="size-4 shrink-0 text-amber-600" /><span className="flex-1">Workflow activity is unavailable. Your segments are still accessible.</span><Button variant="outline" size="sm" onClick={() => window.location.reload()}>Retry</Button></NotificationToast> : null}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        { label: "Live workflows", value: linkedWorkflows.filter(flow => flow.status === "live").length, detail: `${segments.length.toLocaleString()} segments`, icon: Workflow, tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
        { label: "In progress", value: overview.active, detail: "Active runs, including wait steps", icon: Activity, tone: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
        { label: "Emails sent", value: overview.emailsSent, detail: "Confirmed workflow sends", icon: Mail, tone: "bg-primary/10 text-primary" },
        { label: "Needs attention", value: overview.failed + overview.blocked, detail: "Failed or blocked runs", icon: AlertCircle, tone: overview.failed + overview.blocked ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground" },
      ].map(({ label, value, detail, icon: Icon, tone }) => <div key={label} className="flex items-start justify-between gap-2 rounded-xl border bg-card p-4"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{workflows === null ? "—" : value.toLocaleString()}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p></div><span className={`grid size-9 shrink-0 place-items-center rounded-lg ${tone}`}><Icon className="size-4" /></span></div>)}
    </div>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input aria-label="Search segments" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Search segments or workflows…" className="pl-9" /></div>
        <select aria-label="Segment type" value={kind} onChange={event => { setKind(event.target.value); setPage(1); }} className={selectClass}><option value="all">All segment types</option><option value="saved">Saved segments</option><option value="business">Business segments</option></select>
        <select aria-label="Workflow activity" value={activity} disabled={workflows === null} onChange={event => { setActivity(event.target.value); setPage(1); }} className={selectClass}><option value="all">All workflow activity</option><option value="live">Live workflows</option><option value="attention">Needs attention</option><option value="none">No workflow yet</option></select>
        <select aria-label="Sort segments" value={sort} onChange={event => { setSort(event.target.value); setPage(1); }} className={`${selectClass} sm:ml-auto`}><option value="active">Most in progress</option><option value="sent">Most emails sent</option><option value="largest">Most companies</option><option value="name">Name A–Z</option></select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><p aria-live="polite">{visible.length} of {segments.length} segments</p><div className="flex flex-wrap items-center gap-3" aria-label="Workflow run status legend">{runStates.map(state => <span key={state.key} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`size-1.5 rounded-full ${state.color}`} />{state.label}</span>)}</div></div>
      {visible.length ? <>
        <div className="crm-table-frame"><Table className="min-w-[1060px]">
          <caption className="sr-only">Segments with linked workflows, company counts, confirmed email sends, and all-time workflow run progress</caption>
          <TableHeader><TableRow>
            <TableHead aria-sort={sort === "name" ? "ascending" : undefined}><button type="button" onClick={() => { setSort("name"); setPage(1); }}>Segment</button></TableHead>
            <TableHead>Workflows</TableHead>
            <TableHead className="text-right" aria-sort={sort === "largest" ? "descending" : undefined}><button type="button" onClick={() => { setSort("largest"); setPage(1); }}>Companies</button></TableHead>
            <TableHead className="text-right" aria-sort={sort === "sent" ? "descending" : undefined}><button type="button" onClick={() => { setSort("sent"); setPage(1); }}>Emails sent</button></TableHead>
            <TableHead className="text-right" aria-sort={sort === "active" ? "descending" : undefined}><button type="button" onClick={() => { setSort("active"); setPage(1); }}>In progress</button></TableHead>
            <TableHead>Run progress</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>{rows.map(segment => <TableRow key={segment.id}>
            <TableCell className="min-w-56 max-w-72 whitespace-normal"><Link href={segment.href} data-no-translate className="font-medium hover:underline">{segment.name}</Link><div className="mt-1 flex items-center gap-2"><span className="text-xs text-muted-foreground">{segment.kind === "business" ? "Business segment" : segment.manual ? "Manual selection" : "Rule based"}</span></div>
              {segment.description ? <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground" title={segment.description}>{segment.description}</p> : null}
              {segment.kind === "saved" ? <details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">{segment.manual ? "Selected companies" : "Segment rules"}</summary><ul className="mt-1 space-y-1 pl-3">{(segment.rules.length ? segment.rules : ["All companies"]).map((rule, index) => <li key={`${rule}:${index}`} className="list-disc">{rule}</li>)}</ul></details> : null}
            </TableCell>
            <TableCell className="min-w-40 max-w-52 whitespace-normal">{workflows === null ? <span className="text-muted-foreground">—</span> : segment.workflows.length ? <div className="space-y-1.5">{segment.workflows.length === 1 ? <Link href={`/workflow?flow=${encodeURIComponent(segment.workflows[0].id)}`} data-no-translate className="block truncate text-xs font-medium hover:underline" title={segment.workflows[0].name}>{segment.workflows[0].name}</Link> : <details className="text-xs"><summary className="cursor-pointer font-medium">{segment.workflows.length} workflows</summary><ul className="mt-2 space-y-2">{segment.workflows.map(flow => <li key={flow.id}><Link data-no-translate href={`/workflow?flow=${encodeURIComponent(flow.id)}`} className="hover:underline">{flow.name}</Link><span className="ml-1 text-muted-foreground">({flow.status})</span></li>)}</ul></details>}<div className="flex flex-wrap gap-1">{(["live", "paused", "draft"] as const).map(status => { const count = segment.workflows.filter(flow => flow.status === status).length; return count ? <Badge key={status} variant="secondary" className={`gap-1.5 text-xs ${status === "live" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : status === "paused" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : ""}`}><span aria-hidden="true" className={`size-1 rounded-full ${status === "live" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-muted-foreground"}`} />{count} {status}</Badge> : null; })}</div></div> : <span className="text-xs text-muted-foreground">No workflow yet</span>}</TableCell>
            <TableCell className="text-right tabular-nums"><Link href={segment.href} aria-label={`View ${segment.count} companies in ${segment.name}`} className="hover:underline">{segment.count.toLocaleString()}</Link></TableCell>
            <TableCell className="text-right font-medium tabular-nums">{workflows === null ? "—" : segment.counts.emailsSent.toLocaleString()}</TableCell>
            <TableCell className="text-right tabular-nums"><span className={segment.counts.active ? "font-medium text-blue-600 dark:text-blue-400" : "text-muted-foreground"}>{workflows === null ? "—" : segment.counts.active.toLocaleString()}</span></TableCell>
            <TableCell>{workflows === null ? <span className="text-xs text-muted-foreground">Activity unavailable</span> : <RunProgress counts={segment.counts} hasWorkflows={segment.workflows.length > 0} />}</TableCell>
            <TableCell><div className="flex items-center justify-end gap-1">
              {workflows === null ? <Link href="/workflow" className="text-xs hover:underline">View workflows</Link> : segment.workflows.length ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`/workflow?flow=${encodeURIComponent(segment.workflows[0].id)}`} aria-label={`Open workflow for ${segment.name}`}>Open<ArrowUpRight aria-hidden="true" className="size-3.5" /></Link> : canWrite ? <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={segmentFlowHref(segment)} aria-label={`Create auto workflow for ${segment.name}`}><Plus aria-hidden="true" className="size-3.5" />Workflow</Link> : <Link href={segment.href} className="text-xs hover:underline">View companies</Link>}
              {canWrite ? <>{segment.kind === "saved" ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit segment ${segment.name}`} title="Edit segment" onClick={() => setEditingSegment(savedSegments.find(saved => saved.id === segment.id))}><Pencil className="size-3.5" /></Button> : null}<Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete segment ${segment.name}`} disabled={segment.kind === "business" && (!canDeleteBusiness || segment.name === "Unclassified")} title={segment.kind === "business" && segment.name === "Unclassified" ? "Unclassified is the default group for companies without a business segment." : segment.kind === "business" && !canDeleteBusiness ? "Only admins and operators can delete business segments." : "Delete segment"} onClick={() => setDeletingSegment(segment)}><Trash2 aria-hidden="true" className="size-3.5" /></Button></> : null}
            </div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        <TablePagination page={currentPage} pageCount={pageCount} start={rows.length ? (currentPage - 1) * preferences.tablePageSize + 1 : 0} end={Math.min(currentPage * preferences.tablePageSize, visible.length)} total={visible.length} itemLabel="segments" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
      </> : <div className="rounded-xl border border-dashed p-6"><EmptyState title={segments.length ? "No matching segments" : "Create your first segment"} description={segments.length ? "Try a different search, segment type or workflow activity." : "Group customers to start targeted workflows."} icon={Users} /><div className="mt-4 flex justify-center">{segments.length ? <Button variant="outline" onClick={resetFilters}>Clear filters</Button> : createButton}</div></div>}
    </div>
    <p className="max-w-4xl text-xs leading-5 text-muted-foreground">Activity covers workflows triggered by each segment, including previous members. In progress includes wait steps. A company can have multiple runs; stopped runs are separate from completed runs. Emails sent counts confirmed sends, not deliveries.</p>
    {createOpen ? <CreateSegmentDialog companies={companies} onClose={() => setCreateOpen(false)} /> : null}
    {editingSegment ? <CreateSegmentDialog key={editingSegment.id} companies={companies} segment={editingSegment} onClose={() => setEditingSegment(undefined)} /> : null}
    {deletingSegment ? <DeleteSegmentDialog key={deletingSegment.id} segment={deletingSegment} onClose={() => setDeletingSegment(undefined)} /> : null}
  </div>;
}
