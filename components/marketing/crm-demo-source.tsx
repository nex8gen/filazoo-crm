"use client";

// This development-only renderer exports the production components with fixtures.
// Published previews contain only the resulting HTML/CSS, with no application JS.
import { HomeWorkspace } from "@/components/home-workspace";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import { PurchaseOrderRegister } from "@/components/purchase-order-register";
import { EmailInboxWorkspace, type EmailWorkspaceItem } from "@/components/email-inbox";
import { FlowBuilder } from "@/components/flow-builder";
import { TableColumnsProvider } from "@/components/table-columns-provider";
import { defaultTableColumns } from "@/lib/table-column-preferences";
import { buildHomePeriod, buildHomeReport, type HomeData, type HomeInputs } from "@/lib/home";
import type { PurchaseOrderRegisterRow } from "@/lib/purchase-order-register";
import type { AutomationFlow } from "@/lib/flows";
import "@/app/purchase-orders/purchase-orders.css";

const asOf = "2026-11-28T02:00:00.000Z";
const now = new Date(asOf);
const names = ["Northstar Studio", "Forma Supply", "Atelier Collective", "Summit Trading", "Oak & Field", "Horizon Materials", "Brightline Design", "Coastline Retail"];
const input: HomeInputs = {
  members: [{ id: "demo-jamie", name: "Jamie Lee", role: "admin" }, { id: "demo-alex", name: "Alex Chen", role: "bd_manager" }, { id: "demo-morgan", name: "Morgan Park", role: "operator" }],
  companies: Array.from({ length: 128 }, (_, i) => ({ id: `demo-company-${i}`, ownerId: ["demo-jamie", "demo-alex", "demo-morgan"][i % 3], stage: ["new", "contacted", "replied", "interested", "won"][i % 5], createdAt: `2026-11-${String(i % 28 + 1).padStart(2, "0")}T01:00:00Z` })),
  emails: Array.from({ length: 264 }, (_, i) => ({ ownerId: ["demo-jamie", "demo-alex", "demo-morgan"][i % 3], sentAt: `2026-11-${String(i % 28 + 1).padStart(2, "0")}T01:00:00Z` })),
  orders: Array.from({ length: 24 }, (_, i) => ({ companyId: `demo-company-${i}`, date: `2026-11-${String(i % 27 + 1).padStart(2, "0")}`, status: "confirmed", currency: "USD", totalMinor: 125000 + i * 17400 })),
};
const home: HomeData = { name: "Jamie", workspaceName: "NewAI Demo", isAdmin: true, asOf, preferenceKey: "marketing-demo-only", unavailable: [], canManageTasks: false,
  report: buildHomeReport(input, { from: "2026-11-01", to: "2026-11-28" }, now, true),
  periods: { today: buildHomePeriod(input, "today", now, true), month: buildHomePeriod(input, "month", now, true), all: buildHomePeriod(input, "all", now, true) } };
const orders: PurchaseOrderRegisterRow[] = names.map((customer, i) => ({ id: `demo-order-${i}`, label: `PO-2026-${String(1088 - i).padStart(4, "0")}`, reference: `REF-${310 + i}`, createdAt: asOf, orderDate: `2026-11-${28 - i}`, companyId: `demo-company-${i}`, customer, deliveryDate: `2026-12-${String(i + 2).padStart(2, "0")}`, overdue: false, currency: "USD", total: [1240000, 864000, 520000, 1575000, 392000, 980000, 618000, 246000][i], itemCount: [200, 144, 80, 250, 60, 160, 100, 40][i], payment: { label: i % 3 === 0 ? "Paid" : i % 3 === 1 ? "Partially paid" : "Unpaid", tone: i % 3 === 0 ? "green" : "yellow", filled: i % 3 === 0 }, orderStatus: { label: i % 3 === 0 ? "In production" : i % 3 === 1 ? "Confirmed" : "Shipped", tone: i % 3 === 0 ? "yellow" : "blue" }, invoiceBalance: i % 3 === 0 ? 0 : 215000, delivery: { label: i % 3 === 2 ? "In transit" : "Preparing", tone: "neutral" }, closed: false }));
const emails: EmailWorkspaceItem[] = names.map((company, i) => ({ id: `demo-email-${i}`, threadId: `demo-thread-${i}`, direction: "inbound", status: "received", subject: ["Quotation for our next collection", "Re: Product specifications", "Wholesale inquiry - November collection", "Delivery schedule confirmation", "Thank you for the samples", "Updated product catalog", "Re: Order confirmation", "New partnership inquiry"][i], contact: ["Alex Martin", "Chris Wilson", "Taylor Reed", "Sam Rivera", "Robin Carter", "Jordan Blake", "Drew Mason", "Casey Brooks"][i], contactName: "Alex Martin", company, companyId: `demo-company-${i}`, from: `buyer${i + 1}@example.com`, to: [{ address: "sales@example.com", name: "NewAI Demo" }], mailboxId: "demo-mailbox", ownerId: "demo-jamie", ownerName: "Jamie Lee", ownerInitials: "JL", customerContextStatus: "ready", preview: "Thank you for the product catalog. Could you share pricing and available options for our next order?", body: "Hi Jamie,\n\nThank you for sharing your latest product catalog. We are interested in ordering 200 units for our next collection.\n\nCould you prepare a quotation with the available variants, quantity pricing, and estimated delivery date?\n\nLooking forward to working together.\n\nBest regards,\nAlex Martin\nNorthstar Studio", bodyLoaded: true, timestamp: `2026-11-28T0${9 - i}:00:00Z`, demo: true, read: i > 1, folder: "inbox" }));
const flow: AutomationFlow = { id: "demo-flow", name: "New inquiry follow-up", triggerType: "new_lead", triggerConfig: {}, status: "draft", createdBy: "demo-jamie", createdAt: asOf, updatedAt: asOf, activeRuns: 0, completedRuns: 0, steps: [
  { id: "demo-wait", position: 0, type: "wait", config: { amount: 5, unit: "minutes" } },
  { id: "demo-reply", position: 1, type: "ai_auto_reply", config: { mailboxId: "default", replyInThread: true, useProducts: true, usePrices: true, attachCatalog: true, catalogFirstMessageOnly: true, instructions: "Answer the customer's product questions and offer a relevant catalog.", language: "en", sendWindow: "anytime", trackOpens: true, trackClicks: true } },
  { id: "demo-task", position: 2, type: "create_task", config: { title: "Follow up on the customer inquiry", assigneeType: "owner", assigneeId: null, dueInDays: 1, priority: "normal", notes: "Review the inquiry and prepare a relevant quotation." } },
] };

export function CrmDemoSource({ view }: { view: string }) {
  const path = view === "orders" ? "/purchase-orders" : view === "home" ? "/" : `/${view}`;
  const canvas = view === "email" || view === "workflow";
  return <div id="marketing-crm-demo" data-workspace-shell data-email-workspace={view === "email" || undefined} style={{ "--workspace-sidebar-width": "14.75rem" } as React.CSSProperties} className="h-dvh overflow-hidden text-foreground">
    <WorkspaceSidebar pathname={path} expanded onToggle={() => {}} onSearch={() => {}} userMenu={<span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-medium text-primary">JL</span>} />
    <div data-home={view === "home" || undefined} className="workspace-page ml-[var(--workspace-sidebar-width)] flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <WorkspacePageHeader pathname={path} />
      <main id="workspace-content" className={`min-h-0 w-full flex-1 ${canvas ? "overflow-hidden p-0" : "crm-workspace-content overflow-y-auto px-6 pb-6 pt-4"}`}>
        <TableColumnsProvider initial={defaultTableColumns}>
          {view === "home" && <HomeWorkspace data={home} />}
          {view === "orders" && <PurchaseOrderRegister rows={orders} filters={{ search: "", status: "", overdue: false, page: 1 }} count={orders.length} pageSize={25} today="2026-11-28" drafts={false} canWrite summary={{ orders: 24, inProduction: 8, shipped: 6, overdue: 0 }} />}
          {view === "email" && <EmailInboxWorkspace initialEmails={emails} initialThreadId="demo-thread-0" mailboxConfigured sendConfigured inboxConfigured inboxError={null} aiConfigured defaultMailboxEmail="sales@example.com" mailboxes={[{ id: "demo-mailbox", type: "personal", email: "sales@example.com", sendConfigured: true, inboxConfigured: true }]} selectedMailboxId="demo-mailbox" defaultSenderId="demo-mailbox" dataMode="demo" initialAutomation={{ enabled: false, queueCount: 0, steps: [] }} products={[]} catalogs={[]} />}
          {view === "workflow" && <FlowBuilder initialFlows={[flow]} initialFlowId={flow.id} mailboxOptions={[]} memberOptions={[{ id: "demo-jamie", label: "Jamie Lee" }]} viewerId="demo-jamie" canEdit={false} isAdmin filterOptions={{ segments: [], countries: [] }} />}
        </TableColumnsProvider>
      </main>
    </div>
  </div>;
}
