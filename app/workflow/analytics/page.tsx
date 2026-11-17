import type { Metadata } from "next";
import Link from "next/link";
import { FlowAnalytics } from "@/components/flow-analytics";
import { FlowViewToggle } from "@/components/flow-view-toggle";
import { PageActions } from "@/components/page-header";
import { NotificationToast } from "@/components/ui/notification-toast";
import { getFlowAnalytics } from "@/lib/data/flow-analytics";
import { analyticsRange } from "@/lib/flow-analytics";
import { requireWorkspaceMember } from "@/lib/auth";

export const metadata: Metadata = { title: "Workflow analytics" };

export default async function WorkflowAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  let data;
  try { data = await getFlowAnalytics(analyticsRange(params.range)); }
  catch {
    return <div className="p-6"><PageActions><FlowViewToggle active="analytics" /></PageActions><NotificationToast>Workflow analytics could not be loaded. Refresh the page to try again.</NotificationToast><Link href="/workflow" className="mt-4 inline-block text-sm text-primary underline">Back to workflow list</Link></div>;
  }
  return <FlowAnalytics {...data} initialQuery={typeof params.q === "string" ? params.q : ""} initialStatus={typeof params.status === "string" && ["live", "paused", "draft"].includes(params.status) ? params.status : "all"} />;
}
