import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PortalDomainPage } from "@/components/portal-domain-page";
import { WebsiteLoadingSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "B2B website", referrer: "no-referrer" as const };

async function WebsitePage({ params }: { params: Promise<{ page: string[] }> }) {
  const page = (await params).page.join("/");
  if (!/^(account|pages\/[A-Za-z0-9_-]{1,64})$/.test(page)) notFound();
  return <PortalDomainPage page={page} />;
}

export default function Page(props: { params: Promise<{ page: string[] }> }) {
  return <Suspense fallback={<WebsiteLoadingSkeleton />}><WebsitePage {...props} /></Suspense>;
}
