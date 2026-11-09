"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Building2, Check, CheckCircle2, ChevronRight, CircleHelp, Globe, Loader2, Mail, Phone, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilter, TableFilters } from "@/components/ui/table-filters";
import { TablePagination } from "@/components/ui/table-pagination";
import { TableStatusBadge } from "@/components/ui/table-status-badge";
import { EmptyState } from "@/components/data-state";
import { PageActions } from "@/components/page-header";
import { usePreferences } from "@/components/preferences-provider";
import { AiLeadsSearchDialog } from "@/components/ai-leads-search-dialog";
import { AiLeadDetail } from "@/components/ai-leads-detail";
import { leadApi, leadSearchActive, leadStatus, searchLabel } from "@/lib/lead-client";
import { qualificationLabels } from "@/lib/lead-prospecting";
import { isQualifiedLead } from "@/lib/lead-discovery-policy";
import type { LeadProduct, LeadResult, LeadSearch, LeadSearchInput } from "@/lib/ai-leads";
import "./ai-leads.css";

type FilterTab = "all" | "qualified" | "review" | "rejected" | "saved";
type SaveResponse = { companyId: string; existing: boolean; emailConflict: boolean };
const filterNames: Array<[FilterTab, string]> = [["all", "All companies"], ["qualified", "Qualified"], ["review", "Needs review"], ["rejected", "Not a fit"], ["saved", "In CRM"]];

export function AiLeadsWorkspace({ products, countries, initialSearches, canWrite, initialError }: {
  workspaceName: string; products: LeadProduct[]; countries: string[]; initialSearches: LeadSearch[]; canWrite: boolean; initialError: string;
}) {
  const [searches, setSearches] = useState(initialSearches);
  const [selectedId, setSelectedId] = useState(initialSearches[0]?.id ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [seed, setSeed] = useState<LeadSearchInput | undefined>();
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [contacts, setContacts] = useState("");
  const [draft, setDraft] = useState({ query: "", tab: "all" as FilterTab, group: "", contacts: "" });
  const [page, setPage] = useState(1);
  const { preferences } = usePreferences();
  const pendingRefresh = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const current = searches.find(search => search.id === selectedId);
  const running = searches.find(leadSearchActive);
  const detail = current?.results.find(lead => lead.id === detailId) ?? null;

  const refresh = useCallback(async () => {
    if (pendingRefresh.current) return;
    const controller = new AbortController(); pendingRefresh.current = controller;
    setRefreshing(true);
    try {
      const data = await leadApi<{ searches: LeadSearch[] }>("/api/ai/leads", "GET", undefined, controller.signal);
      if (mounted.current) {
        setSearches(data.searches);
        setSelectedId(previous => data.searches.some(search => search.id === previous) ? previous : data.searches[0]?.id ?? "");
      }
    } finally {
      pendingRefresh.current = null;
      if (mounted.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pendingRefresh.current?.abort(); }; }, []);
  const runningId = running?.id;
  useEffect(() => {
    if (!runningId) return;
    const timer = setInterval(() => { void refresh().catch(cause => { if (mounted.current && cause.name !== "AbortError") setError(cause.message); }); }, 3000);
    return () => clearInterval(timer);
  }, [runningId, refresh]);

  function openSearch(criteria?: LeadSearchInput) { setSeed(criteria); setDialogOpen(true); }
  function resetFilters() { setTab("all"); setQuery(""); setGroup(""); setContacts(""); setDraft({ query: "", tab: "all", group: "", contacts: "" }); setPage(1); }
  function selectSearch(id: string) { setSelectedId(id); setSelected([]); setDetailId(null); resetFilters(); }
  function created(search: LeadSearch) {
    setSearches(previous => [search, ...previous.filter(item => item.id !== search.id)].slice(0, 20));
    selectSearch(search.id); setNotice(""); setError("");
  }
  function patchLead(searchId: string, leadId: string, patch: Partial<LeadResult>) {
    setSearches(previous => previous.map(search => search.id === searchId ? { ...search, results: search.results.map(lead => lead.id === leadId ? { ...lead, ...patch } : lead) } : search));
  }
  async function save(leads: LeadResult[]) {
    if (!current || busy) return;
    setBusy(true); setNotice(""); setError("");
    let count = 0; let conflict = false;
    try {
      for (const lead of leads) {
        const result = await leadApi<SaveResponse>("/api/ai/leads", "PATCH", { action: "save", searchId: current.id, leadId: lead.id });
        patchLead(current.id, lead.id, { savedCompanyId: result.companyId });
        count++; conflict ||= result.emailConflict;
        setSelected(previous => previous.filter(id => id !== lead.id));
      }
      setNotice(conflict ? "Companies saved. Emails already linked to other CRM contacts were not duplicated." : "Selected companies saved to CRM. Public emails remain unverified.");
    } catch (cause) {
      setError((count ? count + " saved. " : "") + (cause instanceof Error ? cause.message : "Could not save the selected companies."));
    } finally { setBusy(false); }
  }
  async function feedback(lead: LeadResult, reason: string) {
    if (!current) return;
    setBusy(true); setError("");
    try {
      await leadApi("/api/ai/leads", "PATCH", { action: "feedback", searchId: current.id, leadId: lead.id, reason });
      patchLead(current.id, lead.id, { feedback: reason as LeadResult["feedback"] });
      setNotice("Feedback saved for future searches with this target profile.");
      if (reason === "dismissed") setSelected(previous => previous.filter(id => id !== lead.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Feedback could not be saved."); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!running) return;
    try { await leadApi("/api/ai/leads", "PATCH", { action: "cancel", searchId: running.id }); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not cancel the search."); }
  }
  const counts = useMemo(() => {
    const all = current?.results ?? [];
    return { all: all.length, qualified: all.filter(lead => leadStatus(lead) === "qualified").length, review: all.filter(lead => leadStatus(lead) === "review").length, rejected: all.filter(lead => leadStatus(lead) === "rejected").length, saved: all.filter(lead => lead.savedCompanyId || lead.existingCompanyId).length };
  }, [current]);
  const groups = [...new Set((current?.results ?? []).map(lead => lead.buyerGroup || lead.segment).filter(Boolean))];
  const visible = (current?.results ?? []).filter(lead =>
    (tab === "all" || (tab === "saved" ? lead.savedCompanyId || lead.existingCompanyId : leadStatus(lead) === tab)) &&
    (!query || (lead.name + " " + lead.domain).toLowerCase().includes(query.toLowerCase())) &&
    (!group || (lead.buyerGroup || lead.segment) === group) &&
    (!contacts || (contacts === "email" ? lead.emails.length : lead.phones.length)),
  );
  const canSelect = (lead: LeadResult) => isQualifiedLead(lead) && leadStatus(lead) === "qualified" && !lead.savedCompanyId && !lead.existingCompanyId;
  const pageSize = preferences.tablePageSize;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rows = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectable = rows.filter(canSelect);
  const picked = (current?.results ?? []).filter(lead => selected.includes(lead.id) && canSelect(lead));
  const phaseIndex = current?.phase.includes("Checking") ? 2 : current?.phase.includes("Reading") ? 1 : 0;

  return <div className="lead-discovery">
    <PageActions>
      <Button variant="outline" disabled={refreshing} onClick={() => { setError(""); void refresh().catch(cause => setError(cause.message)); }}><RefreshCw className={refreshing ? "animate-spin" : ""} />Refresh</Button>
      <Button disabled={!canWrite || Boolean(running)} onClick={() => openSearch()}><Plus />New search</Button>
    </PageActions>
    {error ? <div role="alert" className="ld-alert"><CircleHelp size={16} /><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div> : null}
    {notice ? <div role="status" className="ld-notice"><CheckCircle2 size={16} /><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}><X size={16} /></button></div> : null}
    {current ? <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">Current search</span>
          <Select value={selectedId} onValueChange={value => { if (value) selectSearch(value); }}>
            <SelectTrigger size="sm" aria-label="Search history" className="w-72 max-w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{searches.map(search => <SelectItem key={search.id} value={search.id}>{searchLabel(search)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={!canWrite || Boolean(running)} onClick={() => openSearch(current.criteria)}><SlidersHorizontal />Edit targeting</Button>
      </div>
      <dl className="grid gap-x-8 gap-y-4 border-b pb-5 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="mb-1 text-xs text-muted-foreground">Product</dt><dd className="font-medium" data-no-translate>{current.criteria.audience?.category || current.products.map(product => product.name).join(", ")}</dd></div>
        <div className="min-w-0"><dt className="mb-1 text-xs text-muted-foreground">Target market</dt><dd data-no-translate>{[current.criteria.city, current.criteria.country].filter(Boolean).join(", ")}</dd></div>
        <div className="min-w-0"><dt className="mb-1 text-xs text-muted-foreground">Buyer groups</dt><dd data-no-translate>{current.criteria.audience?.segments.map(segment => segment.label).join(", ") || "Unclassified"}</dd></div>
      </dl>
      {!current.researchSummary && current.status === "complete" ? <div className="ld-legacy-note"><CircleHelp size={16} /><p>Earlier search. Run a new search for fresh, qualified companies.</p><Button variant="ghost" size="sm" disabled={!canWrite || Boolean(running)} onClick={() => openSearch(current.criteria)}>Update targeting<ArrowRight /></Button></div> : null}
      {leadSearchActive(current) ? <div className="ld-progress" role="status" aria-live="polite"><div className="ld-progress-heading"><span><Loader2 size={16} className="animate-spin" /><strong>{current.phase}</strong></span><Button variant="ghost" size="sm" onClick={() => void cancel()} disabled={!canWrite}>Cancel search</Button></div><div className="ld-progress-steps">{["Discover companies", "Read websites & contacts", "Qualify against your profile"].map((label, index) => <div key={label} className={index <= phaseIndex ? "is-current" : ""}><span>{index < phaseIndex ? <Check size={12} /> : index + 1}</span>{label}</div>)}</div></div> : null}
      {current.status === "failed" ? <div role="alert" className="ld-alert"><CircleHelp size={16} /><span>{current.error || "Research could not be completed. Refine your targeting and try again."}</span></div> : null}
      {current.status === "cancelled" ? <div className="ld-legacy-note"><CircleHelp size={16} /><p>Search cancelled. A provider request already in progress may still consume credits.</p></div> : null}
      <section className="flex min-w-0 flex-col gap-6" aria-label="Company search results">
        {current.researchSummary ? <div className="space-y-2" role="status"><div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>Qualified: {current.researchSummary.qualified}</span><span>Duplicates skipped: {current.researchSummary.duplicates}</span><span>Did not qualify: {current.researchSummary.rejected + current.researchSummary.needsReview}</span><span>Unreadable websites: {current.researchSummary.unreadable}</span><span>No public contact: {current.researchSummary.noContact}</span></div>{current.researchSummary.qualified < current.criteria.limit ? <p className="text-sm text-muted-foreground">Fewer matches found. Only new companies with verified fit and a public contact route are included.</p> : null}</div> : null}
        <TableFilters onApply={() => { setQuery(draft.query); setTab(draft.tab); setGroup(draft.group); setContacts(draft.contacts); setPage(1); }}>
          <TableFilter label="Search company results" search><Input placeholder="Search company or website" value={draft.query} onChange={event => setDraft(previous => ({ ...previous, query: event.target.value }))} /></TableFilter>
          <TableFilter label="Qualification"><Select value={draft.tab} onValueChange={value => setDraft(previous => ({ ...previous, tab: (value ?? "all") as FilterTab }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{filterNames.map(([value, label]) => <SelectItem key={value} value={value}>{label} ({counts[value]})</SelectItem>)}</SelectContent></Select></TableFilter>
          <TableFilter label="Buyer group"><Select value={draft.group} onValueChange={value => setDraft(previous => ({ ...previous, group: value ?? "" }))}><SelectTrigger className="max-w-56"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">All buyer groups</SelectItem>{groups.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></TableFilter>
          <TableFilter label="Contact information"><Select value={draft.contacts} onValueChange={value => setDraft(previous => ({ ...previous, contacts: value ?? "" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="">Any contact status</SelectItem><SelectItem value="email">With public email</SelectItem><SelectItem value="phone">With public phone</SelectItem></SelectContent></Select></TableFilter>
        </TableFilters>
        <Card className="crm-table-frame gap-0 py-0">
          {picked.length ? <div className="flex flex-wrap items-center gap-2 border-b bg-brand-soft px-4 py-2"><p className="mr-auto text-sm font-semibold text-primary" aria-live="polite">{picked.length} selected</p><Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear selection</Button><Button size="sm" disabled={busy} onClick={() => void save(picked)}>{busy ? <Loader2 className="animate-spin" /> : <Building2 />}Add selected to CRM</Button></div> : null}
          {visible.length ? <div className="crm-table-flex-body"><Table>
            <caption className="sr-only">Company search results, qualification, public contacts, and research sources</caption>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead data-column="select"><Checkbox aria-label="Select visible companies" checked={selectable.length > 0 && selectable.every(lead => selected.includes(lead.id))} indeterminate={selectable.some(lead => selected.includes(lead.id)) && !selectable.every(lead => selected.includes(lead.id))} disabled={!canWrite || !selectable.length || busy} onCheckedChange={checked => setSelected(previous => checked ? [...new Set([...previous, ...selectable.map(lead => lead.id)])] : previous.filter(id => !selectable.some(lead => lead.id === id)))} /></TableHead>
              <TableHead>Company / customer</TableHead><TableHead>Contact information</TableHead><TableHead>Country</TableHead><TableHead>Buyer group</TableHead><TableHead>Qualification</TableHead><TableHead>Sources</TableHead><TableHead aria-label="Company actions" />
            </TableRow></TableHeader>
            <TableBody>{rows.map(lead => {
              const status = leadStatus(lead), companyId = lead.savedCompanyId || lead.existingCompanyId;
              return <TableRow key={lead.id} data-state={selected.includes(lead.id) ? "selected" : undefined} className="cursor-pointer" tabIndex={0} onClick={event => { if (!(event.target as HTMLElement).closest("button,a,input,[role=checkbox]")) setDetailId(lead.id); }} onKeyDown={event => { if (event.target === event.currentTarget && event.key === "Enter") setDetailId(lead.id); }}>
                <TableCell data-column="select"><Checkbox aria-label={"Select " + lead.name} disabled={!canWrite || !canSelect(lead) || busy} checked={selected.includes(lead.id)} onCheckedChange={checked => setSelected(previous => checked ? [...new Set([...previous, lead.id])] : previous.filter(id => id !== lead.id))} /></TableCell>
                <TableCell><div className="flex min-w-60 items-center gap-3.5"><span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-1 ring-border/70" aria-hidden="true">{lead.name.slice(0, 1).toUpperCase()}</span><div className="min-w-0 max-w-72"><button type="button" className="block max-w-full truncate text-left text-sm! font-semibold leading-5 text-primary" data-no-translate onClick={() => setDetailId(lead.id)}>{lead.name}</button><a className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-primary" href={lead.website} target="_blank" rel="noreferrer"><span className="truncate" data-no-translate>{lead.domain}</span><ArrowUpRight className="size-3 shrink-0" /></a></div></div></TableCell>
                <TableCell><div className="max-w-60">{lead.emails[0] ? <><a className="flex items-center gap-1.5" href={"mailto:" + lead.emails[0].value}><Mail className="size-3.5 shrink-0 text-muted-foreground/70" /><span className="truncate" data-no-translate>{lead.emails[0].value}</span></a><span className="block text-xs text-muted-foreground">Unverified</span></> : lead.phones[0] ? <a className="flex items-center gap-1.5" href={"tel:" + lead.phones[0].value}><Phone className="size-3.5 shrink-0 text-muted-foreground/70" /><span data-no-translate>{lead.phones[0].value}</span></a> : lead.contactPage ? <a className="inline-flex items-center gap-1 text-primary" href={lead.contactPage} target="_blank" rel="noreferrer">Contact page<ArrowUpRight className="size-3" /></a> : <span className="text-muted-foreground">No public contact found</span>}</div></TableCell>
                <TableCell><span className="block max-w-44 truncate" data-no-translate title={[lead.city, lead.country].filter(Boolean).join(", ")}>{lead.country || "Location unconfirmed"}</span></TableCell>
                <TableCell><span className="block max-w-48 truncate" title={lead.buyerGroup || lead.segment} data-no-translate>{lead.buyerGroup || lead.segment || "Unclassified"}</span>{companyId ? <span className="block text-xs text-muted-foreground">In CRM</span> : null}</TableCell>
                <TableCell><button type="button" onClick={() => setDetailId(lead.id)} title={lead.reviewReason || qualificationLabels[status]}><TableStatusBadge tone={status === "qualified" ? "green" : status === "rejected" ? "red" : "yellow"}>{qualificationLabels[status]}</TableStatusBadge></button></TableCell>
                <TableCell><Button variant="ghost" size="sm" aria-label={"View sources for " + lead.name} onClick={() => setDetailId(lead.id)}><Globe className="size-3.5" />{lead.sources.length}</Button></TableCell>
                <TableCell><div className="flex items-center justify-end gap-1">{companyId ? <Button variant="ghost" size="icon-sm" render={<Link href={"/companies/" + companyId} />} aria-label={"Open " + lead.name + " in CRM"}><Building2 /></Button> : <Button variant="ghost" size="icon-sm" aria-label={"Add " + lead.name + " to CRM"} title={!lead.researchVersion ? "Update targeting to review this earlier search" : status === "rejected" ? "Ruled out by your target profile" : "Add to CRM"} disabled={!canWrite || busy || !canSelect(lead)} onClick={() => void save([lead])}><Plus /></Button>}<Button variant="ghost" size="icon-sm" aria-label={"View research for " + lead.name} onClick={() => setDetailId(lead.id)}><ChevronRight /></Button></div></TableCell>
              </TableRow>;
            })}</TableBody>
          </Table></div> : leadSearchActive(current) ? <EmptyState icon={Loader2} title="Research in progress" description="Companies will appear after their websites and qualification checks are reviewed." /> : counts.all ? <EmptyState icon={Search} title="No companies match these filters" description="Try changing your search or filters to see more results."><Button variant="outline" size="sm" onClick={resetFilters}>Clear filters</Button></EmptyState> : <EmptyState icon={Building2} title="No companies found in this search" description="Review the product category, choose another buyer group, or broaden the target location."><Button variant="outline" size="sm" disabled={!canWrite || Boolean(running)} onClick={() => openSearch(current.criteria)}>Refine targeting<ArrowRight /></Button></EmptyState>}
        </Card>
        <TablePagination className="mt-0" page={currentPage} pageCount={pageCount} start={rows.length ? (currentPage - 1) * pageSize + 1 : 0} end={Math.min(currentPage * pageSize, visible.length)} total={visible.length} itemLabel="companies" onPrevious={() => setPage(currentPage - 1)} onNext={() => setPage(currentPage + 1)} onPageChange={setPage} />
        <p className="text-xs text-muted-foreground">Public contacts are unverified. Qualification does not confirm buying intent.</p>
      </section>
    </> : <EmptyState icon={Building2} title="No searches yet" description="Choose your products and target location to find potential business customers."><Button disabled={!canWrite} onClick={() => openSearch()}><Plus />New search</Button></EmptyState>}
    <AiLeadsSearchDialog open={dialogOpen} onOpenChange={setDialogOpen} products={products} countries={countries} seed={seed} onCreated={created} />
    <AiLeadDetail lead={detail} canWrite={canWrite} busy={busy} onClose={() => setDetailId(null)} onSave={lead => void save([lead])} onFeedback={(lead, reason) => void feedback(lead, reason)} onNotice={setNotice} />
  </div>;
}
