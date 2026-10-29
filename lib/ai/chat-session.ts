import "server-only";
import type { WorkspaceViewer } from "../auth";
import { beginSavedTurn, finishSavedTurn, failSavedTurn, saveChatUsage } from "./chat-history-server";
import { conversationMemory, memoryPrompt, pendingInvoicePrompt, type ConversationInput, type HistoryReference } from "./chat-history";
import { trackAiUsage } from "./chat-usage";
import type { ChatImage } from "./image-input";

export async function startChatSession(reference: HistoryReference | undefined, input: ConversationInput, viewer: WorkspaceViewer, userMessage: { role: "user" | "assistant"; content: string; images?: ChatImage[] }) {
  if (!reference) return undefined; // Older API clients retain their existing behavior.
  const prior = await beginSavedTurn(reference, input, viewer);
  let rates: unknown = {};
  try { rates = JSON.parse(process.env.AI_CHAT_MODEL_RATES_JSON || "{}"); } catch { /* Unknown prices are displayed as unavailable. */ }
  const tracker = trackAiUsage(fetch, rates && typeof rates === "object" ? rates as Record<string, { input: number; output: number }> : {});
  const memory = conversationMemory(prior.messages, prior.row.summary);
  let completionAttempted = false;
  const started = Date.now();
  let flushed = false;
  return {
    replay: prior.replay,
    messages: [...memory.messages, userMessage],
    summaryPrompt: memoryPrompt(memory.summary) + pendingInvoicePrompt("pendingInvoices" in prior ? prior.pendingInvoices ?? [] : []),
    completedActionIds: prior.completedActionIds,
    fetcher: tracker.fetcher,
    async complete(payload: { output: string; [key: string]: unknown }) {
      completionAttempted = true;
      return finishSavedTurn(reference, viewer, prior, userMessage, { ...payload, durationMs: Date.now() - started });
    },
    async fail() { if (!completionAttempted && !prior.replay) await failSavedTurn(reference, viewer); },
    async flush() { if (!flushed && !prior.replay) { flushed = true; await saveChatUsage(reference, viewer, tracker.usage); } },
  };
}
