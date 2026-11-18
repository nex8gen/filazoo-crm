"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Filter, History, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FlowHistoryEntry, FlowHistoryFilter } from "@/lib/flow-history";

const filters: Array<{ value: FlowHistoryFilter; label: string }> = [
  { value: "all", label: "All changes" }, { value: "created", label: "Flow created" },
  { value: "name", label: "Name changes" }, { value: "status", label: "Status changes" },
  { value: "trigger", label: "Trigger changes" }, { value: "actions", label: "Action changes" },
];

export function FlowHistoryPanel({ id, flowId, savedAt, onClose }: {
  id: string; flowId: string | null; savedAt?: string; onClose: () => void;
}) {
  const [tab, setTab] = useState("changelog");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FlowHistoryFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ entries: FlowHistoryEntry[]; hasMore: boolean; key: string } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const filterId = useId();
  const requestKey = JSON.stringify([flowId, savedAt, page, query, kind, refresh]);
  const loading = Boolean(flowId && result?.key !== requestKey && failure?.key !== requestKey);
  const error = failure?.key === requestKey ? failure.message : "";
  const entries = result?.key === requestKey ? result.entries : [];

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (!flowId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: String(page), query: query.trim(), kind });
        const response = await fetch(`/api/flows/${flowId}/history?${params}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load flow history.");
        if (!controller.signal.aborted) setResult({ entries: data.entries, hasMore: data.hasMore, key: requestKey });
      } catch (cause) {
        if (!controller.signal.aborted) setFailure({ key: requestKey, message: cause instanceof Error ? cause.message : "Unable to load flow history." });
      }
    }, query ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [flowId, page, query, kind, requestKey]);

  return <aside id={id} className="wf-panel wf-history-panel" aria-labelledby={headingId} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header className="wf-history-heading">
      <h2 id={headingId} ref={heading} tabIndex={-1}>Flow history</h2>
      <Button variant="ghost" size="icon-sm" aria-label="Close flow history" onClick={onClose}><X /></Button>
    </header>
    <Tabs value={tab} onValueChange={value => setTab(String(value))} className="wf-history-tabs">
      <TabsList variant="line" aria-label="Flow history view">
        <TabsTrigger value="versions">Versions</TabsTrigger>
        <TabsTrigger value="changelog">Changelog</TabsTrigger>
      </TabsList>
      <div className="wf-history-tools">
        <div className="wf-history-search"><Search aria-hidden="true" /><Input aria-label="Search history" placeholder="Search history" maxLength={120} value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
        <Button variant="outline" size="icon-sm" aria-label="Filter history" aria-expanded={filtersOpen} aria-controls={filterId} aria-pressed={kind !== "all"} onClick={() => setFiltersOpen(open => !open)}><Filter /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Refresh flow history" disabled={loading || !flowId} onClick={() => setRefresh(value => value + 1)}><RefreshCw /></Button>
        {filtersOpen ? <select id={filterId} aria-label="Change type" value={kind} onChange={event => { setKind(event.target.value as FlowHistoryFilter); setPage(0); }}>{filters.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}</select> : null}
      </div>
      {(["versions", "changelog"] as const).map(view => <TabsContent key={view} value={view} className="wf-history-content scroll-surface" aria-busy={loading}>
        {!flowId ? <p className="wf-history-message">Save this flow to start recording its changes.</p> : loading ? <p className="wf-history-message" role="status">Loading flow history…</p> : error ? <div className="wf-history-message" role="alert"><p>{error}</p><Button size="sm" variant="outline" onClick={() => setRefresh(value => value + 1)}>Retry</Button></div> : !entries.length ? <div className="wf-history-empty"><History /><p>{query || kind !== "all" ? "No changes match your search or filters." : "No saved changes yet."}</p>{query || kind !== "all" ? <Button size="sm" variant="outline" onClick={() => { setQuery(""); setKind("all"); setPage(0); }}>Clear filters</Button> : null}</div> : <>
          <ol className="wf-history-list">{entries.map(entry => <li key={entry.id}>
            <div className="wf-history-meta"><time dateTime={entry.created_at} title={new Date(entry.created_at).toLocaleString("en-US", { timeZone: "Asia/Shanghai" }) + " (UTC+8)"}>{new Date(entry.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Shanghai" })}</time><span translate="no">{entry.actor_label}</span></div>
            {view === "versions" ? <details><summary>Version {entry.version}<span>{new Date(entry.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Shanghai" })} · UTC+8</span></summary><ul>{entry.changes.map((change, index) => <li key={index}>{change.description}</li>)}</ul></details> : <ul>{entry.changes.filter(change => kind === "all" || change.kind === kind).map((change, index) => <li key={index}>{change.description}{change.description.startsWith("Deleted ") ? <span className="wf-history-deleted">Deleted</span> : null}</li>)}</ul>}
          </li>)}</ol>
          {page > 0 || result?.hasMore ? <div className="wf-history-pagination"><Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(value => value - 1)}>Previous</Button><span>Page {page + 1}</span><Button size="sm" variant="outline" disabled={!result?.hasMore} onClick={() => setPage(value => value + 1)}>Next</Button></div> : null}
        </>}
      </TabsContent>)}
    </Tabs>
  </aside>;
}
