import type { Metadata } from "next";
import { FlowActivity, type FlowActivityData } from "@/components/flow-activity";
import { listFlowActivity } from "@/lib/data/flow-activity";
import { requireWorkspaceMember } from "@/lib/auth";
import { z } from "zod";

export const metadata: Metadata = { title: "Tasks and notifications" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const selected = z.uuid().safeParse((await searchParams).task);
  const taskId = selected.success ? selected.data : undefined;
  const activity = await listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId }) as FlowActivityData;
  const viewer = await requireWorkspaceMember();
  return <div className="mx-auto max-w-6xl space-y-6"><div><h1 className="text-2xl font-semibold">Tasks and notifications</h1><p className="mt-2 text-sm text-muted-foreground">Your personal tasks, company follow-ups, automation alerts and AI email reviews.</p></div><FlowActivity initial={activity} taskId={taskId} canManage={viewer.role !== "viewer"} /></div>;
}
