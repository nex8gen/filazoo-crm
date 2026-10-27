import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, History, ReceiptText, ClipboardList, Mail, MessageCircle, ChartNoAxesCombined } from "lucide-react";
import { CompanyAnalysis } from "@/components/company-analysis";
import { CompanyCustomerPortal } from "@/components/company-customer-portal";
import { CompanyEmails } from "@/components/company-emails";
import { CompanyPurchaseOrders } from "@/components/company-purchase-orders";
import { CompanyDetails } from "@/components/company-details";
import { CompanyDetailsSkeleton } from "@/components/page-skeletons";
import { CompanyBillingSkeleton } from "@/components/workspace-skeletons";
import { CompanyTimeline } from "@/components/company-timeline";
import { AssignedOwner } from "@/components/assigned-owner";
import { CompanyAvatar } from "@/components/company-avatar";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireWorkspaceMember } from "@/lib/auth";
import { getCompanyDetails } from "@/lib/data/crm";
import { CompanyInvoices } from "@/components/company-invoices";
import { CompanyActionsMenu } from "@/components/company-actions-menu";
import { listBdSalesManagers } from "@/lib/data/members";

export const instant = false;

type CompanyPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; compose?: string; invoiceId?: string }> };

export default function CompanyPage({ params, searchParams }: CompanyPageProps) {
  return <Suspense fallback={<CompanyDetailsSkeleton />}><CompanyPageContent params={params} searchParams={searchParams} /></Suspense>;
}

async function CompanyPageContent({ params, searchParams }: CompanyPageProps) {
  const { tab, compose, invoiceId } = await searchParams;
  const [{ id }, viewer] = await Promise.all([params, requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"])]);
  const [{ details }, managers] = await Promise.all([
    getCompanyDetails(id),
    viewer.role === "admin" ? listBdSalesManagers() : Promise.resolve([]),
  ]);
  if (!details) notFound();
  return <div data-ai-company-id={id}>
    <Link href="/companies" className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-4 -ml-2" })}><ArrowLeft />Back to companies</Link>
    <Tabs key={`${id}:${tab || "profile"}:${compose || ""}`} defaultValue={tab === "analyse" ? "analyse" : tab === "customer-portal" ? "customer-portal" : tab === "email" ? "email" : tab === "purchase-orders" ? "purchase-orders" : tab === "invoices" ? "invoices" : tab === "history" ? "history" : "profile"} className="gap-6">
      <div className="sticky top-12 z-30 flex min-w-0 flex-col gap-3 border-b bg-background py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="order-2 min-w-0 overflow-x-auto pb-1 sm:order-1">
          <TabsList variant="line" aria-label="Customer profile sections" className="min-w-max justify-start gap-2 lg:gap-4">
            <TabsTrigger id="company-profile-tab" value="profile" className="gap-2 px-3"><Building2 />Profile</TabsTrigger>
            <TabsTrigger value="email" className="gap-2 px-3"><Mail />Email</TabsTrigger>
            <TabsTrigger value="purchase-orders" className="gap-2 px-3"><ClipboardList />Purchase orders</TabsTrigger>
            <TabsTrigger value="analyse" className="gap-2 px-3"><ChartNoAxesCombined />Analyse</TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2 px-3"><ReceiptText />Invoices</TabsTrigger>
            <TabsTrigger value="customer-portal" className="gap-2 px-3"><MessageCircle />Customer portal</TabsTrigger>
            <TabsTrigger id="company-history-tab" value="history" className="gap-2 px-3"><History />Activity history</TabsTrigger>
          </TabsList>
        </div>
        <div className="order-1 flex min-w-0 items-center gap-4 pb-2 sm:order-2 sm:shrink-0 sm:pb-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <CompanyAvatar company={details.company} />
            <h1 data-no-translate title={details.company.name} className="max-w-32 truncate text-sm font-semibold tracking-tight xl:max-w-48">{details.company.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-l pl-4">
            <AssignedOwner compact name={details.company.ownerName} initials={details.company.ownerInitials} imageUrl={details.company.ownerAvatarUrl} assigned={Boolean(details.company.ownerId)} label="Assigned to" />
            <CompanyActionsMenu companyId={id} ownerId={details.company.ownerId} managers={managers} canAssign={viewer.role === "admin"} canWrite={viewer.role !== "viewer"} email={details.company.email} website={details.company.website} nextFollowupAt={details.company.nextFollowupAt} />
          </div>
          {viewer.role === "viewer" ? <span className="text-[11px] text-muted-foreground">Read-only</span> : null}
        </div>
      </div>
      <TabsContent value="profile" keepMounted>
        <CompanyDetails key={`${id}:${details.company.nextFollowupAt || ""}`} details={details} canWrite={viewer.role !== "viewer"} />
      </TabsContent>
      <TabsContent value="analyse" keepMounted>
        <Suspense fallback={<CompanyBillingSkeleton />}><CompanyAnalysis companyId={id} canWrite={viewer.role !== "viewer"} preferredCurrency={details.commerce?.currency || details.company.currency} /></Suspense>
      </TabsContent>
      <TabsContent value="invoices" keepMounted>
        <Suspense fallback={<CompanyBillingSkeleton />}><CompanyInvoices companyId={id} canWrite={viewer.role !== "viewer"} /></Suspense>
      </TabsContent>
      <TabsContent value="customer-portal">
        <Suspense fallback={<CompanyBillingSkeleton />}><CompanyCustomerPortal companyId={id} companyName={details.company.name} invoiceId={invoiceId} canWrite={viewer.role !== "viewer"} /></Suspense>
      </TabsContent>
      <TabsContent value="email">
        <Suspense fallback={<div role="status" className="p-6 text-sm text-muted-foreground">Loading customer emails…</div>}>
          <CompanyEmails company={{ id, name: details.company.name, emails: [...new Set([details.company.email, ...details.contacts.map((contact) => contact.email)])] }} viewer={{ id: viewer.id, role: viewer.role }} composeTo={compose === "1" && viewer.role !== "viewer" ? details.company.email : undefined} />
        </Suspense>
      </TabsContent>
      <TabsContent value="purchase-orders" keepMounted>
        <Suspense fallback={<CompanyBillingSkeleton />}><CompanyPurchaseOrders companyId={id} companyName={details.company.name} commerce={details.commerce} canWrite={viewer.role !== "viewer"} /></Suspense>
      </TabsContent>
      <TabsContent value="history" keepMounted>
        <CompanyTimeline companyId={id} activity={details.activity} canWrite={viewer.role !== "viewer"} viewerName={viewer.displayName || viewer.email || "Staff"} />
      </TabsContent>
    </Tabs>
  </div>;
}
