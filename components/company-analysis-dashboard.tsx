"use client";
import { NotificationToast } from "@/components/ui/notification-toast";

import { DatePicker } from "@/components/ui/date-picker";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, Check, Download, Plus, RefreshCw } from "lucide-react";
import { createAnalysisFollowup, loadCompanyAnalysis } from "@/app/company-analysis-actions";
import { useLanguage } from "@/components/language-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { followupInstant } from "@/lib/company-followup";
import { analysisDaysAgo, analysisTaskMarker, analysisToday, companyAnalysisCsv, companyPurchaseAnalysis, type AnalysisOrder, type CompanyAnalysisData, type ProductReminder } from "@/lib/company-analysis";

import { CompanyAnalysisOverview } from "@/components/company-analysis-overview";
import surfaces from "./analytics-surface.module.css";
import styles from "./company-analysis.module.css";

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
const panelClass = surfaces.card;
function orderTotal(order: AnalysisOrder) { return order.items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0); }
function Status({ status, copy }: { status: AnalysisOrder["status"]; copy: Copy }) {
  return <span className={`crm-table-status ${status === "completed" || status === "shipped" ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground"}`}>{copy(statusNames[status][0], statusNames[status][1])}</span>;
}
function reminderDetail(reminder: ProductReminder, copy: Copy) {
  switch (reminder.kind) {
    case "receipt": return copy("Confirm delivery and product feedback.", "确认收货与产品反馈。");
    case "fulfillment": return copy("Check production and delivery progress.", "确认生产与交付进度。");
    case "restock": return copy(`${reminder.daysSince} days since purchase; average interval ${reminder.averageGap} days. Check stock and next-order needs.`, `距上次采购 ${reminder.daysSince} 天，平均间隔 ${reminder.averageGap} 天。确认库存与下次采购需求。`);
    case "demand": return copy("Purchase timing varies. Check current needs.", "采购间隔不稳定，请确认当前需求。");
    case "history": return copy("Not enough history to estimate a reorder cycle.", "历史记录不足，暂无法估算复购周期。");
    case "monitor": return copy(`${reminder.daysSince} days since purchase; average interval ${reminder.averageGap} days.`, `距上次采购 ${reminder.daysSince} 天，平均间隔 ${reminder.averageGap} 天。`);
  }
}

export function CompanyAnalysisDashboard({ companyId, canWrite, preferredCurrency, initial }: { companyId: string; canWrite: boolean; preferredCurrency: string; initial: CompanyAnalysisData | null }) {
  const { language, t } = useLanguage();
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
      catch { setError("Analysis could not be refreshed. Please try again."); }
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
        setNotice("Product follow-up saved to CRM tasks.");
      } catch { setTaskError("The follow-up could not be confirmed. Please try again."); }
    });
  }

  return <section data-no-translate aria-label={copy("Customer analysis", "客户分析")} className={styles.dashboard}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <h2 className="text-base font-semibold tracking-tight" title={data ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(data.asOf)) : undefined}>{copy("Customer analysis", "客户分析")}</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={copy("Analysis period", "分析时间范围")} className="flex rounded-lg border p-1">
          {(["all", "180", "90", "custom"] as const).map(value => <button key={value} type="button" aria-pressed={period === value} onClick={() => { if (value === "custom" && !custom.from) setCustom({ from: analysisDaysAgo(today, 179), to: today }); setPeriod(value); }} disabled={!data} className={`h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${period === value ? "bg-brand-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{value === "all" ? copy("All time", "全部时间") : value === "custom" ? copy("Custom", "自定义") : copy(`${value} days`, `近${value}天`)}</button>)}
        </div>
        <Select value={currency} onValueChange={(selectedValue) => { if (selectedValue === null) return; setCurrency(selectedValue); }} disabled={!data}><SelectTrigger aria-label={copy("Analysis currency", "分析币种")} size="sm"><SelectValue /></SelectTrigger><SelectContent>{[...new Set([currency, ...currencies])].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
        <Button variant="outline" size="sm" onClick={exportOrders} disabled={!analysis?.orders.length || pending}><Download />{copy("Export orders", "导出订单")}</Button>
        <Button variant="outline" size="icon-sm" onClick={refresh} disabled={pending} aria-label={copy("Refresh analysis", "刷新分析")}><RefreshCw className={pending ? "animate-spin" : ""} /></Button>
      </div>
    </header>
    {period === "custom" ? <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3"><div className="space-y-1.5"><Label htmlFor="analysis-from">{copy("From", "开始日期")}</Label><DatePicker id="analysis-from" value={custom.from} max={today} onValueChange={value => setCustom(current => ({ ...current, from: value }))} /></div><div className="space-y-1.5"><Label htmlFor="analysis-to">{copy("To", "结束日期")}</Label><DatePicker id="analysis-to" value={custom.to} min={custom.from} max={today} onValueChange={value => setCustom(current => ({ ...current, to: value }))} /></div>{!validRange ? <NotificationToast>{copy("Choose a valid date range ending on or before today.", "请选择有效日期范围，结束日期不可晚于今天。")}</NotificationToast> : null}</div> : null}
    {error || !data ? <NotificationToast><p>{error ? t(error) : copy("Analysis unavailable. Please retry.", "分析暂不可用，请重试。")}</p><Button variant="outline" size="sm" disabled={pending} onClick={refresh}>{copy("Try again", "重试")}</Button></NotificationToast> : null}
    {analysis && data ? <>
      <CompanyAnalysisOverview companyId={companyId} data={data} analysis={analysis} range={range} locale={locale} copy={copy} money={money} number={number} />
      {analysis.reminders.length > 0 && <section aria-labelledby="product-followups-heading" className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 id="product-followups-heading" className="text-sm font-medium">{copy("Product follow-ups", "产品跟进")}</h3><p className="text-xs text-muted-foreground">{copy("All-time history", "全部历史")}</p></div>
        {notice ? <NotificationToast tone="message">{t(notice)}</NotificationToast> : null}
        {analysis.reminders.length ? <><div className="grid gap-3 lg:grid-cols-3">{analysis.reminders.slice(0, showAllReminders ? undefined : 3).map(item => { const task = tasks.find(task => task.notes === analysisTaskMarker(item.key)); return <div key={item.key} className={`${panelClass} flex flex-col p-4`}><div className="flex flex-wrap items-start justify-between gap-2"><h4 className="min-w-0 break-words text-sm font-medium">{item.name}</h4><span className={`rounded px-2 py-1 text-xs font-medium ${item.kind === "restock" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-brand-soft text-primary"}`}>{copy(reminderNames[item.kind][0], reminderNames[item.kind][1])}</span></div>{item.sku ? <p className="mt-1 break-all text-xs text-muted-foreground">{item.sku}</p> : null}<p className="mt-3 text-xs leading-5 text-muted-foreground">{copy("Last purchase", "最近采购")}: {item.lastDate} · {number(item.lastQuantity)} {copy("units", "件")}</p><p className="mb-4 mt-1 flex-1 text-xs leading-6 text-muted-foreground">{reminderDetail(item, copy)}</p>{task ? <p className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-xs text-primary"><Check className="size-3.5" />{copy("Follow-up scheduled", "已创建跟进")}{task.due_at ? ` · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(task.due_at))}` : ""}</p> : canWrite ? <Button variant="outline" size="sm" className="w-full text-xs text-primary" onClick={() => openFollowup(item)}><Plus />{copy("Create follow-up", "创建跟进任务")}</Button> : <p className="text-xs text-muted-foreground">{copy("Viewer access is read-only.", "查看者仅具备只读权限。")}</p>}</div>; })}</div>{analysis.reminders.length > 3 ? <Button variant="ghost" size="sm" onClick={() => setShowAllReminders(value => !value)}>{showAllReminders ? copy("Show fewer products", "收起产品") : copy(`View all ${analysis.reminders.length} products`, `查看全部 ${analysis.reminders.length} 个产品`)}</Button> : null}</> : null}
      </section>}
      {analysis.orders.length > 0 && <section className={`${panelClass} p-5`} aria-labelledby="recent-orders-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 id="recent-orders-heading" className="text-sm font-medium">{copy("Recent orders", "最近订单")}</h3><div className="flex items-center gap-3"><Link href={allOrdersHref} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">{copy("View all", "查看全部")}<ArrowRight className="size-3" /></Link></div></div>
        {analysis.orders.length ? <div className="crm-table-viewport"><table className="crm-table min-w-[720px]"><caption className="sr-only">{copy("Five most recent effective orders in the selected period", "所选时间内最近五笔有效订单")}</caption><thead className="bg-muted/50 text-muted-foreground"><tr>{[copy("Order / date", "订单编号 / 日期"), copy("Purchased items", "采购内容"), copy("Quantity", "数量"), copy("Order amount", "订单金额"), copy("Status", "状态")].map((label, index) => <th key={label} scope="col" data-numeric={index === 2 || index === 3 || undefined}>{label}</th>)}</tr></thead><tbody>{analysis.orders.slice(0, 5).map(order => <tr key={order.id} className="border-b last:border-0"><td className="px-3 py-4 align-top"><button type="button" className="break-all text-left font-medium text-primary hover:underline" onClick={() => setSelectedOrder(order)}>{order.reference}</button><p className="mt-1 text-xs text-muted-foreground">{order.orderDate}</p></td><td className="max-w-72 px-3 py-4 align-top">{order.items.slice(0, 3).map((item, index) => <p key={index} className="break-words leading-6">{item.description} <span className="text-muted-foreground">× {number(item.quantity)}</span></p>)}{order.items.length > 3 ? <button type="button" className="mt-1 text-primary hover:underline" onClick={() => setSelectedOrder(order)}>{copy(`+ ${order.items.length - 3} more items`, `另 ${order.items.length - 3} 项`)}</button> : null}</td><td data-numeric className="tabular-nums">{number(order.items.reduce((sum, item) => sum + item.quantity, 0))}</td><td data-numeric className="font-medium tabular-nums">{money(orderTotal(order))}</td><td className="px-3 py-4"><Status status={order.status} copy={copy} /></td></tr>)}</tbody></table></div> : null}
      </section>}
    </> : null}
    <Dialog open={Boolean(selectedOrder)} onOpenChange={open => { if (!open) setSelectedOrder(null); }}><DialogContent data-no-translate className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">{selectedOrder ? <><DialogHeader><DialogTitle>{selectedOrder.reference}</DialogTitle><DialogDescription>{selectedOrder.orderDate} · {selectedOrder.currency} · {copy(statusNames[selectedOrder.status][0], statusNames[selectedOrder.status][1])}{selectedOrder.deliveryDate ? ` · ${copy("Expected delivery", "预计交付")} ${selectedOrder.deliveryDate}` : ""}</DialogDescription></DialogHeader><div className="divide-y">{selectedOrder.items.map((item, i) => <div key={i} className="flex justify-between gap-5 py-3 text-sm"><div className="min-w-0"><p className="break-words font-medium">{item.description}</p><p className="mt-1 break-all text-xs text-muted-foreground">{item.sku}</p><p className="mt-1 text-xs text-muted-foreground">{number(item.quantity)} × {money(item.unitPriceMinor)}</p></div><p className="shrink-0 tabular-nums">{money(item.quantity * item.unitPriceMinor)}</p></div>)}</div><div className="flex justify-between border-t pt-4 font-semibold"><span>{copy("Order total", "订单金额")}</span><span>{money(orderTotal(selectedOrder))}</span></div><DialogFooter><Link href={allOrdersHref} className={buttonVariants({ variant: "outline", size: "sm" })}>{copy("Open purchase orders", "打开采购订单")}<ArrowRight /></Link></DialogFooter></> : null}</DialogContent></Dialog>
    <Dialog open={Boolean(reminder)} onOpenChange={open => { if (!taskPending && !open) setReminder(null); }}><DialogContent data-no-translate showCloseButton={!taskPending}><DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarClock className="size-4" />{copy("Create product follow-up", "创建产品跟进")}</DialogTitle><DialogDescription>{reminder?.name} · {copy("Assigned to the account owner, or to you if unassigned. Choose a time in your local timezone.", "分配给客户负责人；未分配负责人时将分配给您。请选择本地时区的时间。")}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); saveFollowup(); }}><div className="space-y-2"><Label htmlFor="analysis-followup-time">{copy("Follow-up date and time", "跟进日期与时间")}</Label><DatePicker id="analysis-followup-time" includeTime required disabled={taskPending} value={dueAt} onValueChange={value => setDueAt(value)} /></div>{taskError ? <NotificationToast>{t(taskError)}</NotificationToast> : null}<DialogFooter><Button variant="outline" type="button" disabled={taskPending} onClick={() => setReminder(null)}>{copy("Cancel", "取消")}</Button><Button type="submit" disabled={taskPending || !dueAt}>{taskPending ? copy("Saving…", "保存中…") : copy("Create follow-up", "创建跟进任务")}</Button></DialogFooter></form></DialogContent></Dialog>
  </section>;
}
