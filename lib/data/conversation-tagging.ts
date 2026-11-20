import { resolveGatewayToken } from "../ai/provider-credentials.ts";
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdmin } from "../supabase/admin";
import { normalizeMailboxRows } from "../mailbox-utils";
import { groupEmailConversations } from "../email-threading";
import { emailTagMessageKey } from "../customer-tags";
import { conversationTagContext, conversationTagDecisionSchema, conversationTagInput,
  conversationTagSkipReason, conversationTagPrompt, conversationTagCooldownMs, conversationTagOutputTokens, customerConversationTagInput } from "../ai/conversation-tagging";
import { generateGatewayText } from "../ai/gateway";
import type { AiTokenUsage } from "../ai/usage";
import { requireAiAutomation } from "./ai-settings";
import { mailboxHistory } from "./email-auto-reply";
import { loadMailboxMessageContent, loadMailboxWorkspace } from "./mailbox-sync";
import { mergeAutoReplyHistory } from "../email-auto-reply";
import { withLeadInquiryOrigins } from "./lead-inquiries";
import { beginCustomerTagRun } from "./customer-tag-runtime";
import { ruleOnlyConversation } from "../customer-tag-rules.ts";
import { automaticCustomerTagInstruction, automaticCustomerTagSchema, parseAutomaticCustomerTagDecision, automaticCustomerTagFingerprint, type AutomaticCustomerTagDecision } from "../ai/automatic-customer-tags.ts";
import { budgetedAiFetch } from "../ai/budget-server.ts";

type AnalysisRow = { conversation_key: string; input_hash: string; latest_message_at: string; message_count: number;
  status: string; retry_at: string | null; lease_until: string | null; checked_at: string };
type Input = NonNullable<ReturnType<typeof customerConversationTagInput>>;

async function readConversationHistory(mailboxId: string, userId: string) {
  const { mailbox, messages } = await mailboxHistory(mailboxId, userId, false, false);
  const workspace = await loadMailboxWorkspace(mailbox, { sync: false });
  return mergeAutoReplyHistory(messages, workspace.messages).map(message => ({ ...message, mailboxId }));
}

/** Cron recovery + mailbox polls share durable leases. No drafts, SMTP or financial writes. */
export async function processAutomaticConversationTags(options: { mailboxIds?: string[]; companyIds?: string[]; maxConversations?: number; budgetMs?: number } = {}) {
  const result = { analyzed: 0, failed: 0, paused: false, ruleSkipped: 0, providerCalls: 0, promptCharacters: 0 };
  const work = await beginCustomerTagRun(options);
  if (!work) return result;
  try {
  // Settings are deliberately not cached, including between conversations.
  let policy;
  try { policy = await requireAiAutomation(["tagging"], ["emails", "customers"]); }
  catch { await work.finish("paused", "Automatic interpretation is paused in AI settings. Recorded business facts still update."); return { ...result, paused: true }; }
  const token = resolveGatewayToken(process.env);
  if (!token) { await work.finish("paused", "AI authentication is unavailable. Recorded business facts still update."); return { ...result, paused: true }; }
  const db = createSupabaseAdmin();
  const deadline = Date.now() + (options.budgetMs ?? 100_000);
  const contacts = new Map<string, string | null>();
  for (let offset = 0; ; offset += 500) {
    const { data } = await db.from("contacts").select("email,company_id").order("id").range(offset, offset + 499).throwOnError();
    for (const row of data ?? []) {
      const email = row.email?.trim().toLowerCase();
      if (email) contacts.set(email, contacts.has(email) && contacts.get(email) !== row.company_id ? null : row.company_id);
    }
    if ((data?.length ?? 0) < 500) break;
  }
  const { data: mailboxRows } = await db.from("workspace_mailboxes").select("*").eq("is_active", true).throwOnError();
  const { data: members } = await db.from("workspace_members").select("user_id,role").not("activated_at", "is", null).neq("role", "viewer").throwOnError();
  const operators = members?.filter(member => ["admin", "operator"].includes(member.role)) ?? [];
  const mailboxes = normalizeMailboxRows(mailboxRows).filter(mailbox => mailbox.imapHost && mailbox.imapUsername && mailbox.imapPassword);
  const staffAddresses = new Set(mailboxes.flatMap(mailbox => [mailbox.email, mailbox.imapUsername]).map(address => address?.trim().toLowerCase()).filter(Boolean));
  // A staff address saved as a CRM contact must not steal their customers' threads.
  for (const address of staffAddresses) contacts.delete(address!);
  const sources = mailboxes.flatMap(mailbox => {
    const userId = mailbox.type === "personal" ? members?.find(member => member.user_id === mailbox.userId)?.user_id : operators[0]?.user_id;
    return userId ? [{ mailbox, userId }] : [];
  });
  const readHistory = async () => {
    // Every source must succeed. A partial thread cannot safely replace a shared tag.
    const histories = await Promise.all(sources.map(source => readConversationHistory(source.mailbox.id, source.userId)));
    const messages = (await withLeadInquiryOrigins(mergeAutoReplyHistory([], histories.flat()))).map(message =>
      message.from && staffAddresses.has(message.from.trim().toLowerCase()) ? { ...message, direction: "outbound" as const } : message);
    return messages;
  };
  const cache = new Map<string, AnalysisRow>();
  for (let offset = 0; ; offset += 500) {
    const { data } = await db.from("crm_conversation_tag_analysis").select("conversation_key,input_hash,latest_message_at,message_count,status,retry_at,lease_until,checked_at")
      .order("conversation_key").range(offset, offset + 499).throwOnError();
    for (const row of data ?? []) cache.set(row.conversation_key, row as AnalysisRow);
    if ((data?.length ?? 0) < 500) break;
  }
  const candidates: Array<{ input: Input; mailbox: (typeof mailboxes)[number]; userId: string }> = [];
  const automaticMessageIds = await work.automaticMessageIds();
  try {
    // Group across accounts BEFORE classification, retaining each original source.
    const messages = await readHistory();
    await work.record(messages);
    for (const group of groupEmailConversations(messages).values()) {
      // A mailbox poll wakes the shared company queue. Do not acknowledge a
      // leased company while silently excluding its other mailbox histories.
      const base = customerConversationTagInput(group, contacts);
      const input = base ? { ...base, fingerprint: automaticCustomerTagFingerprint(base.fingerprint, policy, process.env) } : null;
      if (!input || input.keys.length > 1000 || input.messages.length > 1000) continue;
      if (!work.companyIds.includes(input.companyId)) continue;
      if (input.messages.every(message => message.automaticResponse || message.providerKind === "trash" || message.providerKind === "junk")) continue;
      const previous = cache.get(input.key);
      if (previous?.input_hash === input.fingerprint && previous.status === "review") work.mark(input.companyId, "needs_review", "This conversation needs a person to review its situation.");
      if (previous?.input_hash === input.fingerprint && previous.status === "waiting_history") work.mark(input.companyId, "waiting_history", "Saved conversation history is incomplete.");
      if (previous && ((previous.lease_until && Date.parse(previous.lease_until) > Date.now())
        || Date.parse(previous.checked_at) > Date.now() - conversationTagCooldownMs
        || Date.parse(previous.latest_message_at) > Date.parse(input.latestAt)
        || (previous.input_hash === input.fingerprint && !["failed", "processing"].includes(previous.status))
        || (previous.input_hash === input.fingerprint && previous.retry_at && Date.parse(previous.retry_at) > Date.now()))) {
        if (previous.status === "failed" || previous.status === "processing") work.mark(input.companyId, "retrying", "An analysis is waiting for its recovery window.");
        else if (previous.input_hash !== input.fingerprint) work.mark(input.companyId, "pending", "New conversation activity is waiting for its recovery window.");
        continue;
      }
      const source = sources.find(source => source.mailbox.id === input.messages.at(-1)?.mailboxId) ?? sources[0];
      if (source) candidates.push({ input, ...source });
    }
  } catch {
    // Saved history failed to load; retry instead of guessing from a partial copy.
    result.failed++;
    await work.finish("retrying", "Saved email history could not be loaded. Existing situations are preserved.");
    return result;
  }
  // New activity first, then older backfill. An unchanged input never makes another model call.
  candidates.sort((a, b) => Date.parse(b.input.latestAt) - Date.parse(a.input.latestAt) || b.input.messageCount - a.input.messageCount);
  let claimed = 0;
  for (const [index, { input, mailbox, userId }] of candidates.entries()) {
    if (claimed >= (options.maxConversations ?? 3) || Date.now() > deadline - 35_000) {
      for (const pending of candidates.slice(index)) work.mark(pending.input.companyId, "pending", "More changed conversations are queued for processing.");
      break;
    }
    const leaseToken = randomUUID();
    const { data: owned } = await db.rpc("claim_conversation_tag_analysis", { p_key: input.key, p_hash: input.fingerprint,
      p_latest: input.latestAt, p_count: input.messageCount, p_token: leaseToken }).throwOnError();
    if (!owned) { work.mark(input.companyId, "pending", "This conversation is already being processed or is cooling down."); continue; }
    claimed++;
    const messageKeys = input.messages.map(emailTagMessageKey);
    const contact = input.contactEmail;
    let providerCalls = 0, promptCharacters = 0;
    let stage = "policy";
    let failureStage: string | undefined;
    let usage: AiTokenUsage | undefined;
    const models = new Set<string>();
    let escalated = false;
    const finish = async (decision: z.infer<typeof conversationTagDecisionSchema>, error = false, action = decision.tag ? "apply" : "keep") => {
      const { data } = await db.rpc("finish_conversation_tag_analysis_v2", { p_key: input.key, p_token: leaseToken,
        p_keys: input.keys, p_message_keys: messageKeys, p_contact: contact, p_tag: decision.tag,
        p_confidence: decision.confidence, p_reason: decision.reason, p_evidence: decision.evidence, p_error: error,
        p_metrics: { source: providerCalls ? "ai" : "rule", providerCalls, promptCharacters, companyId: input.companyId,
          models: [...models], escalated, version: "rules-first-v1", ...work.fence(input.companyId), ...(usage ? { usage } : {}), ...(failureStage ? { failureStage } : {}) }, p_action: action }).throwOnError();
      return data;
    };
    try {
      policy = await requireAiAutomation(["tagging"], ["emails", "customers"]);
      stage = "saved-tags";
      const { data: saved } = await db.from("crm_email_tags").select("message_key,tag,source,updated_at").in("message_key", [...new Set([...input.keys, ...messageKeys])]).throwOnError();
      if (saved?.some(row => row.source !== "ai" && Date.parse(row.updated_at) >= Date.parse(input.latestAt))) {
        await finish({ tag: null, confidence: 1, reason: "Preserving the manual or workflow tag until this conversation has new activity.", evidence: [] });
        result.ruleSkipped++;
        continue;
      }
      if (ruleOnlyConversation({ messages: input.messages, automaticMessageIds })) {
        await finish({ tag: null, confidence: 1, reason: "Verified intake and workflow sends are maintained by communication rules without a model call.", evidence: [] });
        result.ruleSkipped++;
        continue;
      }
      const currentTag = saved?.filter(row => input.keys.includes(row.message_key)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]?.tag ?? null;
      const skipReason = conversationTagSkipReason(input.messages);
      if (skipReason) {
        const oversized = input.messages.length > 64;
        await finish({ tag: null, confidence: 0, reason: skipReason, evidence: [] }, false, oversized ? "review" : "waiting_history");
        work.mark(input.companyId, oversized ? "needs_review" : "waiting_history", skipReason);
        result.ruleSkipped++;
        continue;
      }
      // Select the same bounded history as the prompt; hydrate the newest first.
      const selected = input.messages.length > 64 ? [...input.messages.slice(0, 4), ...input.messages.slice(-60)] : input.messages;
      const hydrated = new Map<string, (typeof input.messages)[number]>();
      stage = "message-content";
      for (const message of [...selected].reverse()) {
        if (Date.now() > deadline - 35_000) throw new Error("Conversation hydration needs another tick.");
        const sourceMailbox = sources.find(source => source.mailbox.id === message.mailboxId)?.mailbox ?? mailbox;
        if (message.id.startsWith("sent-")) {
          const { data: sent } = await db.from("mailbox_sent_messages").select("body").eq("id", message.id.slice(5)).eq("mailbox_id", sourceMailbox.id).eq("status", "sent").maybeSingle().throwOnError();
          if (!sent) throw new Error("Sent conversation history is unavailable.");
          hydrated.set(message.id, { ...message, body: sent.body || "", bodyLoaded: true });
        } else if (message.bodyLoaded === false) {
          if (!message.uid || !message.uidValidity) throw new Error("Complete conversation history is unavailable.");
          const content = await loadMailboxMessageContent(sourceMailbox, message.uid, message.uidValidity, message.providerFolder);
          hydrated.set(message.id, { ...message, ...content, contact: message.contact, direction: message.direction, bodyLoaded: true });
        } else hydrated.set(message.id, message);
      }
      const context = conversationTagContext(input.messages.map(message => hydrated.get(message.id) ?? { ...message, bodyLoaded: false }), currentTag);
      if (context.historyIncomplete) {
        await finish({ tag: null, confidence: 0, reason: "Conversation history exceeds the analysis limit or has missing content; keeping the current tag.", evidence: [] }, false, "review");
        work.mark(input.companyId, "needs_review", "The conversation exceeds the safe analysis limit and needs review.");
        result.ruleSkipped++;
        continue;
      }
      if (context.messages.every(message => !message.subject.trim() && !message.body.trim())) {
        await finish({ tag: null, confidence: 0, reason: "No subject or body text is available to classify; keeping the current tag.", evidence: [] }, false, "review");
        work.mark(input.companyId, "needs_review", "No message text is available to interpret this conversation.");
        result.ruleSkipped++;
        continue;
      }
      // Honor revocations that happened while original messages were downloading.
      policy = await requireAiAutomation(["tagging"], ["emails", "customers"]);
      stage = "provider";
      const fetcher = budgetedAiFetch(userId, (url, init) => fetch(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30_000)]) }));
      const prompt = conversationTagPrompt(context, policy);
      const common = { prompt, systemInstruction: automaticCustomerTagInstruction, maxOutputTokens: conversationTagOutputTokens, fetcher, strictSchema: true,
        onUsage: (reported: AiTokenUsage) => { usage = { inputTokens: (usage?.inputTokens ?? 0) + reported.inputTokens,
          outputTokens: (usage?.outputTokens ?? 0) + reported.outputTokens, cachedInputTokens: (usage?.cachedInputTokens ?? 0) + reported.cachedInputTokens }; } };
      const trackRequest = (model: string) => { models.add(model); providerCalls++; result.providerCalls++; const size = prompt.length + automaticCustomerTagInstruction.length;
        promptCharacters += size; result.promptCharacters += size; };
      let decision: AutomaticCustomerTagDecision | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt && Date.now() > deadline - 35_000) throw new Error("A later tick is needed to review this conversation.");
        policy = await requireAiAutomation(["tagging"], ["emails", "customers"]);
        escalated = attempt === 1;
        stage = "provider";
        try {
          const output = await generateGatewayText({ usageUserId: userId, ...common, token: token!, task: "tagging", complex: attempt === 1,
            onRequest: trackRequest, onGeneration: async generation => { models.add(generation.model); }, responseJsonSchema: z.toJSONSchema(automaticCustomerTagSchema) });
          stage = "evidence-validation";
          decision = parseAutomaticCustomerTagDecision(output, context);
          if (decision.outcome !== "review" || attempt === 1) break;
        } catch (error) {
          // Budget/policy/auth failures must not be bypassed with another model.
          const budgetDenied = error && typeof error === "object" && "name" in error && error.name === "AiBudgetError";
          if (attempt === 1 || budgetDenied || error instanceof Error && /authentication|credits|access is blocked/i.test(error.message)) throw error;
        }
      }
      if (!decision) throw new Error("No validated conversation decision is available.");
      if (decision.outcome === "review") work.mark(input.companyId, "needs_review", decision.reason);
      // A reply imported during model execution invalidates this result immediately.
      stage = "history-revalidation";
      const latest = await readHistory();
      const matching = [...groupEmailConversations(latest).values()].find(group => conversationTagInput(group)?.keys.some(key => input.keys.includes(key)));
      const latestInput = matching ? customerConversationTagInput(matching, contacts) : null;
      policy = await requireAiAutomation(["tagging"], ["emails", "customers"]);
      if (!latestInput || automaticCustomerTagFingerprint(latestInput.fingerprint, policy, process.env) !== input.fingerprint) throw new Error("Conversation changed during analysis; waiting for its latest context.");
      stage = "save";
      if (await finish(decision, false, decision.outcome)) result.analyzed++;
    } catch (error) {
      result.failed++;
      failureStage = stage;
      work.mark(input.companyId, error instanceof Error && error.name === "AiBudgetError" ? "paused" : stage === "evidence-validation" ? "needs_review" : "retrying",
        error instanceof Error && error.name === "AiBudgetError" ? error.message : "Automatic interpretation could not complete; the previous situation is preserved.");
      // No raw provider error or email body in logs. Expired leases are recoverable.
      const reason = error instanceof Error && error.message.startsWith("AI Gateway authentication has expired")
        ? "Local AI authentication has expired. Refresh the linked Vercel project's development token. The current tag is unchanged."
        : error instanceof Error && error.message.startsWith("AI Gateway requires a valid credit card")
        ? "The configured AI Gateway requires billing activation. The current tag is unchanged; background processing will retry."
        : "Automatic analysis could not complete. The current tag is unchanged; background processing will retry.";
      await finish({ tag: null, confidence: 0, reason, evidence: [] }, true);
    }
  }
  await work.finish();
  return result;
  } catch (error) {
    await work.finish("retrying", "Automatic interpretation could not complete. Recorded business facts remain available.");
    throw error;
  }
}
