"use client";

import { useId, useMemo, useState } from "react";
import { ArrowUpRight, BarChart3, Boxes, CalendarClock, CheckCircle2, Download, FileText, LayoutGrid, ListChecks, Package, ReceiptText, Search, Table2, Users } from "lucide-react";
import { parseResponsePresentation, presentationCsv, referencedRecords, type ResponsePresentation, type ResponseSection } from "@/lib/ai/response-presentation";
import "./ai-response-presentation.css";

const icons = { invoices: ReceiptText, orders: Package, quotations: FileText, companies: Users, tasks: ListChecks, products: Boxes, inventory: Boxes, segments: Users };
const viewOptions = [{ id: "cards", label: "Cards", icon: LayoutGrid }, { id: "table", label: "Table", icon: Table2 }, { id: "chart", label: "Chart", icon: BarChart3 }] as const;

function downloadCsv(section: ResponseSection) {
  const blob = new Blob([presentationCsv(section)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `filazoo-${section.id}.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  // Allow the browser to start the download before releasing its object URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RecordChart({ section }: { section: ResponseSection }) {
  const chart = section.chart;
  if (!chart) return null;
  const maximum = Math.max(1, ...chart.points.map(point => point.value));
  const points = chart.points.map((point, index) => ({ ...point, x: 35 + index / (chart.points.length - 1) * 530, y: 145 - point.value / maximum * 115 }));
  return <figure className="ai-result-chart">
    <figcaption><BarChart3 aria-hidden="true" />{chart.title}<span>{chart.unit}</span></figcaption>
    {chart.kind === "line" ? <svg className="ai-result-line-chart" viewBox="0 0 600 180" role="img" aria-label={`${chart.title}, ${chart.unit}. Values listed below.`}>
      <line x1="35" y1="145" x2="565" y2="145" className="ai-result-chart-axis" />
      <line x1="35" y1="30" x2="565" y2="30" className="ai-result-chart-axis" strokeDasharray="4 5" />
      <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      {points.map(point => <circle key={point.label} cx={point.x} cy={point.y} r="4" fill="var(--primary)" tabIndex={0} aria-label={`${point.label}: ${point.value} ${chart.unit}`}><title>{point.label}: {point.value} {chart.unit}</title></circle>)}
      <text x="35" y="168">{chart.points[0].label}</text><text x="565" y="168" textAnchor="end">{chart.points.at(-1)!.label}</text>
    </svg> : null}
    <ul aria-label={chart.title}>{chart.points.map(point => <li key={point.label}>
      <span className="ai-result-chart-label" title={point.label}>{point.label}</span>
      <span className="ai-result-chart-track" aria-hidden="true"><span style={{ width: `${point.value / maximum * 100}%` }} /></span>
      <strong>{point.value.toLocaleString("en")}</strong>
    </li>)}</ul>
  </figure>;
}

function ResultSection({ section }: { section: ResponseSection }) {
  const [view, setView] = useState<"cards" | "table" | "chart">("cards");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const Icon = icons[section.id];
  const rows = useMemo(() => section.rows.filter(row => (status === "all" || row.status === status) && (!search.trim() || Object.values(row.cells).join(" ").toLowerCase().includes(search.trim().toLowerCase()))), [section.rows, search, status]);
  const statuses = [...new Set(section.rows.map(row => row.status))];
  const visible = expanded || view !== "cards" ? rows : rows.slice(0, 6);

  return <section className="ai-result-section" aria-labelledby={headingId}>
    <header className="ai-result-header">
      <div className="ai-result-heading"><span className="ai-result-domain-icon"><Icon aria-hidden="true" /></span><div><h3 id={headingId}>{section.title}</h3><span className="ai-result-verified"><CheckCircle2 aria-hidden="true" />Saved CRM records</span></div></div>
      <button type="button" className="ai-result-export" onClick={() => downloadCsv({ ...section, rows })} disabled={!rows.length}><Download aria-hidden="true" />Export CSV</button>
    </header>
    <p className="ai-result-scope">{section.description}</p>
    <div className="ai-result-metrics">{section.metrics.map(metric => <div key={`${metric.label}-${metric.value}`} data-tone={metric.tone}><span>{metric.label}</span><strong data-no-translate>{metric.value}</strong></div>)}</div>
    <div className="ai-result-controls">
      <div role="group" aria-label={`${section.title} view`} className="ai-result-views">{viewOptions.filter(option => option.id !== "chart" || section.chart).map(({ id, label, icon: ViewIcon }) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}><ViewIcon aria-hidden="true" /><span>{label}</span></button>)}</div>
      {view !== "chart" && section.rows.length ? <div className="ai-result-filters">
        <label className="ai-result-search"><Search aria-hidden="true" /><input type="search" value={search} onChange={event => { setSearch(event.target.value); setExpanded(false); }} aria-label={`Search ${section.title.toLowerCase()}`} placeholder="Search results…" /></label>
        {statuses.length > 1 ? <select value={status} onChange={event => { setStatus(event.target.value); setExpanded(false); }} aria-label={`Filter ${section.title.toLowerCase()} by status`}><option value="all">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select> : null}
      </div> : null}
    </div>
    {view === "chart" ? <><RecordChart section={section} /><p className="ai-result-scope">Chart covers all {section.rows.length} reviewed records. Switch to Table to inspect or filter them.</p></> : !rows.length ? <p className="ai-result-empty">{section.rows.length ? "No records match these filters." : section.emptyMessage}</p> : view === "table" ? <div className="ai-result-table-scroll" tabIndex={0} role="region" aria-label={`${section.title} table`}><table><caption className="sr-only">{section.title} · {rows.length} records</caption><thead><tr>{section.columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{section.columns.map((column, index) => <td key={column.key}>{index === 0 && row.href ? <a href={row.href}>{row.cells[column.key] ?? "—"}<ArrowUpRight aria-hidden="true" /></a> : column.key === "status" || column.key === "stock" ? <span className="ai-result-badge" data-tone={row.tone}>{row.cells[column.key] ?? "—"}</span> : <span data-no-translate>{row.cells[column.key] ?? "—"}</span>}</td>)}</tr>)}</tbody></table></div> : <>
      <div className="ai-result-cards">{visible.map(row => <article key={row.id} className="ai-result-card" data-tone={row.tone}>
        <div className="ai-result-card-top"><Icon aria-hidden="true" /><span className="ai-result-badge" data-tone={row.tone}>{row.status}</span></div>
        <h4 data-no-translate>{row.href ? <a href={row.href}>{row.title}<ArrowUpRight aria-hidden="true" /></a> : row.title}</h4>
        {row.subtitle ? <p data-no-translate className="ai-result-subtitle">{row.subtitle}</p> : null}
        <dl>{section.columns.filter((column, index) => index > 0 && !["status", "customer", "name", "description"].includes(column.key)).map(column => <div key={column.key}><dt>{column.key === "due" || column.key === "date" ? <CalendarClock aria-hidden="true" /> : null}{column.label}</dt><dd data-no-translate>{row.cells[column.key] ?? "—"}</dd></div>)}</dl>
        {section.id === "invoices" && row.status === "Draft" ? <p className="ai-result-card-note">Draft · excluded from overdue balances</p> : null}
      </article>)}</div>
      {rows.length > 6 ? <button type="button" className="ai-result-show-more" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${rows.length} records`}</button> : null}
    </>}
    {section.rows.length ? <p className="ai-result-footer">{view === "chart" ? "Charts use the reviewed snapshot." : `${rows.length} of ${section.rows.length} reviewed records match your filters.`} CSV exports the matching rows.</p> : null}
  </section>;
}

export function AiResponsePresentation({ presentation, legacyText = "" }: { presentation?: ResponsePresentation | unknown; legacyText?: string }) {
  const original = useMemo(() => parseResponsePresentation(presentation), [presentation]);
  const references = useMemo(() => referencedRecords(legacyText), [legacyText]);
  const [loaded, setLoaded] = useState<ResponsePresentation>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const parsed = original ?? loaded;
  async function loadCards() {
    if (pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/ai/assistant/presentation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: references }), signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      const next = parseResponsePresentation(result.presentation);
      if (!response.ok || !next) throw new Error(result.error || "Unable to load record cards.");
      setLoaded(next); setPartial(result.partial === true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load record cards."); }
    finally { setPending(false); }
  }
  if (!parsed) return references.length ? <div className="ai-result-legacy"><button type="button" className="ai-result-export" disabled={pending} onClick={() => void loadCards()}><LayoutGrid aria-hidden="true" />{pending ? "Loading record cards…" : "Show record cards"}</button><p className="ai-result-scope">Load current saved values for up to ten linked records.</p>{error ? <p role="alert" className="ai-result-scope">{error}</p> : null}</div> : null;
  return <div className="ai-response-presentation">{partial ? <p className="ai-result-scope">Some linked records could not be loaded. Only available records are shown.</p> : null}{parsed.sections.map(section => <ResultSection key={section.id} section={section} />)}<p className="ai-result-snapshot">Snapshot: <time dateTime={parsed.capturedAt}>{new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed.capturedAt))}</time> · UTC+8</p></div>;
}
