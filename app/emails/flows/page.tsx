import Link from "next/link";
import { FlowBuilder } from "@/components/flow-builder";
import { requireWorkspaceMember } from "@/lib/auth";
import { resolveEmailFlowScope } from "@/lib/data/email-flows";
import { listEmailFlows, listFlowFilterOptions, listFlowMemberOptions } from "@/lib/data/flows";
import { listMailboxes } from "@/lib/data/mailboxes";
import { defaultFlowInput, type JsonConfig } from "@/lib/flows";

export default async function EmailFlowsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const params = await searchParams;
  let scope: JsonConfig;
  try {
    scope = await resolveEmailFlowScope(params);
  } catch (error) {
    return <div className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-xl font-semibold">Email automation</h1><p role="alert" className="text-sm text-muted-foreground">{error instanceof Error ? error.message : "Unable to load this email's company."}</p><Link href="/emails" className="text-sm font-medium text-primary">Back to email</Link></div>;
  }
  const [flows, mailboxes, members, filterOptions] = await Promise.all([
    listEmailFlows(scope), listMailboxes(), listFlowMemberOptions(), listFlowFilterOptions(),
  ]);
  const query = new URLSearchParams({ recipient: String(params.recipient), scope: String(scope.flowScope), companyId: String(scope.scopeCompanyId) });
  if (typeof params.thread === "string") query.set("thread", params.thread);
  if (typeof params.mailbox === "string") query.set("mailbox", params.mailbox);
  const returnQuery = new URLSearchParams();
  if (typeof params.thread === "string") returnQuery.set("thread", params.thread);
  if (typeof params.mailbox === "string") returnQuery.set("mailbox", params.mailbox);
  const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === params.mailbox);
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 text-sm">
      <span className="font-semibold">Email automation</span><span className="break-all text-muted-foreground">{String(scope.scopeLabel)}</span>
      <span className="text-xs text-muted-foreground">Available here from Email only</span>
      <nav aria-label="Automation scope" className="ml-auto flex gap-3">
        {(["email", "company"] as const).map((value) => { const next = new URLSearchParams(query); next.set("scope", value); return <Link key={value} aria-current={scope.flowScope === value ? "page" : undefined} className={scope.flowScope === value ? "font-semibold text-primary" : "text-muted-foreground"} href={`/emails/flows?${next}`}>{value === "email" ? "This email address" : "This company"}</Link>; })}
      </nav>
    </div>
    <div className="min-h-0 flex-1">
      <FlowBuilder key={query.toString()} initialFlows={flows} viewerId={viewer.id} isAdmin={viewer.role === "admin"}
        initialFlowId={typeof params.flow === "string" ? params.flow : flows[0]?.id}
        initialDraft={{ ...defaultFlowInput, name: `${scope.scopeLabel} automation`.slice(0, 160), triggerType: "email_received", triggerConfig: scope,
          steps: defaultFlowInput.steps.map((step) => ({ ...step, config: { ...step.config, ...(step.type === "send_email" && selectedMailbox ? { mailboxId: selectedMailbox.id } : {}) } })) }}
        scopedContext={{ config: scope, refreshUrl: `/api/email/flows?${query}`, returnHref: `/emails?${returnQuery}` }}
        canEdit={viewer.role !== "viewer"} mailboxOptions={mailboxes.map((mailbox) => ({ id: mailbox.id, label: `${mailbox.displayName || mailbox.email} · ${mailbox.email}` }))}
        memberOptions={members} filterOptions={filterOptions} />
    </div>
  </div>;
}
