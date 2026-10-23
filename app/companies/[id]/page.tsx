import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CompanyDetails } from "@/components/company-details";
import { AssignedOwner } from "@/components/assigned-owner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireWorkspaceMember } from "@/lib/auth";
import { getCompanyDetails } from "@/lib/data/crm";
import { CompanyInvoices } from "@/components/company-invoices";

export const instant = false;

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<CompanyPageSkeleton />}><CompanyPageContent params={params} /></Suspense>;
}

async function CompanyPageContent({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, viewer] = await Promise.all([params, requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"])]);
  const { details } = await getCompanyDetails(id);
  if (!details) notFound();
  const isShopify = details.company.source.includes("shopify");
  return <div>
    <Link href="/companies" className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-4 -ml-2" })}><ArrowLeft />Back to companies</Link>
    <div className="mb-7 flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="mb-3 flex flex-wrap items-center gap-2">{isShopify && <span aria-label="Shopify" className="inline-grid size-7 place-items-center rounded-lg bg-[#95bf47] text-xs font-black text-white shadow-sm">S</span>}<Badge variant="secondary" className={isShopify ? "border-[#95bf47]/30 bg-[#95bf47]/12 text-[#5c7f18] dark:text-[#b5d66e]" : ""}>{details.company.sourceLabel}</Badge><Badge variant="outline">{details.company.stage}</Badge></div><h1 className="text-2xl font-semibold tracking-tight">{details.company.name}</h1><p className="mt-1 text-sm text-muted-foreground">{details.company.domain} · {details.company.country}{details.company.city ? `, ${details.company.city}` : ""}</p></div>
      <div className="flex items-center gap-4"><AssignedOwner name={details.company.ownerName} initials={details.company.ownerInitials} assigned={Boolean(details.company.ownerId)} label="Assigned BD Manager" />{viewer.role === "viewer" && <p className="text-xs text-muted-foreground">Viewer access is read-only</p>}</div>
    </div>
    {viewer.role !== "bd_manager" ? <Suspense fallback={<Skeleton className="mb-7 h-44 w-full" />}><CompanyInvoices companyId={id} canWrite={viewer.role === "admin" || viewer.role === "operator"} /></Suspense> : null}
    <CompanyDetails details={details} canWrite={viewer.role !== "viewer"} />
  </div>;
}

function CompanyPageSkeleton() {
  return <div className="space-y-6"><Skeleton className="h-8 w-32" /><Skeleton className="h-20 w-full" /><div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr]"><Skeleton className="h-[620px] w-full" /><Skeleton className="h-[520px] w-full" /></div></div>;
}
