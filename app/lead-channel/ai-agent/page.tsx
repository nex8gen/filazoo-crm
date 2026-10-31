import type { Metadata } from "next";
import { FlowBuilder } from "@/components/flow-builder";
import { requireWorkspaceMember } from "@/lib/auth";
import { listFlowFilterOptions, listFlowMemberOptions, listWorkspaceFlows } from "@/lib/data/flows";
import { listMailboxes } from "@/lib/data/mailboxes";
import { flowMailboxOptions } from "@/lib/flow-mailboxes";
import { getSavedSegment } from "@/lib/data/segments";
import { createSegmentFlowDraft } from "@/lib/segment-flows";
import { z } from "zod";
import Link from "next/link";
import type { FlowInput } from "@/lib/flows";

export const metadata: Metadata = { title: "AI Automation" };

export default async function AiAgentPage({ searchParams }: PageProps<"/lead-channel/ai-agent">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  const canEdit = viewer.role !== "viewer";
  let initialDraft: FlowInput | undefined;
  if (canEdit && (params.segmentId !== undefined || params.segment !== undefined)) {
    const segmentId = z.uuid().safeParse(params.segmentId);
    const businessSegment = z.string().trim().min(1).max(120).safeParse(params.segment);
    const savedSegment = segmentId.success ? await getSavedSegment(segmentId.data) : null;
    if ((params.segmentId !== undefined && !savedSegment) || (params.segmentId === undefined && !businessSegment.success)) {
      return <div className="space-y-3 p-8"><h1 className="text-xl font-semibold">Segment unavailable</h1><p role="alert" className="text-sm text-muted-foreground">This segment could not be found. Choose a segment to create its auto flow.</p><Link href="/segments" className="text-sm font-medium text-primary">Back to segments</Link></div>;
    }
    initialDraft = createSegmentFlowDraft(savedSegment ? { ...savedSegment, kind: "saved" } : { id: "", name: businessSegment.data!, kind: "business" });
  }
  const [flows, mailboxes, members, filterOptions] = await Promise.all([
    listWorkspaceFlows(),
    listMailboxes(),
    listFlowMemberOptions().catch(() => [{ id: viewer.id, label: viewer.displayName || viewer.email || "You" }]),
    listFlowFilterOptions().catch(() => ({ segments: [], countries: [] })),
  ]);

  return <div className="h-full min-h-0">
    <FlowBuilder
      key={initialDraft ? `segment:${String(params.segmentId ?? params.segment)}` : typeof params.flow === "string" ? params.flow : "list"}
      initialFlows={flows}
      viewerId={viewer.id}
      isAdmin={viewer.role === "admin"}
      initialFlowId={!initialDraft && typeof params.flow === "string" ? params.flow : undefined}
      initialDraft={initialDraft}
      canEdit={canEdit}
      mailboxOptions={flowMailboxOptions(mailboxes)}
      memberOptions={members}
      filterOptions={filterOptions}
    />
  </div>;
}
