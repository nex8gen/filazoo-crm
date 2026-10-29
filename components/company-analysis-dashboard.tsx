"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, Download, Package, Plus, RefreshCw, Sparkles } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { createAnalysisFollowup, loadCompanyAnalysis } from "@/app/company-analysis-actions";
import { useLanguage } from "@/components/language-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { followupInstant } from "@/lib/company-followup";
import { analysisDaysAgo, analysisTaskMarker, analysisToday, companyAnalysisCsv, companyPurchaseAnalysis, type AnalysisOrder, type CompanyAnalysisData, type ProductReminder } from "@/lib/company-analysis";

type Period = "all" | "180" | "90" | "custom";
type Copy = (en: string, zh: string) => string;
const statusNames = {
  draft: ["Draft", "草稿"], confirmed: ["Confirmed", "已确认"], in_production: ["In production", "生产中"],
  shipped: ["Shipped", "运输中"], completed: ["Completed", "已完成"], cancelled: ["Cancelled", "已取消"],
};
const reminderNames = {
  receipt: ["Confirm receipt & usage", "确认收货与使用"], fulfillment: ["Check fulfillment", "确认订单履约"],
  restock: ["Confirm replenishment", "确认补货需求"], demand: ["Review changing needs", "了解采购变化"],
  history: ["Understand product needs", "了解产品需求"], monitor: ["Monitor usage", "跟进使用情况"],
};
const panelClass = "min-w-0 rounded-xl border bg-card";
function orderTotal(order: AnalysisOrder) { return order.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0); }
function Status({ status, copy }: { status: AnalysisOrder["status"]; copy: Copy }) {
  return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${status === "completed" || status === "shipped" ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground"}`}>{copy(statusNames[status][0], statusNames[status][1])}</span>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-5 py-8 text-center text-sm text-muted-foreground"><Package className="size-7 opacity-50" />{children}</div>;
}
function reminderDetail(reminder: ProductReminder, copy: Copy) {
  switch (reminder.kind) {
    case "receipt": return copy("The latest order is marked shipped. Confirm delivery and product feedback before discussing another purchase.", "最近订单标记为运输中。建议先确认物流、收货与使用反馈，再讨论追加采购。");
    case "fulfillment": return copy("The latest order is still being fulfilled. Confirm production and delivery progress before discussing replenishment.", "最近订单仍在履约中。建议先确认生产与交付进度，再讨论补货。");
    case "restock": return copy(`${reminder.daysSince} days since the last purchase; the recent average interval is ${reminder.averageGap} days. Ask about stock and the next order. Stock depletion is not confirmed.`, `距最近采购 ${reminder.daysSince} 天，近期平均采购间隔 ${reminder.averageGap} 天。建议询问库存与下一批数量，不推定客户已缺货。`);
    case "demand": return copy("Purchase intervals vary considerably. Check whether material needs have changed before agreeing a replenishment date.", "历史采购间隔波动较大。建议先确认材料需求是否变化，暂不预测固定补货日期。");
    case "history": return copy("Fewer than three distinct purchase dates are available. Ask about usage and future needs before estimating a purchase cycle.", "历史采购不足三个不同日期。建议先了解使用情况与后续需求，暂不推测采购周期。");
    case "monitor": return copy(`${reminder.daysSince} days since the last purchase; the recent average interval is ${reminder.averageGap} days. Check usage before planning the next purchase.`, `距最近采购 ${reminder.daysSince} 天，近期平均间隔 ${reminder.averageGap} 天。建议先了解使用情况，再安排下一次采购。`);
  }
}

export function CompanyAnalysisDashboard({ companyId, canWrite, preferredCurrency, initial }: { companyId: string; canWrite: boolean; preferredCurrency: string; initial: CompanyAnalysisData | null }) {
  const { language } = useLanguage();
  const copy: Copy = (en, zh) => language === "zh-CN" ? zh : en;
  const locale = language === "zh-CN" ? "zh-CN" : "en-US";
  // Use refreshed server props after edits in the other company tabs.
  const [loaded, setLoaded] = useState<{ source: CompanyAnalysisData | null; data: CompanyAnalysisData } | null>(null);
  const data = loaded?.source === initial ? loaded.data : initial;
  const [period, setPeriod] = useState<Period>("180");
  const [selectedCurrency, setCurrency] = useState("");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [showAllReminders, setShowAllReminders] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<AnalysisOrder | null>(null);
  const [reminder, setReminder] = useState<ProductReminder | null>(null);
  const [dueAt, setDueAt] = useState("");
  const [taskError, setTaskError] = useState("");
  const [taskPending, startTaskTransition] = useTransition();
  const [savedTasks, setSavedTasks] = useState<CompanyAnalysisData["tasks"]>([]);
  const requestId = useRef("");
  const [notice, setNotice] = useState("");
  const gradientId = useId().replaceAll(":", "");
  const today = data ? analysisToday(new Date(data.asOf)) : "";
  const currencies = [...new Set(data?.orders.map(order => order.currency) ?? [])].sort();
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : currencies.includes(preferredCurrency) ? preferredCurrency : currencies[0] || preferredCurrency || "USD";
  const range = { from: period === "all" ? "" : period === "custom" ? custom.from : today ? analysisDaysAgo(today, Number(period) - 1) : "", to: period === "custom" ? custom.to : today };
  const validRange = period !== "custom" || Boolean(range.from && range.to && range.from <= range.to && range.to <= today);
  const analysis = data && validRange ? companyPurchaseAnalysis(data, currency, range) : null;
  const money = (minor: number) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const allOrdersHref = `/companies/${companyId}?tab=purchase-orders`;
  const tasks = [...(data?.tasks ?? []), ...savedTasks];

  function refresh() {
    startTransition(async () => {
      try { setLoaded({ source: initial, data: await loadCompanyAnalysis(companyId) }); setSavedTasks([]); setError(""); }
      catch { setError(copy("Analysis could not be refreshed. Please try again.", "无法刷新采购分析，请重试。")); }
    });
  }
  function exportOrders() {
    if (!analysis?.orders.length) return;
    const url = URL.createObjectURL(new Blob([companyAnalysisCsv(analysis.orders)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url; link.download = `company-purchases-${companyId}-${currency}-${range.from || "all"}-${range.to}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function openFollowup(item: ProductReminder) {
    setReminder(item); setTaskError(""); setDueAt(""); setNotice(""); requestId.current = crypto.randomUUID();
  }
  function saveFollowup() {
    if (!reminder) return;
    startTaskTransition(async () => {
      try {
        const result = await createAnalysisFollowup({ companyId, productKey: reminder.key, currency, dueAt: followupInstant(dueAt), requestId: requestId.current });
        if (result.error) { setTaskError(result.error); return; }
        if (!result.task) throw new Error("No task returned");
        window.dispatchEvent(new Event("flow-activity-updated"));
        setSavedTasks(current => [...current, result.task]); setReminder(null);
        setNotice(copy("Product follow-up saved to CRM tasks.", "产品跟进已保存到 CRM 任务。"));
      } catch { setTaskError(copy("The follow-up could not be confirmed. Please try again.", "无法确认跟进任务是否保存，请重试。")); }
    });
  }

  return <section data-no-translate aria-label={copy("Company purchase analysis", "客户采购分析")} className="space-y-5 pb-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-lg font-semibold tracking-tight">{copy("Customer purchase overview", "客户采购概览")}</h2><p className="mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground">{copy("Confirmed order line amounts · Drafts and cancelled orders excluded · Order-date basis", "按确认订单商品金额统计 · 不计草稿及取消订单 · 按下单日期筛选")}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={copy("Purchase date range", "采购日期范围")} className="flex rounded-lg border p-1">
          {(["all", "180", "90", "custom"] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => { if (value === "custom" && !custom.from) setCustom({ from: analysisDaysAgo(today, 179), to: today }); setPeriod(value); }} disabled={!data} className={`h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${period === value ? "bg-brand-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{value === "all" ? copy("All time", "全部时间") : value === "custom" ? copy("Custom", "自定义") : copy(`${value} days`, `近${value}天`)}</button>)}
        </div>
        <Select value={currency} onValueChange={(selectedValue) => { if (selectedValue === null) return; setCurrency(selectedValue); }} disabled={!data}><SelectTrigger aria-label={copy("Analysis currency", "分析币种")} size="sm"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([currency, ...currencies])].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" size="sm" onClick={exportOrders} disabled={!analysis?.orders.length || pending}><Download />{copy("Export orders", "导出订单")}</Button>
        <Button variant="outline" size="icon-sm" onClick={refresh} disabled={pending} aria-label={copy("Refresh analysis", "刷新分析")}><RefreshCw className={pending ? "animate-spin" : ""} /></Button>
      </div>
    </header>
    {period === "custom" ? <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3"><div className="space-y-1.5"><Label htmlFor="analysis-from">{copy("From", "开始日期")}</Label><Input id="analysis-from" type="date" value={custom.from} max={today} onChange={event => setCustom(current => ({ ...current, from: event.target.value }))} /></div><div className="space-y-1.5"><Label htmlFor="analysis-to">{copy("To", "结束日期")}</Label><Input id="analysis-to" type="date" value={custom.to} min={custom.from} max={today} onChange={event => setCustom(current => ({ ...current, to: event.target.value }))} /></div>{!validRange ? <p role="alert" className="pb-2 text-xs text-destructive">{copy("Choose a valid date range ending on or before today.", "请选择有效日期范围，结束日期不可晚于今天。")}</p> : null}</div> : null}
    {error || !data ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"><p>{error || copy("Purchase analysis is unavailable. Your records could not be loaded.", "采购分析暂不可用，无法加载真实订单记录。")}</p><Button variant="outline" size="sm" disabled={pending} onClick={refresh}>{copy("Try again", "重试")}</Button></div> : null}
    {data ? <p className="text-[11px] text-muted-foreground">{copy("Updated", "更新于")} {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(data.asOf))} · UTC+8 · {currency}{currencies.length > 1 ? copy(" · Each currency is shown separately; no FX conversion.", " · 各币种独立统计，未进行汇率换算。") : ""}</p> : null}
    {analysis ? <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: copy("Total purchase GMV", "累计采购 GMV"), value: money(analysis.amountMinor), hint: copy("Selected period", "所选时间") + ` · ${currency}` },
          { label: copy("Effective orders", "有效订单"), value: number(analysis.orderCount), hint: copy("Drafts and cancellations excluded", "不含草稿及取消订单") },
          { label: copy("Purchased quantity", "累计采购数量"), value: number(analysis.quantity), hint: copy("Units recorded on order lines", "以订单行记录的商品数量为准") },
          { label: copy("Average order value", "平均订单金额"), value: money(analysis.averageMinor), hint: analysis.latest ? copy(`Latest order: ${analysis.latest.orderDate}`, `历史最近有效订单：${analysis.latest.orderDate}`) : copy("No effective orders yet", "暂无有效订单") }].map(metric => <Card key={metric.label} className="rounded-xl py-5 shadow-none ring-border"><CardContent><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-3 break-words text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</p><p className="mt-2 text-[11px] leading-5 text-muted-foreground">{metric.hint}</p></CardContent></Card>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <section className={`${panelClass} p-5`} aria-labelledby="purchase-trend-heading"><div className="flex items-center justify-between gap-3"><h3 id="purchase-trend-heading" className="text-sm font-medium">{copy("Purchase amount trend", "采购金额趋势")}</h3><span className="text-[11px] text-muted-foreground">{copy("By calendar month", "按自然月汇总")}</span></div><div className="my-3 flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-primary" />{copy("Confirmed order GMV", "确认订单 GMV")} ({currency})</div>
          {analysis.orders.length ? <><ChartContainer config={{ amountMinor: { label: copy("Purchase GMV", "采购 GMV"), color: "var(--primary)" } }} className="h-60 w-full aspect-auto"><AreaChart accessibilityLayer data={analysis.months} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={12} minTickGap={28} /><YAxis axisLine={false} tickLine={false} width={56} tickFormatter={value => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value / 100)} /><Tooltip formatter={value => [money(Number(value)), copy("Purchase GMV", "采购 GMV")]} contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} /><Area type="linear" dataKey="amountMinor" stroke="var(--primary)" strokeWidth={2.2} fill={`url(#${gradientId})`} dot={{ r: 3, strokeWidth: 2, fill: "var(--card)" }} isAnimationActive={false} /></AreaChart></ChartContainer><details className="mt-2 text-xs"><summary className="w-fit cursor-pointer text-muted-foreground">{copy("View monthly data", "查看月度数据")}</summary><div className="mt-3 max-h-48 overflow-auto"><table className="w-full text-left"><caption className="sr-only">{copy("Monthly purchase GMV", "月度采购 GMV")}</caption><thead><tr><th className="py-2 font-medium">{copy("Month", "月份")}</th><th className="py-2 text-right font-medium">{currency}</th></tr></thead><tbody>{analysis.months.map(month => <tr key={month.month} className="border-t"><td className="py-2">{month.month}</td><td className="py-2 text-right tabular-nums">{money(month.amountMinor)}</td></tr>)}</tbody></table></div></details></> : <Empty>{copy("No effective purchase orders in this period.", "所选时间内暂无有效采购订单。")}</Empty>}
        </section>
        <section className={`${panelClass} p-5`} aria-labelledby="product-mix-heading"><div className="mb-6 flex items-center justify-between gap-3"><h3 id="product-mix-heading" className="text-sm font-medium">{copy("Purchased product mix", "采购产品构成")}</h3><span className="text-[11px] text-muted-foreground">{copy("Share of GMV", "按 GMV 占比")}</span></div>{analysis.products.length ? <div className="max-h-72 space-y-5 overflow-y-auto pr-1">{analysis.products.map((product, index) => <div key={product.key}><div className="mb-2 flex items-start justify-between gap-3 text-xs"><span className="min-w-0 break-words leading-5">{product.name}</span><span className="shrink-0 tabular-nums">{money(product.amountMinor)} <span className="text-[11px] text-muted-foreground">· {(product.share * 100).toFixed(1)}%</span></span></div><div role="meter" aria-label={product.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number((product.share * 100).toFixed(1))} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${product.share * 100}%`, opacity: Math.max(0.35, 1 - index * 0.15) }} /></div></div>)}</div> : <Empty>{copy("Product mix appears after an effective purchase order is recorded.", "记录有效采购订单后，即可查看产品构成。")}</Empty>}</section>
      </div>
      <section className="rounded-xl border border-primary/15 bg-brand-soft p-5" aria-labelledby="purchase-summary-heading"><h3 id="purchase-summary-heading" className="flex items-center gap-2 text-sm font-medium text-primary"><Sparkles className="size-4" />{copy("Customer overview", "客户总体情况")}</h3><p className="mt-2 text-sm leading-7">{analysis.orderCount ? <>{copy("In the selected period: ", "所选时间内：")}<strong>{number(analysis.orderCount)}</strong> {copy("orders", "笔订单")} · <strong>{number(analysis.quantity)}</strong> {copy("units", "件商品")} · {copy("GMV", "采购 GMV")} <strong>{money(analysis.amountMinor)}</strong>. {analysis.products[0] ? <>{copy("Top product: ", "主要采购：")}<strong>{analysis.products[0].name}</strong> ({(analysis.products[0].share * 100).toFixed(1)}%). </> : null}{analysis.peak ? <>{copy("Peak month: ", "月度采购峰值：")}<strong>{analysis.peak.month}</strong> ({money(analysis.peak.amountMinor)}). </> : null}</> : copy("No effective purchase orders in the selected period. Choose another date range or record a confirmed order.", "所选时间内暂无有效采购订单。可调整时间范围，或录入已确认订单。")}{analysis.latest ? <> {copy("Latest effective order in full history: ", "历史最近有效订单：")}{analysis.latest.orderDate} · {copy(statusNames[analysis.latest.status][0], statusNames[analysis.latest.status][1])}. {analysis.latest.status === "shipped" ? copy("Confirm receipt and usage feedback.", "建议先确认收货与使用反馈。") : analysis.latest.status === "confirmed" || analysis.latest.status === "in_production" ? copy("Check fulfillment and delivery progress.", "建议确认履约与交付进度。") : copy("Review product usage and future purchasing needs.", "建议了解使用情况与后续采购需求。")}</> : null}</p></section>
      <section aria-labelledby="product-followups-heading" className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="product-followups-heading" className="text-sm font-medium">{copy("Product follow-up reminders", "商品跟进提醒")}</h3><p className="text-[11px] text-muted-foreground">{copy("Full purchase history · Independent of date filter · Confirm before acting", "基于完整历史 · 不随时间筛选变化 · 人工确认后执行")}</p></div>
        {notice ? <p role="status" className="text-xs text-primary">{notice}</p> : null}
        {analysis.reminders.length ? <><div className="grid gap-3 lg:grid-cols-3">{analysis.reminders.slice(0, showAllReminders ? undefined : 3).map(item => { const task = tasks.find(task => task.notes === analysisTaskMarker(item.key)); return <div key={item.key} className={`${panelClass} flex flex-col p-4`}><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words text-sm font-medium">{item.name}</h4><span className={`rounded px-2 py-1 text-[10px] font-medium ${item.kind === "restock" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-brand-soft text-primary"}`}>{copy(reminderNames[item.kind][0], reminderNames[item.kind][1])}</span></div>{item.sku ? <p className="mt-1 break-all text-[11px] text-muted-foreground">{item.sku}</p> : null}<p className="mt-3 text-xs leading-5 text-muted-foreground">{copy("Last purchase", "最近采购")}: {item.lastDate} · {number(item.lastQuantity)} {copy("units", "件")}</p><p className="mb-4 mt-1 flex-1 text-xs leading-6 text-muted-foreground">{reminderDetail(item, copy)}</p>{task ? <p className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-primary"><Check className="size-3.5" />{copy("Follow-up scheduled", "已创建跟进")}{task.due_at ? ` · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(task.due_at))}` : ""}</p> : canWrite ? <Button variant="outline" size="sm" className="w-full text-xs text-primary" onClick={() => openFollowup(item)}><Plus />{copy("Create follow-up", "创建跟进任务")}</Button> : <p className="text-xs text-muted-foreground">{copy("Viewer access is read-only.", "查看者仅具备只读权限。")}</p>}</div>; })}</div>{analysis.reminders.length > 3 ? <Button variant="ghost" size="sm" onClick={() => setShowAllReminders(value => !value)}>{showAllReminders ? copy("Show fewer products", "收起产品") : copy(`View all ${analysis.reminders.length} products`, `查看全部 ${analysis.reminders.length} 个产品`)}</Button> : null}</> : <Empty>{copy("Product follow-ups appear after an effective purchase order is recorded.", "记录有效采购订单后，即可查看商品跟进提醒。")}</Empty>}
      </section>
      <section className={`${panelClass} p-5`} aria-labelledby="recent-orders-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 id="recent-orders-heading" className="text-sm font-medium">{copy("Recent orders", "最近订单")}</h3><div className="flex items-center gap-3"><span className="text-[11px] text-muted-foreground">{copy("Selected period · By order date", "所选时间 · 按下单日期")}</span><Link href={allOrdersHref} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{copy("View all", "查看全部")}<ArrowRight className="size-3" /></Link></div></div>
        {analysis.orders.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><caption className="sr-only">{copy("Five most recent effective orders in the selected period", "所选时间内最近五笔有效订单")}</caption><thead className="bg-muted/50 text-muted-foreground"><tr>{[copy("Order / date", "订单编号 / 日期"), copy("Purchased items", "采购内容"), copy("Quantity", "数量"), copy("Order amount", "订单金额"), copy("Status", "状态"), copy("Details", "详情")].map(label => <th key={label} scope="col" className="px-3 py-3 font-normal">{label}</th>)}</tr></thead><tbody>{analysis.orders.slice(0, 5).map(order => <tr key={order.id} className="border-b last:border-0"><td className="px-3 py-4 align-top"><button type="button" className="break-all text-left font-medium text-primary hover:underline" onClick={() => setSelectedOrder(order)}>{order.reference}</button><p className="mt-1 text-[11px] text-muted-foreground">{order.orderDate}</p></td><td className="max-w-72 px-3 py-4 align-top">{order.items.slice(0, 3).map((item, index) => <p key={index} className="break-words leading-6">{item.description} <span className="text-muted-foreground">× {number(item.quantity)}</span></p>)}{order.items.length > 3 ? <button type="button" className="mt-1 text-primary hover:underline" onClick={() => setSelectedOrder(order)}>{copy(`+ ${order.items.length - 3} more items`, `另 ${order.items.length - 3} 项`)}</button> : null}</td><td className="px-3 py-4 tabular-nums">{number(order.items.reduce((sum, item) => sum + item.quantity, 0))}</td><td className="px-3 py-4 font-medium tabular-nums">{money(orderTotal(order))}</td><td className="px-3 py-4"><Status status={order.status} copy={copy} /></td><td className="px-3 py-4"><Button variant="ghost" size="xs" className="text-primary" onClick={() => setSelectedOrder(order)} aria-label={copy(`View order ${order.reference}`, `查看订单 ${order.reference}`)}>{copy("View", "查看")}<ArrowRight /></Button></td></tr>)}</tbody></table></div> : <Empty>{copy("No effective purchase orders in this period.", "所选时间内暂无有效采购订单。")}</Empty>}
      </section>
    </> : null}
    <Dialog open={Boolean(selectedOrder)} onOpenChange={open => { if (!open) setSelectedOrder(null); }}><DialogContent data-no-translate className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">{selectedOrder ? <><DialogHeader><DialogTitle>{selectedOrder.reference}</DialogTitle><DialogDescription>{selectedOrder.orderDate} · {selectedOrder.currency} · {copy(statusNames[selectedOrder.status][0], statusNames[selectedOrder.status][1])}{selectedOrder.deliveryDate ? ` · ${copy("Expected delivery", "预计交付")} ${selectedOrder.deliveryDate}` : ""}</DialogDescription></DialogHeader><div className="divide-y">{selectedOrder.items.map((item, i) => <div key={i} className="flex justify-between gap-5 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{item.description}</p><p className="mt-1 break-all text-xs text-muted-foreground">{item.sku}</p><p className="mt-1 text-xs text-muted-foreground">{number(item.quantity)} × {money(item.unitPriceMinor)}</p></div><p className="shrink-0 tabular-nums">{money(item.quantity * item.unitPriceMinor)}</p></div>)}</div><div className="flex justify-between border-t pt-4 font-semibold"><span>{copy("Order total", "订单金额")}</span><span>{money(orderTotal(selectedOrder))}</span></div><DialogFooter><Link href={allOrdersHref} className={buttonVariants({ variant: "outline", size: "sm" })}>{copy("Open purchase orders", "打开采购订单")}<ArrowRight /></Link></DialogFooter></> : null}</DialogContent></Dialog>
    <Dialog open={Boolean(reminder)} onOpenChange={open => { if (!taskPending && !open) setReminder(null); }}><DialogContent data-no-translate showCloseButton={!taskPending}><DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarClock className="size-4" />{copy("Create product follow-up", "创建产品跟进")}</DialogTitle><DialogDescription>{reminder?.name} · {copy("Assigned to the account owner, or to you if unassigned. Choose a time in your local timezone.", "分配给客户负责人；未分配负责人时将分配给您。请选择本地时区的时间。")}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveFollowup(); }}><div className="space-y-2"><Label htmlFor="analysis-followup-time">{copy("Follow-up date and time", "跟进日期与时间")}</Label><Input id="analysis-followup-time" type="datetime-local" required disabled={taskPending} value={dueAt} onChange={event => setDueAt(event.target.value)} /></div>{taskError ? <p role="alert" className="text-xs text-destructive">{taskError}</p> : null}<DialogFooter><Button variant="outline" type="button" disabled={taskPending} onClick={() => setReminder(null)}>{copy("Cancel", "取消")}</Button><Button type="submit" disabled={taskPending || !dueAt}>{taskPending ? copy("Saving…", "保存中…") : copy("Create follow-up", "创建跟进任务")}</Button></DialogFooter></form></DialogContent></Dialog>
  </section>;
}
