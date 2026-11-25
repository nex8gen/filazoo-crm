"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { AnalyticsTrendPlot, type TrendPoint } from "@/components/ui/analytics-chart-card";
import { companyEmailAnalysis, type AnalysisRange, type CompanyAnalysisData, type companyPurchaseAnalysis } from "@/lib/company-analysis";
import surfaces from "./analytics-surface.module.css";
import styles from "./company-analysis.module.css";

type Copy = (en: string, zh: string) => string;
type PurchaseAnalysis = ReturnType<typeof companyPurchaseAnalysis>;
type Props = {
  companyId: string;
  data: CompanyAnalysisData;
  analysis: PurchaseAnalysis;
  range: AnalysisRange;
  locale: string;
  copy: Copy;
  money: (minor: number) => string;
  number: (value: number) => string;
};

function Trend({ title, value, points, options, onChange, selected, format, available = true, copy }: {
  title: string; value: string; points: TrendPoint[]; options: { key: string; label: string }[];
  onChange: (value: string) => void; selected: string; format: (value: number) => string;
  available?: boolean; copy: Copy;
}) {
  const heading = useId();
  return <section className={`${surfaces.surface} ${styles.trend}`} aria-labelledby={heading}>
    <header className={styles.chartHeader}>
      <div><h3 id={heading} className={surfaces.title}>{title}</h3><strong className={styles.chartValue}>{value}</strong></div>
      <div className={styles.switcher} role="group" aria-label={title}>
        {options.map(option => <button key={option.key} type="button" aria-pressed={selected === option.key}
          onClick={() => onChange(option.key)}>{option.label}</button>)}
      </div>
    </header>
    {available ? <AnalyticsTrendPlot size="full" label={title} data={points} currentLabel={copy("Selected period", "所选时间")} formatValue={format} />
      : <p className={styles.unavailable} role="status">{copy("Email history unavailable", "邮件记录暂不可用")}</p>}
    <table className="sr-only"><caption>{title}</caption><thead><tr><th scope="col">{copy("Month", "月份")}</th><th scope="col">{title}</th></tr></thead>
      <tbody>{available && points.map(point => <tr key={point.period}><th scope="row">{point.period}</th><td>{format(point.value ?? 0)}</td></tr>)}</tbody>
    </table>
  </section>;
}

export function CompanyAnalysisOverview({ companyId, data, analysis, range, locale, copy, money, number }: Props) {
  const [purchaseMetric, setPurchaseMetric] = useState("amountMinor");
  const [emailMetric, setEmailMetric] = useState("total");
  const email = useMemo(() => companyEmailAnalysis(data, { from: range.from, to: range.to }), [data, range.from, range.to]);
  const shortMonth = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const fullMonth = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const trend = (rows: { month: string; value: number }[]): TrendPoint[] => rows.map(row => {
    const date = new Date(`${row.month}-01T00:00:00Z`);
    return { tick: shortMonth.format(date), period: fullMonth.format(date), value: row.value, previousPeriod: "", previous: null };
  });
  const purchaseRows = analysis.months.map(month => {
    const orders = analysis.orders.filter(order => order.orderDate.startsWith(month.month));
    return { ...month, orders: orders.length, quantity: orders.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0) };
  });
  const purchasePoints = (metric: string) => trend(purchaseRows.map(row => ({ month: row.month, value: metric === "orders" ? row.orders : metric === "quantity" ? row.quantity : row.amountMinor })));
  const emailPoints = (metric: string) => trend(email.months.map(row => ({ month: row.month, value: metric === "sent" ? row.sent : metric === "received" ? row.received : row.total })));
  const metrics = [
    { label: copy("Purchase value", "采购金额"), value: money(analysis.amountMinor), points: purchasePoints("amountMinor"), format: money },
    { label: copy("Orders", "订单"), value: number(analysis.orderCount), points: purchasePoints("orders"), format: number },
    { label: copy("Units purchased", "采购数量"), value: number(analysis.quantity), points: purchasePoints("quantity"), format: number },
    { label: copy("Average order value", "平均订单金额"), value: money(analysis.averageMinor), points: trend(purchaseRows.map(row => ({ month: row.month, value: row.orders ? row.amountMinor / row.orders : 0 }))), format: money },
    { label: copy("Total emails", "邮件总数"), value: number(email.total), points: emailPoints("total"), format: number, email: true },
    { label: copy("Emails sent", "已发送邮件"), value: number(email.sent), points: emailPoints("sent"), format: number, email: true },
    { label: copy("Emails received", "已接收邮件"), value: number(email.received), points: emailPoints("received"), format: number, email: true },
    { label: copy("Conversations", "会话数"), value: number(email.conversations), email: true },
  ];
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(value));
  const activity = [
    { label: copy("Last contact", "最近联系"), value: email.lastContact ? date(email.lastContact) : "—", email: true },
    { label: copy("Awaiting customer", "等待客户回复"), value: number(email.waitingOnCustomer), email: true },
    { label: copy("Awaiting our reply", "等待我们回复"), value: number(email.waitingOnUs), email: true },
    { label: copy("Our reply time", "我们的回复时间"), value: email.averageResponseHours === null ? "—" : copy(`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(email.averageResponseHours)} h`, `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(email.averageResponseHours)} 小时`), email: true,
      title: copy("Average elapsed time from a customer's first unanswered email to our next reply. Automated messages excluded.", "从客户第一封未回复邮件到我们下一次回复的平均时间，不含自动回复。") },
    { label: copy("Products purchased", "已采购产品"), value: number(analysis.products.length) },
    { label: copy("Last order", "最近订单"), value: analysis.latest?.orderDate ? date(`${analysis.latest.orderDate}T00:00:00+08:00`) : "—", title: copy("Latest confirmed order across all dates in this currency.", "当前币种的历史最近有效订单。") },
  ];

  return <>
    <div className={surfaces.kpis}>
      {metrics.map(metric => <article key={metric.label} className={surfaces.kpi}>
        <div className={surfaces.kpiText}><h3 className={surfaces.title}>{metric.label}</h3>
          <div className={surfaces.readout}><strong>{metric.email && !email.available ? "—" : metric.value}</strong></div>
        </div>
        {metric.points && (!metric.email || email.available) && <AnalyticsTrendPlot size="sparkline" label={metric.label} data={metric.points} currentLabel={copy("Selected period", "所选时间")} formatValue={metric.format} />}
      </article>)}
    </div>
    {(!email.available || email.partial) && <p className={styles.sourceNotice} role="status">{email.available
      ? copy("Email totals cover the available synced history.", "邮件统计基于当前可用的同步记录。")
      : copy("Email history could not be loaded. Refresh to retry.", "邮件记录加载失败，请刷新重试。")}</p>}
    <div className={styles.charts}>
      <Trend title={copy("Purchases", "采购趋势")} value={purchaseMetric === "orders" ? number(analysis.orderCount) : purchaseMetric === "quantity" ? number(analysis.quantity) : money(analysis.amountMinor)}
        points={purchasePoints(purchaseMetric)} selected={purchaseMetric} onChange={setPurchaseMetric} format={purchaseMetric === "amountMinor" ? money : number} copy={copy}
        options={[{ key: "amountMinor", label: copy("Value", "金额") }, { key: "orders", label: copy("Orders", "订单") }, { key: "quantity", label: copy("Units", "数量") }]} />
      <Trend title={copy("Email activity", "邮件趋势")} value={email.available ? number(emailMetric === "sent" ? email.sent : emailMetric === "received" ? email.received : email.total) : "—"}
        points={emailPoints(emailMetric)} selected={emailMetric} onChange={setEmailMetric} format={number} available={email.available} copy={copy}
        options={[{ key: "total", label: copy("All", "全部") }, { key: "sent", label: copy("Sent", "发送") }, { key: "received", label: copy("Received", "接收") }]} />
    </div>
    <div className={styles.details}>
      <section className={surfaces.card} aria-label={copy("Customer activity", "客户动态")}>
        <h3 className={surfaces.title}><Link href={`/companies/${companyId}?tab=email`}>{copy("Customer activity", "客户动态")}</Link></h3>
        <dl className={surfaces.breakdown}>{activity.map(row => <div key={row.label} title={row.title}><dt>{row.label}</dt><dd>{row.email && !email.available ? "—" : row.value}</dd></div>)}</dl>
      </section>
      <section className={surfaces.card} aria-label={copy("Top products", "主要产品")}>
        <h3 className={surfaces.title}>{copy("Top products", "主要产品")}</h3>
        {analysis.products.length ? <div className={styles.products}>{analysis.products.slice(0, 5).map(product => <div key={product.key}>
          <div className={styles.productLabel}><span>{product.name}</span><span>{money(product.amountMinor)} <small>{new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(product.share)}</small></span></div>
          <div role="meter" aria-label={product.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={product.share * 100} className={styles.productTrack}><i style={{ width: `${product.share * 100}%` }} /></div>
        </div>)}</div> : <p className={surfaces.empty}>{copy("No purchases yet", "暂无采购记录")}</p>}
      </section>
    </div>
  </>;
}
