import { Suspense } from "react";
import { PortalDomainPage } from "@/components/portal-domain-page";
import { WebsiteLoadingSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "B2B website", referrer: "no-referrer" as const };

export default function Page() {
  return <Suspense fallback={<WebsiteLoadingSkeleton />}><PortalDomainPage /></Suspense>;
}
