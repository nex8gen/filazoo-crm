"use client";

import { type CSSProperties, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, CircleCheck, Clock3, Download, FileText, Headphones, House, LockKeyhole, LogOut, MapPin, MessageCircle, MoreHorizontal, Package, ReceiptText, RefreshCw, ShieldCheck, Truck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { PortalLocalTime } from "@/components/portal-local-time";
import { InvoicePaper } from "@/components/invoice-paper";
import { formatMoney } from "@/lib/invoices";
import { shipmentLabels, type PortalData } from "@/lib/customer-portal";
import { portalAccentForeground, portalFeatureAllowed } from "@/lib/portal-design";
import { portalPageHref, portalPages, type PortalPage } from "@/lib/portal-themes";
import "./portal-app.css";

const steps = [{ value: "confirmed", label: "Confirmed", icon: Check }, { value: "in_production", label: "In production", icon: Package }, { value: "shipped", label: "Shipped", icon: Truck }, { value: "completed", label: "Completed", icon: CircleCheck }];
const pageIcons = { home: House, tracking: Package, invoice: ReceiptText, messages: MessageCircle, content: BookOpen };
function portalDate(value: string) {
  if (!value) return "To be confirmed";
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function PortalPageLink({ pageId, active, preview, invoiceId, onNavigate, className, children }: { pageId: string; active?: boolean; preview: boolean; invoiceId: string; onNavigate?: (page: string) => void; className?: string; children: ReactNode }) {
  return preview ? <Button type="button" variant="ghost" className={className} aria-current={active ? "page" : undefined} onClick={() => onNavigate?.(pageId)}>{children}</Button>
    : <Button variant="ghost" nativeButton={false} render={<Link href={portalPageHref(invoiceId, pageId)} />} className={className} aria-current={active ? "page" : undefined}>{children}</Button>;
}
export function PortalExperience({ data, preview = false, invoiceId = "preview", page = "home", onPageChange, onWebsiteHome, busy = false, refreshing = false, onRefresh, onSignout, security, composer, notifications, conversation, onConversationScroll }: {
  data: PortalData; preview?: boolean; invoiceId?: string; page?: string; onPageChange?: (page: string) => void; busy?: boolean; refreshing?: boolean;
  onRefresh?: () => void; onSignout?: () => void; security?: ReactNode; composer?: ReactNode; notifications?: ReactNode;
  conversation?: RefObject<HTMLDivElement | null>; onConversationScroll?: () => void;
  onWebsiteHome?: () => void;
}) {
  const design = data.design;
  const pages = portalPages(design);
  const current = pages.find(item => item.id === page);
  const selectedSection = design.sections.find(section => section.id === current?.sectionId);
  const overviewSection = design.sections.find(section => section.type === "overview");
  const overview = data.overview;
  const invoice = data.invoice;
  const today = new Date().toISOString().slice(0, 10);
  const status = overview?.status === "issued" ? (overview.paid_minor >= overview.total_minor ? "paid" : overview.dueDate < today ? "overdue" : overview.paid_minor > 0 ? "partial" : "issued") : overview?.status;
  const invoiceStatus = invoice?.status === "issued" ? (invoice.paid_minor >= invoice.total_minor ? "paid" : invoice.document.dueDate < today ? "overdue" : invoice.paid_minor > 0 ? "partial" : "issued") : invoice?.status;
  const statusLabel = (value: string | undefined) => value === "issued" ? "Awaiting payment" : value === "partial" ? "Partially paid" : value === "paid" ? "Paid in full" : value === "void" ? "Voided" : value === "overdue" ? "Overdue" : value ?? "Pending";
  const balance = !overview || overview.status === "void" ? 0 : Math.max(0, overview.total_minor - overview.paid_minor);
  const shipment = data.shipment;
  const activeStep = steps.findIndex(step => step.value === data.order?.status);
  const deliveryDate = shipment?.expected_delivery || data.order?.deliveryDate;
  const download = portalFeatureAllowed(design, "downloadInvoice");
  const sendAllowed = portalFeatureAllowed(design, "sendMessages");
  const endpoint = invoice ? `/api/customer/invoices/${invoice.id}` : "";
  const style = { "--primary": design.accent, "--ring": design.accent, "--primary-foreground": portalAccentForeground(design.accent), "--cpa-accent": design.accent } as CSSProperties;
  const heading = ["Your order, at a glance.", "Everything you need. One place."].includes(design.heading) ? "" : design.heading;
  const welcome = ["Everything you need, all in one place.", "Your orders, invoices, and conversations, always within reach."].includes(design.welcome) ? "" : design.welcome;
  const footer = design.footer === "Invoice, order updates, and a team that has your back." ? "" : design.footer;
  const initials = data.customerName.split(/\s+/).slice(0, 2).map(name => name[0]).join("").toUpperCase() || "C";
  const navLink = (item: PortalPage) => {
    const Icon = pageIcons[item.type];
    return <PortalPageLink key={item.id} pageId={item.id} active={page === item.id} preview={preview} invoiceId={invoiceId} onNavigate={onPageChange} className="cpa-nav-link"><Icon /><span>{item.label}</span>{item.type === "messages" && data.messages.length > 0 && <small>{data.messages.length}</small>}</PortalPageLink>;
  };
  const quickPages = pages.filter(item => item.type !== "home" && item.type !== "content");
  const primaryPages = pages.filter(item => item.type !== "content");
  const extraPages = pages.filter(item => item.type === "content");
  return <main className="customer-portal portal-app" data-theme={design.theme} style={style}>
    {!preview && <a className="portal-skip-link" href="#customer-page">Skip to content</a>}
    <aside className="cpa-sidebar" aria-label="Customer sidebar">
      <div className="cpa-brand">{design.logoUrl ? <Image src={design.logoUrl} alt={design.brandName} width={150} height={42} unoptimized referrerPolicy="no-referrer" /> : <><span className="cpa-brand-symbol">{design.brandName[0]}</span><strong>{design.brandName}</strong></>}</div>
      {onWebsiteHome && <Button variant="ghost" className="cpa-nav-link" onClick={onWebsiteHome}><ArrowUpRight />Back to website</Button>}
      <nav aria-label="Customer pages">{pages.map(navLink)}</nav>
      <div className="cpa-sidebar-bottom"><div className="cpa-profile"><span>{initials}</span><div><strong>{data.customerName}</strong><small>{data.email}</small></div><button type="button" aria-label="Sign out" disabled={preview || busy} onClick={onSignout}><LogOut /></button></div></div>
    </aside>
    <div className="cpa-main">
      <header className="cpa-topbar"><div className="cpa-mobile-brand">{design.brandName}</div><h1>{selectedSection?.title && current?.type !== "home" ? selectedSection.title : current?.label ?? "Page unavailable"}</h1><div className="cpa-topbar-actions">{current?.type === "invoice" && download && <Button variant="outline" size="sm" nativeButton={false} render={<a href={preview ? undefined : `${endpoint}/pdf`} aria-disabled={preview} />}><Download />Download</Button>}{design.features.languageSwitcher && !preview && <LanguageSwitcher />}<Button type="button" size="icon-sm" variant="ghost" aria-label="Refresh portal" disabled={preview || refreshing} onClick={onRefresh}><RefreshCw className={refreshing ? "portal-spinner" : ""} /></Button><details className="cpa-account-menu"><summary className="cpa-header-avatar" aria-label="Customer account">{initials}</summary><div><strong>{data.customerName}</strong><small>{data.email}</small><Button type="button" variant="ghost" disabled={preview || busy} onClick={onSignout}><LogOut />Sign out</Button></div></details></div></header>
      <div className="cpa-scroll" key={page} id="customer-page" tabIndex={-1}>
        {design.announcement && <div className="cpa-announcement"><span>{design.announcement}</span><ShieldCheck /></div>}
        <div className="cpa-page-content">{notifications}{security}
          {current?.type !== "content" && selectedSection?.body && !["All the details, whenever you need them", "A direct line to your sales team"].includes(selectedSection.body) && <p className="cpa-page-description">{selectedSection.body}</p>}
          {!current && <div className="cpa-unavailable"><LockKeyhole /><h1>This page isn’t available</h1><p>This page is hidden or has been removed from your portal.</p><PortalPageLink pageId="home" preview={preview} invoiceId={invoiceId} onNavigate={onPageChange}>Back to home<ArrowRight /></PortalPageLink></div>}
          {current?.type === "home" && <>
            {(heading || welcome) && <div className="cpa-intro">{heading && <h2>{heading}</h2>}{welcome && <p>{welcome}</p>}</div>}
            {overview && <section className="cpa-metrics" aria-label={overviewSection?.title ?? "Payment overview"}><Card size="sm" className="cpa-metric gap-0"><span className="cpa-metric-icon"><Wallet /></span><p>Outstanding balance</p><strong>{formatMoney(balance, overview.currency)}</strong><small>{status === "void" ? "No payment required" : balance ? `Due ${portalDate(overview.dueDate)}` : "You're all settled"}</small></Card><Card size="sm" className="cpa-metric gap-0"><span className="cpa-metric-icon"><CheckCheck /></span><p>Payments received</p><strong>{formatMoney(overview.paid_minor, overview.currency)}</strong><small>of {formatMoney(overview.total_minor, overview.currency)} total</small></Card><Card size="sm" className="cpa-metric gap-0"><span className="cpa-metric-icon"><ReceiptText /></span><p>Payment status</p><strong className="cpa-status-value">{statusLabel(status)}</strong><small>{data.label}</small></Card></section>}
            
            <section className="cpa-shortcuts" aria-label="Your portal pages">{quickPages.map(item => {
              const Icon = pageIcons[item.type];
              return <PortalPageLink key={item.id} pageId={item.id} preview={preview} invoiceId={invoiceId} onNavigate={onPageChange} className="cpa-shortcut"><span className={`cpa-shortcut-icon is-${item.type}`}><Icon /></span><h3>{item.label}</h3><span className="cpa-shortcut-action">{item.type === "tracking" ? "Track order" : item.type === "invoice" ? "View invoice" : "Open messages"}<ArrowRight /></span></PortalPageLink>;
            })}</section>
            {shipment && <section className="cpa-latest"><span className="cpa-latest-icon"><Truck /></span><div><h3>{shipmentLabels[shipment.status]}</h3><span>{shipment.location || shipment.carrier || "Your team is keeping your order up to date."}</span></div>{deliveryDate && <div className="cpa-latest-date"><Clock3 /><span>Estimated arrival<strong>{portalDate(deliveryDate)}</strong></span></div>}</section>}
          </>}
          {current?.type === "tracking" && <>
            <Card className="cpa-panel gap-0 py-0"><div className="cpa-panel-heading"><span className="cpa-panel-icon"><Package /></span><div><h2>{data.order?.reference || data.reference || "Your order"}</h2></div><Badge variant="secondary" className="cpa-badge">{data.order?.status === "cancelled" ? "Cancelled" : shipment ? shipmentLabels[shipment.status] : "Order updates"}</Badge></div>
              {data.order && data.order.status !== "cancelled" && <ol className="cpa-order-steps" aria-label="Order progress">{steps.map((step, index) => <li key={step.value} data-complete={index <= activeStep} aria-current={index === activeStep ? "step" : undefined}><span>{index < activeStep ? <Check /> : <step.icon />}</span><strong>{step.label}</strong>{index === activeStep && <small>Current stage</small>}</li>)}</ol>}
              {!data.order && !shipment && <div className="cpa-empty"><Package /><h3>No order updates</h3></div>}
              {shipment && <div className="cpa-shipping-grid"><div><span><MapPin />Latest location</span><strong>{shipment.location || "Not yet available"}</strong></div><div><span><Truck />Carrier</span><strong>{shipment.carrier || "To be confirmed"}</strong></div><div><span><Package />Tracking number</span><strong>{shipment.tracking_number || "Not yet available"}</strong></div><div><span><Clock3 />Estimated arrival</span><strong>{portalDate(deliveryDate || "")}</strong></div></div>}
              {shipment?.tracking_url && <a className="cpa-carrier-link" href={preview ? undefined : shipment.tracking_url} target="_blank" rel="noopener noreferrer">Track with carrier<ArrowUpRight /></a>}
            </Card>
          </>}
          {current?.type === "invoice" && invoice && <>
            <section className="cpa-invoice-balance"><span className="cpa-panel-icon"><Wallet /></span><div><p>Balance on this invoice</p><strong>{formatMoney(invoice.status === "void" ? 0 : Math.max(0, invoice.total_minor - invoice.paid_minor), invoice.document.currency)}</strong></div><Badge variant="secondary" className="cpa-badge">{statusLabel(invoiceStatus)}</Badge></section>
            <Card className="cpa-panel gap-0 py-0"><div className="cpa-invoice-row"><span className="cpa-file-icon"><FileText /></span><div><h2>{data.label}</h2><p>Issued {portalDate(invoice.document.issueDate)}</p></div><div><span>Total</span><strong>{formatMoney(invoice.total_minor, invoice.document.currency)}</strong></div><div><span>Due date</span><strong>{portalDate(invoice.document.dueDate)}</strong></div>{download && <a href={preview ? undefined : `${endpoint}/pdf`} aria-label="Download invoice PDF" aria-disabled={preview}><ArrowDownToLine /></a>}</div><details className="cpa-invoice-details"><summary>View invoice details<ChevronRight /></summary><div className="customer-invoice-preview"><InvoicePaper invoice={invoice} today={today} customerView /></div></details></Card>
          </>}
          {current?.type === "messages" && <Card className="cpa-panel gap-0 py-0 cpa-chat"><div className="cpa-chat-heading"><span className="cpa-team-avatar"><Headphones /></span><div><h2>Your account team</h2></div><span><LockKeyhole />Private</span></div><div ref={conversation} onScroll={onConversationScroll} role="log" aria-label="Customer conversation" aria-live="polite" tabIndex={0} className="portal-conversation cpa-conversation">{data.messages.length ? data.messages.map(item => <article key={item.id} className={`cpa-message ${item.sender === "customer" ? "is-own" : ""}`}><span>{item.sender === "customer" ? "You" : "Account team"}</span><p data-no-translate>{item.body}</p><PortalLocalTime value={item.created_at} compact /></article>) : <div className="cpa-empty"><MessageCircle /><h3>No messages</h3></div>}</div>{sendAllowed ? preview ? <div className="cpa-demo-composer"><span>Write a message to your team…</span><Button disabled>Send message<ArrowUpRight /></Button></div> : composer : <p className="cpa-readonly"><LockKeyhole />Your team’s updates appear here. Customer replies are turned off.</p>}</Card>}
          {current?.type === "content" && <Card className="cpa-panel cpa-content-page">{selectedSection?.body}</Card>}
          {(footer || design.supportEmail) && <footer className="cpa-footer">{footer && <p>{footer}</p>}{design.supportEmail && <a href={preview ? undefined : `mailto:${design.supportEmail}`}>Contact support<ArrowUpRight /></a>}</footer>}
        </div>
      </div>
      <nav className="cpa-mobile-nav" aria-label="Mobile customer pages">{primaryPages.map(navLink)}{extraPages.length > 0 && <details key={page} className="cpa-more-menu"><summary><MoreHorizontal /><span>More</span></summary><div>{extraPages.map(navLink)}</div></details>}</nav>
    </div>
  </main>;
}
