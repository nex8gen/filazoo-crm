import type { Metadata } from "next";
import { FlowBuilder } from "@/components/flow-builder";
import { requireWorkspaceMember } from "@/lib/auth";
import { listFlowFilterOptions, listFlowMemberOptions, listFlows } from "@/lib/data/flows";
import { listMailboxes } from "@/lib/data/mailboxes";

export const metadata: Metadata = { title: "AI Agent" };

export default async function AiAgentPage({ searchParams }: PageProps<"/lead-channel/ai-agent">) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const params = await searchParams;
  const [flows, mailboxes, members, filterOptions] = await Promise.all([
    listFlows(viewer.id),
    listMailboxes(),
    listFlowMemberOptions().catch(() => [{ id: viewer.id, label: viewer.displayName || viewer.email || "You" }]),
    listFlowFilterOptions().catch(() => ({ segments: [], countries: [] })),
  ]);

  return <div>
    <FlowBuilder
      initialFlows={flows}
      initialFlowId={typeof params.flow === "string" ? params.flow : undefined}
      canEdit={viewer.role === "admin" || viewer.role === "operator"}
      mailboxOptions={mailboxes.map((mailbox) => ({ id: mailbox.id, label: `${mailbox.displayName || mailbox.email} · ${mailbox.email}` }))}
      memberOptions={members}
      filterOptions={filterOptions}
    />
  </div>;
}
