import { Suspense } from "react";
import { CompanyWorkspace } from "@/components/company-workspace";
import { companyTab, type CompanyTab } from "@/lib/company-tabs";
import type { CompanyDetails as CompanyDetailsData } from "@/lib/types";
import type { WorkspaceViewer } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { requireWorkspaceMember } from "@/lib/auth";
import { getCompanyDetails, getCompanyProfile } from "@/lib/data/crm";
import { CompanyInvoices } from "@/components/company-invoices";
import { CompanyActionsMenu } from "@/components/company-actions-menu";
import { listBdSalesManagers } from "@/lib/data/members";

export const instant = false;

type CompanyPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; compose?: string; invoiceId?: string }> };

export default function CompanyPage({ params, searchParams }: CompanyPageProps) {
  return <Suspense fallback={<CompanyDetailsSkeleton />}><CompanyPageContent params={params} searchParams={searchParams} /></Suspense>;
}

async function CompanyPageContent({ params, searchParams }: CompanyPageProps) {
  const [{ id }, viewer, { tab, compose, invoiceId }] = await Promise.all([params, requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]), searchParams]);
  const activeTab = companyTab(tab);
  const [{ details }, managers] = await Promise.all([
    getCompanyProfile(id),
    viewer.role === "admin" ? listBdSalesManagers({ withAvatars: false }) : Promise.resolve([]),
  ]);
  if (!details) notFound();
  return <div data-ai-company-id={id}>
    <Link href="/companies" className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-4 -ml-2" })}><ArrowLeft />Back to companies</Link>
    <CompanyWorkspace key={id} companyId={id} initialTab={activeTab}
      toolbar={<div className="order-1 flex min-w-0 items-center gap-4 pb-2 sm:order-2 sm:shrink-0 sm:pb-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <CompanyAvatar company={details.company} />
            <h1 data-no-translate title={details.company.name} className="max-w-32 truncate text-sm font-semibold tracking-tight xl:max-w-48">{details.company.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-l pl-4">
            <AssignedOwner compact name={details.company.ownerName} initials={details.company.ownerInitials} imageUrl={details.company.ownerAvatarUrl} assigned={Boolean(details.company.ownerId)} label="Assigned to" />
            <CompanyActionsMenu companyId={id} ownerId={details.company.ownerId} managers={managers} canAssign={viewer.role === "admin"} canWrite={viewer.role !== "viewer"} email={details.company.email} website={details.company.website} nextFollowupAt={details.company.nextFollowupAt} />
          </div>
          {viewer.role === "viewer" ? <span className="text-[11px] text-muted-foreground">Read-only</span> : null}
        </div>}
      profile={<CompanyDetails key={`${id}:${details.company.nextFollowupAt || ""}`} details={details} canWrite={viewer.role !== "viewer"} />}
      section={activeTab === "profile" ? null : <Suspense key={`${activeTab}:${compose || ""}:${invoiceId || ""}`} fallback={<CompanyBillingSkeleton />}><CompanySection tab={activeTab} id={id} details={details} viewer={viewer} compose={compose} invoiceId={invoiceId} /></Suspense>}
    />
  </div>;
}

async function CompanySection({ tab, id, details, viewer, compose, invoiceId }: {
  tab: CompanyTab; id: string; details: CompanyDetailsData; viewer: WorkspaceViewer; compose?: string; invoiceId?: string;
}) {
  const canWrite = viewer.role !== "viewer";
  switch (tab) {
    case "analyse": return <CompanyAnalysis companyId={id} canWrite={canWrite} preferredCurrency={details.commerce?.currency || details.company.currency} />;
    case "invoices": return <CompanyInvoices companyId={id} canWrite={canWrite} />;
    case "customer-portal": return <CompanyCustomerPortal companyId={id} companyName={details.company.name} invoiceId={invoiceId} canWrite={canWrite} />;
    case "email": return <CompanyEmails company={{ id, name: details.company.name, emails: [...new Set([details.company.email, ...details.contacts.map(contact => contact.email)])] }} viewer={{ id: viewer.id, role: viewer.role }} composeTo={compose === "1" && canWrite ? details.company.email : undefined} />;
    case "purchase-orders": return <CompanyPurchaseOrders companyId={id} companyName={details.company.name} commerce={details.commerce} canWrite={canWrite} />;
    case "history": {
      const { details: history } = await getCompanyDetails(id);
      return <CompanyTimeline companyId={id} activity={history?.activity ?? []} canWrite={canWrite} viewerName={viewer.displayName || viewer.email || "Staff"} />;
    }
    default: return null;
  }
}
