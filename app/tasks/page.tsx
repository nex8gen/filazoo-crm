import type { Metadata } from "next";
import { FlowActivity, type FlowActivityData } from "@/components/flow-activity";
import { listFlowActivity } from "@/lib/data/flow-activity";

export const metadata: Metadata = { title: "Tasks and notifications" };

export default async function TasksPage() {
  const activity = await listFlowActivity() as FlowActivityData;
  return <div className="mx-auto max-w-6xl space-y-6"><div><h1 className="text-2xl font-semibold">Tasks and notifications</h1><p className="mt-2 text-sm text-muted-foreground">Follow-up work and alerts assigned to you by the CRM and your automation flows.</p></div><FlowActivity initial={activity} /></div>;
}
