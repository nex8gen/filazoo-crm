"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Download } from "lucide-react";
import { AnalyticsFilters, initialAnalyticsFilters } from "@/components/analytics-filters";
import { useLanguage } from "@/components/language-provider";
import { PageActions, PageHeaderDetails } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { useWorkspaceState } from "@/components/workspace-memory";
import {
  analyticsChange, analyticsCsv, channelLabels, computeAnalytics,
  type AnalyticsChannel, type AnalyticsDashboardData, type AnalyticsSource,
} from "@/lib/analytics-dashboard";
import styles from "./analytics-surface.module.css";

const AnalyticsChart = dynamic(() => import("./analytics-chart").then(module => module.AnalyticsChart), {
  loading: () => <div aria-busy="true" aria-label="Loading chart" className={styles.chartPlaceholder} />,
});
const SalesAndLeadsChart = dynamic(() => import("./analytics-chart").then(module => module.SalesAndLeadsChart), {
  loading: () => <div aria-busy="true" aria-label="Loading chart" className={styles.chartPlaceholder} />,
});
const AnalyticsSparkline = dynamic(() => import("./analytics-sparkline").then(module => module.AnalyticsSparkline));

const channelColors: Record<AnalyticsChannel, string> = {
  store: "#12ade9", direct: "#6745e8", meta: "#7298ed",
  partner: "#ac80dc", mixed: "#6bbcb3", other: "#98a3b2",
};

function Comparison({ current, previous }: { current: number; previous: number }) {
  const change = analyticsChange(current, previous);
  if (change === null) return <span className={styles.change} title="No prior activity">—</span>;
  const Arrow = change < 0 ? ArrowDownRight : ArrowUpRight;
  return <span className={styles.change} data-up={change > 0} title="Change vs comparison period">
    {change !== 0 && <Arrow aria-hidden size={12} />}{Math.abs(change).toFixed(0)}%
  </span>;
}

type AcquisitionProps = {
  channels: { channel: AnalyticsChannel; count: number }[];
  total: number;
  available: boolean;
  locale: string;
};

function Acquisition({ channels, total, available, locale }: AcquisitionProps) {
  const active = channels.filter(row => row.count > 0).sort((a, b) => b.count - a.count);
  let end = 0;
  const stops: string[] = [];
  for (const { channel, count } of active) {
    const start = end;
    end += count / total * 100;
    stops.push(`${channelColors[channel]} ${start}% ${end}%`);
  }
  const background = stops.length ? `conic-gradient(${stops.join(", ")})` : "var(--muted)";
  return <section className={styles.card}>
    <h2 className={styles.title}><Link href="/companies">Acquisition sources</Link></h2>
    {!available ? <p className={styles.empty}>Unavailable</p> : (
      <div className={styles.channelBody}>
        <div className={styles.ring} style={{ background }} aria-hidden>
          <span>{total.toLocaleString(locale)}</span>
        </div>
        {active.length ? <dl className={styles.legend}>
          {active.map(row => <div key={row.channel}>
            <dt><i style={{ background: channelColors[row.channel] }} />{channelLabels[row.channel]}</dt>
            <dd>{row.count.toLocaleString(locale)} <small>{Math.round(row.count / total * 100)}%</small></dd>
          </div>)}
        </dl> : <p className={styles.muted}>No new companies in this period.</p>}
      </div>
    )}
  </section>;
}

export function AnalyticsDashboard({ data }: { data: AnalyticsDashboardData }) {
  const [filters, setFilters] = useWorkspaceState("analytics.filters", () => initialAnalyticsFilters(data));
  const { language } = useLanguage();
  const locale = language === "zh-CN" ? "zh-CN" : "en-US";
  const report = useMemo(() => computeAnalytics(data, filters), [data, filters]);
  const { current, previous } = report;
  const count = new Intl.NumberFormat(locale);
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: filters.currency });
  const amount = (minor: number) => money.format(minor / 100);
  const ready = (...ids: AnalyticsSource["id"][]) => ids.every(id => data.sources.some(source => source.id === id && source.ok));
  const companiesReady = ready("companies");
  const orderReady = ready("companies", "orders");
  const billingReady = ready("companies", "invoices");
  const cashReady = billingReady && ready("payments");
  const catalogReady = ready("companies", "catalogs", "products");
  const compare = filters.comparison !== "none";
  const failedSources = data.sources.filter(source => !source.ok).map(source => source.label);
  const time = new Intl.DateTimeFormat(locale, { timeZone: "Asia/Shanghai", hour: "numeric", minute: "2-digit" }).format(new Date(data.asOf));
  const chartProps = { data: report.series, previousData: report.previousSeries, filters, locale, available: orderReady };
  const metrics = [
    { key: "orderValue", label: "Confirmed order value", current: current.orderValue, previous: previous.orderValue, format: amount, ready: orderReady },
    { key: "companies", label: "New companies", current: current.newCompanies, previous: previous.newCompanies, format: count.format, ready: companiesReady },
    { key: "collected", label: "Cash collected", current: current.collected, previous: previous.collected, format: amount, ready: cashReady },
    { key: "orders", label: "Orders", current: current.periodOrders.length, previous: previous.periodOrders.length, format: count.format, ready: orderReady },
  ] as const;
  const breakdown = [
    { label: "Confirmed order value", value: current.orderValue, prior: previous.orderValue, ready: orderReady },
    { label: "Invoiced", value: current.invoiced, prior: previous.invoiced, ready: billingReady },
    { label: "Cash collected", value: current.collected, prior: previous.collected, ready: cashReady },
    { label: "Outstanding balance", value: report.outstanding, ready: billingReady },
    { label: "Overdue balance", value: report.overdue, ready: billingReady },
  ];
  const largestProductCount = report.topProducts[0]?.count ?? 0;

  function exportReport() {
    const csv = analyticsCsv([
      ["Filazoo analytics", "Value"], ["From", filters.from], ["To", filters.to],
      ["Company source", filters.channel], ["Account owner", filters.owner], ["Currency", filters.currency],
      ["Comparison", filters.comparison], ["Snapshot at", data.asOf],
      ["New companies", companiesReady ? current.newCompanies : "Unavailable"],
      ["Orders", orderReady ? current.periodOrders.length : "Unavailable"],
      ["Average order value", orderReady && current.periodOrders.length ? current.orderValue / 100 / current.periodOrders.length : "Unavailable"],
      ...breakdown.map(row => [row.label, row.ready ? row.value / 100 : "Unavailable"]),
      ...report.channels.map(row => [`New companies: ${channelLabels[row.channel]}`, companiesReady ? row.count : "Unavailable"]),
      ...report.topProducts.map(row => [`Catalog selections: ${row.sku}`, catalogReady ? row.count : "Unavailable"]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `filazoo-analytics-${filters.from}-${filters.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className={styles.dashboard}>
    <PageHeaderDetails><span className={styles.muted}>Updated {time} CST</span></PageHeaderDetails>
    <PageActions>
      <div className="flex min-w-0 max-w-full items-center justify-end gap-2">
        <AnalyticsFilters value={filters} data={data} onChange={setFilters} />
        <Button type="button" size="sm" variant="outline" onClick={exportReport}>
          <Download aria-hidden="true" />Export CSV
        </Button>
      </div>
    </PageActions>
    {failedSources.length > 0 && <p role="status" className={styles.notice}>
      Some reports could not be loaded<span>: {failedSources.join(", ")}</span>
    </p>}
    <div className={styles.kpis}>
      {metrics.map(metric => <article key={metric.key} className={styles.kpi}>
        <div className={styles.kpiText}>
          <h2 className={styles.title}>{metric.label}</h2>
          <div className={styles.readout}>
            <strong>{metric.ready ? metric.format(metric.current) : "Unavailable"}</strong>
            {compare && metric.ready && <Comparison current={metric.current} previous={metric.previous} />}
          </div>
        </div>
        {metric.ready && <AnalyticsSparkline
          data={report.series}
          previousData={report.previousSeries}
          metric={metric.key}
          label={metric.label}
          locale={locale}
          formatValue={metric.key === "companies" || metric.key === "orders" ? count.format : money.format}
        />}
      </article>)}
    </div>
    <div className={styles.reports}>
      <div className={styles.primary}><SalesAndLeadsChart {...chartProps} companiesAvailable={companiesReady} /></div>
      <section className={styles.card}>
        <h2 className={styles.title}><Link href="/purchase-orders">Orders &amp; receivables</Link></h2>
        <dl className={styles.breakdown}>
          {breakdown.map(row => <div key={row.label}>
            <dt>{row.label}{row.prior === undefined && <small>Current</small>}</dt>
            <dd><strong>{row.ready ? amount(row.value) : "Unavailable"}</strong>
              {compare && row.ready && row.prior !== undefined && <Comparison current={row.value} previous={row.prior} />}
            </dd>
          </div>)}
        </dl>
      </section>
      <Acquisition channels={report.channels} total={current.newCompanies} available={companiesReady} locale={locale} />
      <AnalyticsChart {...chartProps} metric="averageOrderValue" compact />
      <section className={styles.card}>
        <h2 className={styles.title}><Link href="/company-quotations">Top catalog products</Link></h2>
        {!catalogReady ? <p className={styles.empty}>Unavailable</p> : report.topProducts.length === 0 ? (
          <p className={styles.empty}>No catalog product selections in this period.</p>
        ) : (
          <ol className={styles.ranks}>
            {report.topProducts.map(row => <li key={row.sku}>
              <Link href={`/products/${encodeURIComponent(row.sku)}`}>{row.name}</Link>
              <div><i style={{ width: `${row.count / largestProductCount * 100}%` }} /><span>{row.count} {row.count === 1 ? "catalog" : "catalogs"}</span></div>
            </li>)}
          </ol>
        )}
      </section>
    </div>
  </div>;
}
