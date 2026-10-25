import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, History, ReceiptText } from "lucide-react";
import { CompanyDetails } from "@/components/company-details";
import { CompanyDetailsSkeleton } from "@/components/page-skeletons";
import { CompanyBillingSkeleton } from "@/components/workspace-skeletons";
import { CompanyTimeline } from "@/components/company-timeline";
import { AssignedOwner } from "@/components/assigned-owner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireWorkspaceMember } from "@/lib/auth";
import { getCompanyDetails } from "@/lib/data/crm";
import { CompanyInvoices } from "@/components/company-invoices";
import { CompanyAi } from "@/components/company-ai";
import { AiIcon } from "@/components/ai-icon";
import { CompanyActionsMenu } from "@/components/company-actions-menu";
import { listBdSalesManagers } from "@/lib/data/members";

export const instant = false;

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<CompanyDetailsSkeleton />}><CompanyPageContent params={params} /></Suspense>;
}

async function CompanyPageContent({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"])]);
  const [{ details }, managers] = await Promise.all([
    getCompanyDetails(id),
    viewer.role === "admin" ? listBdSalesManagers() : Promise.resolve([]),
  ]);
  if (!details) notFound();
  const isShopify = details.company.source.includes("shopify");
  const isMeta = /meta|facebook|messenger|instagram/i.test(details.company.source);
  return <div>
    <Link href="/companies" className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-4 -ml-2" })}><ArrowLeft />Back to companies</Link>
    <Tabs key={id} defaultValue="ai" className="gap-6">
      <div className="flex min-w-0 flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="order-2 min-w-0 overflow-x-auto pb-1 sm:order-1">
          <TabsList variant="line" aria-label="Customer profile sections" className="min-w-max justify-start gap-2 lg:gap-4">
            <TabsTrigger value="ai" className="gap-2 px-3"><AiIcon />AI</TabsTrigger>
            <TabsTrigger id="company-profile-tab" value="profile" className="gap-2 px-3"><Building2 />Profile</TabsTrigger>
            {viewer.role !== "bd_manager" && <TabsTrigger value="invoices" className="gap-2 px-3"><ReceiptText />Invoices</TabsTrigger>}
            <TabsTrigger id="company-history-tab" value="history" className="gap-2 px-3"><History />Activity history</TabsTrigger>
          </TabsList>
        </div>
        <div className="order-1 flex min-w-0 items-center gap-4 pb-2 sm:order-2 sm:shrink-0 sm:pb-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative shrink-0">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{details.company.initials}</AvatarFallback>
              </Avatar>
              {isShopify || isMeta ? <span role="img" aria-label={`Lead source: ${details.company.sourceLabel}`} title={`Lead source: ${details.company.sourceLabel}`} className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-background ring-2 ring-background">
                <Image src={isShopify ? "/shopify-mark.svg" : "/meta-mark.svg"} alt="" width={12} height={12} unoptimized className="size-3 object-contain" />
              </span> : null}
            </div>
            <h1 data-no-translate title={details.company.name} className="max-w-32 truncate text-sm font-semibold tracking-tight xl:max-w-48">{details.company.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-l pl-4">
            <AssignedOwner compact name={details.company.ownerName} initials={details.company.ownerInitials} assigned={Boolean(details.company.ownerId)} label="Assigned to" />
            <CompanyActionsMenu companyId={id} ownerId={details.company.ownerId} managers={managers} canAssign={viewer.role === "admin"} email={details.company.email} website={details.company.website} />
          </div>
          {viewer.role === "viewer" ? <span className="text-[11px] text-muted-foreground">Read-only</span> : null}
        </div>
      </div>
      <TabsContent value="ai" keepMounted>
        <CompanyAi key={id} company={details.company} />
      </TabsContent>
      <TabsContent value="profile" keepMounted>
        <CompanyDetails details={details} canWrite={viewer.role !== "viewer"} />
      </TabsContent>
      {viewer.role !== "bd_manager" && <TabsContent value="invoices" keepMounted>
        <Suspense fallback={<CompanyBillingSkeleton />}><CompanyInvoices companyId={id} canWrite={viewer.role !== "viewer"} /></Suspense>
      </TabsContent>}
      <TabsContent value="history" keepMounted>
        <CompanyTimeline companyId={id} activity={details.activity} canWrite={viewer.role !== "viewer"} viewerName={viewer.displayName || viewer.email || "Staff"} />
      </TabsContent>
    </Tabs>
  </div>;
}
