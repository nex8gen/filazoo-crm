import { Suspense } from "react";
import { PublicWebsitePage } from "@/components/public-website-page";
import { WebsiteLoadingSkeleton } from "@/components/loading-skeletons";

export const metadata = { title: "Website", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function Page(props: { params: Promise<{ workspaceId: string; page?: string[] }> }) {
  return <Suspense fallback={<WebsiteLoadingSkeleton />}><PublicWebsitePage {...props} /></Suspense>;
}
