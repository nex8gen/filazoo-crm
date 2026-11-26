"use client";

import { useId, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowUpRight, Boxes, ChevronRight, Download, FileText, LayoutGrid, ListChecks, Package, ReceiptText, Reply, Search, Users } from "lucide-react";
import { conversationMessagesSchema, parseResponsePresentation, presentationCsv, referencedRecords, type ConversationMessages, type CustomerConversations, type ResponsePresentation, type ResponseSection } from "@/lib/ai/response-presentation";
import "./ai-response-presentation.css";

const icons = { invoices: ReceiptText, orders: Package, quotations: FileText, companies: Users, tasks: ListChecks, products: Boxes, inventory: Boxes, segments: Users };
const ChatTrendPlot = dynamic(() => import("@/components/ui/analytics-chart-card").then(module => module.AnalyticsTrendPlot), {
  loading: () => <div className="ai-result-chart-loading" aria-busy="true" />,
});
const formatChartValue = (value: number) => value.toLocaleString("en", { maximumFractionDigits: 2 });
const conversationDate = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function ConversationRow({ companyId, thread }: { companyId: string; thread: CustomerConversations["threads"][number] }) {
  const [messages, setMessages] = useState<ConversationMessages>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function load() {
    if (pending || messages) return;
    setPending(true); setError(false);
    try {
      const response = await fetch(`/api/ai/assistant/conversations?${new URLSearchParams({ companyId, threadId: thread.id })}`, { signal: AbortSignal.timeout(55_000), cache: "no-store" });
      const parsed = conversationMessagesSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("Conversation unavailable");
      setMessages(parsed.data);
    } catch { setError(true); }
    finally { setPending(false); }
  }
  return <details className="ai-conversation" onToggle={event => { if (event.currentTarget.open) void load(); }}>
    <summary><ChevronRight className="ai-conversation-chevron" aria-hidden="true" /><span className="ai-conversation-sender" data-no-translate>{thread.sender}</span><span className="ai-conversation-subject" data-no-translate>{thread.subject || "(No subject)"}</span>{thread.direction === "outbound" ? <Reply className="ai-conversation-replied" aria-label="Sent reply" /> : <span />}<time dateTime={thread.timestamp} data-no-translate>{conversationDate.format(new Date(thread.timestamp))}</time></summary>
    <div className="ai-conversation-messages" aria-busy={pending}>
      {pending ? <span className="ai-conversation-loading" role="status">Loading conversation…</span> : null}
      {error ? <button type="button" className="ai-result-show-more" onClick={() => void load()}>Unable to load conversation. Retry</button> : null}
      {messages?.messages.map(message => <article key={message.id} data-direction={message.direction}>
        <header><span data-no-translate>{message.sender}</span><time dateTime={message.timestamp} data-no-translate>{conversationDate.format(new Date(message.timestamp))}</time></header>
        {message.available ? <p data-no-translate>{message.body}</p> : <a href={`/companies/${companyId}?tab=email`}>Open message in email</a>}
        {message.truncated ? <a href={`/companies/${companyId}?tab=email`}>Open full message</a> : null}
      </article>)}
      {messages?.more ? <a href={`/companies/${companyId}?tab=email`}>View full conversation</a> : null}
    </div>
  </details>;
}

function ConversationList({ customers }: { customers: CustomerConversations[] }) {
  return <div className="ai-customer-conversations">{customers.map(customer => <section key={customer.companyId} aria-label={`${customer.companyName} conversations`}>
    {customers.length > 1 ? <h3 data-no-translate>{customer.companyName}</h3> : null}
    {customer.threads.map(thread => <ConversationRow key={thread.id} companyId={customer.companyId} thread={thread} />)}
    {!customer.threads.length ? <p className="ai-result-empty">{customer.state === "unavailable" ? "Conversations unavailable." : "No saved conversations."}</p> : null}
    {customer.more ? <a className="ai-conversation-more" href={`/companies/${customer.companyId}?tab=email`} aria-label={`View all ${customer.companyName} conversations`}><ArrowUpRight aria-hidden="true" /></a> : null}
  </section>)}</div>;
}

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
  return <figure className="ai-result-chart">
    <figcaption><div><h4>{chart.title}</h4><span>{chart.unit}</span></div><span>All {section.rows.length} reviewed records</span></figcaption>
    {chart.kind === "line" ? <ChatTrendPlot
      data={chart.points.map(point => ({ tick: point.label, period: point.label, value: point.value, previousPeriod: "", previous: null }))}
      currentLabel={chart.unit} formatValue={formatChartValue} size="chat" label={chart.title} showDots
    /> : null}
    <ul className={chart.kind === "line" ? "sr-only" : undefined} aria-label={chart.title}>{chart.points.map(point => <li key={point.label}>
      <span className="ai-result-chart-label" title={point.label}>{point.label}</span>
      {chart.kind !== "line" ? <span className="ai-result-chart-track" aria-hidden="true"><span style={{ width: `${point.value / maximum * 100}%` }} /></span> : null}
      <strong data-no-translate>{formatChartValue(point.value)}</strong>
    </li>)}</ul>
  </figure>;
}

function ResultSection({ section }: { section: ResponseSection }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const Icon = icons[section.id];
  const rows = useMemo(() => section.rows.filter(row => (status === "all" || row.status === status) && (!search.trim() || Object.values(row.cells).join(" ").toLowerCase().includes(search.trim().toLowerCase()))), [section.rows, search, status]);
  const statuses = [...new Set(section.rows.map(row => row.status))];
  const visible = expanded ? rows : rows.slice(0, 6);
  const summaryMetrics = section.metrics.filter(metric => metric.label !== "Records reviewed");

  return <section className="ai-result-section" aria-labelledby={headingId}>
    <header className="ai-result-header">
      <div className="ai-result-heading"><Icon aria-hidden="true" /><h3 id={headingId}>{section.title}</h3><span className="ai-result-count" data-no-translate>{section.rows.length}</span></div>
      <button type="button" className="ai-result-export" onClick={() => downloadCsv({ ...section, rows })} disabled={!rows.length}><Download aria-hidden="true" />Export CSV</button>
    </header>
    {summaryMetrics.length ? <div className="ai-result-metrics">{summaryMetrics.map(metric => <div key={`${metric.label}-${metric.value}`} data-tone={metric.tone}><span>{metric.label}</span><strong data-no-translate>{metric.value}</strong></div>)}</div> : null}
    {section.rows.length ? <div className="ai-result-controls">
      <div className="ai-result-filters">
        <label className="ai-result-search"><Search aria-hidden="true" /><input type="search" value={search} onChange={event => { setSearch(event.target.value); setExpanded(false); }} aria-label={`Search ${section.title.toLowerCase()}`} placeholder="Search results…" /></label>
        {statuses.length > 1 ? <select value={status} onChange={event => { setStatus(event.target.value); setExpanded(false); }} aria-label={`Filter ${section.title.toLowerCase()} by status`}><option value="all">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select> : null}
      </div>
    </div> : null}
    {!rows.length ? <p className="ai-result-empty">{section.rows.length ? "No records match these filters." : section.emptyMessage}</p> : <>
      <section className="ai-result-block" aria-labelledby={`${headingId}-cards`}>
      <h4 id={`${headingId}-cards`} className="ai-result-block-title">Cards</h4>
      <div className="ai-result-cards">{visible.map(row => <article key={row.id} className="ai-result-card" data-tone={row.tone}>
        <h5 data-no-translate>{row.href ? <a href={row.href}>{row.title}<ArrowUpRight aria-hidden="true" /></a> : row.title}</h5>
        {row.subtitle ? <p data-no-translate className="ai-result-subtitle">{row.subtitle}</p> : null}
        <span className="ai-result-badge" data-tone={row.tone}>{row.status}</span>
        <dl>{section.columns.filter((column, index) => index > 0 && !["status", "stock", "customer", "name", "description"].includes(column.key) && row.cells[column.key] != null && !["Not set", "Unknown", ""].includes(String(row.cells[column.key]))).map(column => <div key={column.key}><dt>{column.label}</dt><dd data-no-translate>{row.cells[column.key]}</dd></div>)}</dl>
        {section.id === "invoices" && row.status === "Draft" ? <p className="ai-result-card-note">Draft · excluded from overdue balances</p> : null}
      </article>)}</div>
      {rows.length > 6 ? <button type="button" className="ai-result-show-more" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${rows.length} records`}</button> : null}
      </section>
      <section className="ai-result-block" aria-labelledby={`${headingId}-table`}>
        <h4 id={`${headingId}-table`} className="ai-result-block-title">Table</h4>
        <div className="ai-result-table-scroll" tabIndex={0} role="region" aria-label={`${section.title} table`}><table><caption className="sr-only">{section.title} · {rows.length} records</caption><thead><tr>{section.columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{section.columns.map((column, index) => <td key={column.key}>{index === 0 && row.href ? <a href={row.href} data-no-translate>{row.cells[column.key] ?? "—"}<ArrowUpRight aria-hidden="true" /></a> : column.key === "status" || column.key === "stock" ? <span className="ai-result-badge" data-tone={row.tone}>{row.cells[column.key] ?? "—"}</span> : <span data-no-translate>{row.cells[column.key] ?? "—"}</span>}</td>)}</tr>)}</tbody></table></div>
      </section>
    </>}
    {section.chart ? <section className="ai-result-block" aria-label={`${section.title} chart`}><RecordChart section={section} /></section> : null}
    <footer className="ai-result-footer">
      {section.rows.length ? <span>{rows.length} of {section.rows.length} reviewed</span> : null}
      <details className="ai-result-details"><summary>Source details</summary><p>{section.description}</p><p>CSV exports the matching rows.</p></details>
    </footer>
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
  return <div className="ai-response-presentation">{parsed.conversations?.length ? <ConversationList customers={parsed.conversations} /> : null}{partial ? <p className="ai-result-scope">Some linked records could not be loaded. Only available records are shown.</p> : null}{parsed.sections.map(section => <ResultSection key={section.id} section={section} />)}{parsed.sections.length ? <p className="ai-result-snapshot">Snapshot: <time dateTime={parsed.capturedAt}>{new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(parsed.capturedAt))}</time> · UTC+8</p> : null}</div>;
}
