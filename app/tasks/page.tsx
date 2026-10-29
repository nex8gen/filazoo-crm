import type { Metadata } from "next";
import { FlowActivity, type FlowActivityData } from "@/components/flow-activity";
import { listFlowActivity } from "@/lib/data/flow-activity";
import { requireWorkspaceMember } from "@/lib/auth";
import { z } from "zod";
import { CustomerReplyRequests } from "@/components/customer-reply-requests";
import { listReplyRequests } from "@/lib/data/customer-reply-requests";

export const metadata: Metadata = { title: "Tasks and notifications" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string; view?: string }> }) {
  const params = await searchParams;
  const selected = z.uuid().safeParse(params.task);
  const taskId = selected.success ? selected.data : undefined;
  const viewer = await requireWorkspaceMember();
  const [activity, waits] = await Promise.all([
    listFlowActivity(false, { taskPage: 0, alertPage: 0, taskId }),
    viewer.role !== "viewer" ? listReplyRequests(viewer).then((requests) => ({ requests, error: "" })).catch(() => ({ requests: [], error: "Unable to load customer waits. Please refresh." })) : null,
  ]);
  const initialView = params.view === "notifications" ? "notifications" : params.view === "replies" && waits ? "replies" : "tasks";
  return <FlowActivity key={`${taskId ?? "work"}:${params.view ?? "tasks"}`} initial={activity as FlowActivityData} taskId={taskId} initialView={initialView} canManage={viewer.role !== "viewer"} customerReplies={waits ? <CustomerReplyRequests initial={waits.requests} initialError={waits.error} /> : undefined} />;
}
