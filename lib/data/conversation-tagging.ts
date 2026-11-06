import { resolveGatewayToken } from "../ai/provider-credentials.ts";
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createSupabaseAdmin } from "../supabase/admin";
import { normalizeMailboxRows } from "../mailbox-utils";
import { groupEmailConversations } from "../email-threading";
import { emailTagMessageKey } from "../customer-tags";
import { conversationTagContext, conversationTagDecisionSchema, conversationTagInput, conversationTagInstruction, parseConversationTagDecision,
  conversationTagSkipReason, conversationTagPrompt, conversationTagCooldownMs, conversationTagOutputTokens, customerConversationTagInput } from "../ai/conversation-tagging";
import { generateGeminiText } from "../ai/gemini";
import { generateGatewayText, isGeminiRegionError } from "../ai/gateway";
import type { AiTokenUsage } from "../ai/usage";
import { requireAiAutomation } from "./ai-settings";
import { mailboxHistory } from "./email-auto-reply";
import { loadMailboxMessageContent, loadMailboxWorkspace } from "./mailbox-sync";
import { mergeAutoReplyHistory } from "../email-auto-reply";
import { withLeadInquiryOrigins } from "./lead-inquiries";

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
  // Settings are deliberately not cached, including between conversations.
  let policy;
  try { policy = await requireAiAutomation(["tagging"], ["emails", "customers"]); }
  catch { return { ...result, paused: true }; }
  const apiKey = process.env.AI_PROVIDER === "gateway" || process.env.AI_BUDGET_ENFORCEMENT === "true" ? undefined : process.env.GEMINI_API_KEY?.trim();
  const token = resolveGatewayToken(process.env);
  if (!apiKey && !token) return { ...result, paused: true };
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
  try {
    // Group across accounts BEFORE classification, retaining each original source.
    const messages = await readHistory();
    for (const group of groupEmailConversations(messages).values()) {
      if (options.mailboxIds && !group.some(message => message.mailboxId && options.mailboxIds!.includes(message.mailboxId))) continue;
      const input = customerConversationTagInput(group, contacts);
      if (!input || input.keys.length > 1000 || input.messages.length > 1000) continue;
      if (options.companyIds && !options.companyIds.includes(input.companyId)) continue;
      if (input.messages.every(message => message.automaticResponse || message.providerKind === "trash" || message.providerKind === "junk")) continue;
      const previous = cache.get(input.key);
      if (previous && ((previous.lease_until && Date.parse(previous.lease_until) > Date.now())
        || Date.parse(previous.checked_at) > Date.now() - conversationTagCooldownMs
        || Date.parse(previous.latest_message_at) > Date.parse(input.latestAt)
        || (previous.input_hash === input.fingerprint && !["failed", "processing"].includes(previous.status))
        || (previous.input_hash === input.fingerprint && previous.retry_at && Date.parse(previous.retry_at) > Date.now()))) continue;
      const source = sources.find(source => source.mailbox.id === input.messages.at(-1)?.mailboxId) ?? sources[0];
      if (source) candidates.push({ input, ...source });
    }
  } catch {
    // Saved history failed to load; retry instead of guessing from a partial copy.
    result.failed++;
  }
  // New activity first, then older backfill. An unchanged input never makes another model call.
  candidates.sort((a, b) => Date.parse(b.input.latestAt) - Date.parse(a.input.latestAt) || b.input.messageCount - a.input.messageCount);
  let claimed = 0;
  for (const { input, mailbox, userId } of candidates) {
    if (claimed >= (options.maxConversations ?? 3) || Date.now() > deadline - 35_000) break;
    const leaseToken = randomUUID();
    const { data: owned } = await db.rpc("claim_conversation_tag_analysis", { p_key: input.key, p_hash: input.fingerprint,
      p_latest: input.latestAt, p_count: input.messageCount, p_token: leaseToken }).throwOnError();
    if (!owned) continue;
    claimed++;
    const messageKeys = input.messages.map(emailTagMessageKey);
    const contact = input.contactEmail;
    let providerCalls = 0, promptCharacters = 0;
    let stage = "policy";
    let failureStage: string | undefined;
    let usage: AiTokenUsage | undefined;
    const finish = async (decision: z.infer<typeof conversationTagDecisionSchema>, error = false) => {
      const { data } = await db.rpc("finish_conversation_tag_analysis_with_metrics", { p_key: input.key, p_token: leaseToken,
        p_keys: input.keys, p_message_keys: messageKeys, p_contact: contact, p_tag: decision.tag,
        p_confidence: decision.confidence, p_reason: decision.reason, p_evidence: decision.evidence, p_error: error,
        p_metrics: { source: providerCalls ? "ai" : "rule", providerCalls, promptCharacters, companyId: input.companyId, ...(usage ? { usage } : {}), ...(failureStage ? { failureStage } : {}) } }).throwOnError();
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
      const currentTag = saved?.filter(row => input.keys.includes(row.message_key)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]?.tag ?? null;
      const skipReason = conversationTagSkipReason(input.messages);
      if (skipReason) {
        await finish({ tag: null, confidence: 0, reason: skipReason, evidence: [] });
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
        await finish({ tag: null, confidence: 0, reason: "Conversation history exceeds the analysis limit or has missing content; keeping the current tag.", evidence: [] });
        result.ruleSkipped++;
        continue;
      }
      if (context.messages.every(message => !message.subject.trim() && !message.body.trim())) {
        await finish({ tag: null, confidence: 0, reason: "No subject or body text is available to classify; keeping the current tag.", evidence: [] });
        result.ruleSkipped++;
        continue;
      }
      // Honor revocations that happened while original messages were downloading.
      policy = await requireAiAutomation(["tagging"], ["emails", "customers"]);
      stage = "provider";
      const fetcher: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      const prompt = conversationTagPrompt(context, policy);
      const common = { prompt, systemInstruction: conversationTagInstruction, maxOutputTokens: conversationTagOutputTokens, fetcher,
        onUsage: (reported: AiTokenUsage) => { usage = { inputTokens: (usage?.inputTokens ?? 0) + reported.inputTokens,
          outputTokens: (usage?.outputTokens ?? 0) + reported.outputTokens, cachedInputTokens: (usage?.cachedInputTokens ?? 0) + reported.cachedInputTokens }; } };
      const trackRequest = () => { providerCalls++; result.providerCalls++; const size = prompt.length + conversationTagInstruction.length;
        promptCharacters += size; result.promptCharacters += size; };
      let output: string;
      try {
        trackRequest();
        output = apiKey ? await generateGeminiText({ ...common, apiKey, model: process.env.GEMINI_EMAIL_MODEL?.trim() || "gemini-3.5-flash-lite", responseJsonSchema: z.toJSONSchema(conversationTagDecisionSchema) })
          : await generateGatewayText({ usageUserId: userId, ...common, token: token!, task: "tagging", responseJsonSchema: z.toJSONSchema(conversationTagDecisionSchema) });
      } catch (error) {
        if (!apiKey || !token || !isGeminiRegionError(error)) throw error;
        trackRequest();
        output = await generateGatewayText({ usageUserId: userId, ...common, token, task: "tagging", responseJsonSchema: z.toJSONSchema(conversationTagDecisionSchema) });
      }
      stage = "evidence-validation";
      const decision = parseConversationTagDecision(output, context);
      // A reply imported during model execution invalidates this result immediately.
      stage = "history-revalidation";
      const latest = await readHistory();
      const matching = [...groupEmailConversations(latest).values()].find(group => conversationTagInput(group)?.keys.some(key => input.keys.includes(key)));
      if (!matching || customerConversationTagInput(matching, contacts)?.fingerprint !== input.fingerprint) throw new Error("Conversation changed during analysis; waiting for its latest context.");
      stage = "save";
      if (await finish(decision)) result.analyzed++;
    } catch (error) {
      result.failed++;
      failureStage = stage;
      // No raw provider error or email body in logs. Expired leases are recoverable.
      const reason = error instanceof Error && error.message.startsWith("AI Gateway authentication has expired")
        ? "Local AI authentication has expired. Refresh the linked Vercel project's development token. The current tag is unchanged."
        : error instanceof Error && error.message.startsWith("AI Gateway requires a valid credit card")
        ? "The configured AI Gateway requires billing activation. The current tag is unchanged; background processing will retry."
        : "Automatic analysis could not complete. The current tag is unchanged; background processing will retry.";
      await finish({ tag: null, confidence: 0, reason, evidence: [] }, true);
    }
  }
  return result;
}
