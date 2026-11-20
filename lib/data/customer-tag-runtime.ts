import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { InboxEmailItem } from "../email-inbox.ts";
import type { TagProcessingStatus } from "../customer-tag-rules.ts";
import { allFlowActions } from "../flow-engine.ts";
import type { FlowInput } from "../flows.ts";

type Work = { company_id: string; revision: number };
const priority: Record<TagProcessingStatus, number> = { current: 0, pending: 1, paused: 2, waiting_history: 3, needs_review: 4, retrying: 5 };

/** Durable company outbox; message identity still has its own inference lease. */
export async function beginCustomerTagRun(options: { companyIds?: string[] } = {}) {
  const db = createSupabaseAdmin();
  const { data: seeded } = await db.rpc("seed_customer_tag_messages", { p_limit: 500 }).throwOnError();
  if (!seeded?.done) return null;
  await db.rpc("refresh_due_customer_tag_rules", { p_limit: 100 }).throwOnError();
  const token = randomUUID();
  const { data } = await db.rpc("claim_customer_tag_work", { p_token: token, p_limit: 8, p_companies: options.companyIds ?? null }).throwOnError();
  const jobs = (data ?? []) as Work[];
  if (!jobs.length) return null;
  const states = new Map(jobs.map(job => [job.company_id, { status: "current" as TagProcessingStatus, reason: null as string | null }]));
  let automaticMessageIds: Set<string> | undefined;
  return {
    companyIds: jobs.map(job => job.company_id),
    fence(companyId: string) { return { workToken: token, workRevision: jobs.find(job => job.company_id === companyId)?.revision }; },
    mark(companyId: string, status: TagProcessingStatus, reason: string | null = null) {
      const current = states.get(companyId);
      if (current && priority[status] >= priority[current.status]) states.set(companyId, { status, reason });
    },
    async record(messages: readonly InboxEmailItem[]) {
      // No bodies, previews, attachments, read flags, or private policy text.
      for (let offset = 0; offset < messages.length; offset += 500) {
        const chunk = messages.slice(offset, offset + 500).map(({ id, messageId, threadId, tagThreadAliases, inReplyTo, references, direction, contact, from, to, cc, timestamp, automaticResponse, providerKind, providerRemoved, status }) =>
          ({ id, messageId, threadId, tagThreadAliases, inReplyTo, references, direction, contact, from, to, cc, timestamp, automaticResponse, providerKind, providerRemoved, status }));
        await db.rpc("record_customer_tag_messages", { p_messages: chunk }).throwOnError();
      }
      const { data } = await db.from("crm_customer_tag_work").select("company_id,revision,lease_token").in("company_id", jobs.map(job => job.company_id)).throwOnError();
      this.companyIds = jobs.filter(job => data?.some(row => row.company_id === job.company_id && row.revision === job.revision && row.lease_token === token)).map(job => job.company_id);
    },
    async automaticMessageIds() {
      if (automaticMessageIds) return automaticMessageIds;
      automaticMessageIds = new Set<string>();
      for (let offset = 0; ; offset += 500) {
        const { data } = await db.from("flow_run_logs").select("id,step_id,result,flow_runs!inner(company_id,context)").eq("result->>action", "email_sent")
          .in("flow_runs.company_id", jobs.map(job => job.company_id))
          .order("id").range(offset, offset + 499).throwOnError();
        for (const row of data ?? []) {
          if (!row.result?.aiGenerated || typeof row.result.messageId !== "string") continue;
          const run = Array.isArray(row.flow_runs) ? row.flow_runs[0] : row.flow_runs;
          try {
            const definition = JSON.parse(run?.context?.definition ?? "null") as FlowInput["steps"];
            const step = Array.isArray(definition) ? allFlowActions(definition).find(step => step.id === (row.result.stepId ?? row.step_id)) : undefined;
            // Pricing-enabled or arbitrary automated sales prose still needs
            // semantic interpretation. Only the constrained intake recipe is known.
            if (step?.type === "ai_auto_reply" && step.config.leadIntake === true && step.config.usePrices !== true)
              automaticMessageIds.add(row.result.messageId.trim().toLowerCase());
          } catch { /* Missing legacy provenance does not qualify for a free skip. */ }
        }
        if ((data?.length ?? 0) < 500) return automaticMessageIds;
      }
    },
    async finish(status?: TagProcessingStatus, reason?: string) {
      for (const job of jobs) {
        if (status) this.mark(job.company_id, status, reason);
        const state = states.get(job.company_id)!;
        await db.rpc("finish_customer_tag_work", { p_company: job.company_id, p_token: token, p_revision: job.revision,
          p_status: state.status, p_reason: state.reason }).throwOnError();
      }
    },
  };
}
