"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { conversationScope, type Conversation, type ConversationInput, type HistoryDetail, type HistoryReference } from "@/lib/ai/chat-history";

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || "Unable to load saved conversations.");
  return result;
}

export function useAiConversation(input: ConversationInput, onRestore: (detail: HistoryDetail, prepend?: boolean) => void, enabled = true) {
  const encoded = JSON.stringify(input);
  const scope = conversationScope(input);
  const choices = useRef(new Map<string, Conversation | null>());
  const [state, setState] = useState<{ scope: string; conversation: Conversation | null; loading: boolean; error: string | null; hasMore?: boolean; before?: number }>({ scope, conversation: null, loading: false, error: null });
  const restore = useEffectEvent(onRestore);
  const selection = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const generation = ++selection.current;
    async function load() {
      setState({ scope, conversation: choices.current.get(scope) ?? null, loading: true, error: null });
      try {
        let conversation = choices.current.get(scope);
        if (conversation === undefined) {
          const list = await jsonRequest(`/api/ai/history?${new URLSearchParams({ scope, resume: "true" })}`, { signal: controller.signal });
          conversation = (list.conversations as Conversation[]).filter((c) => c.version > 0).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
        }
        const detail: HistoryDetail | null = conversation ? await jsonRequest(`/api/ai/history/${conversation.id}`, { signal: controller.signal }) : null;
        if (controller.signal.aborted || selection.current !== generation) return;
        const active = detail?.conversation ?? null;
        choices.current.set(scope, active);
        if (detail) restore(detail);
        setState({ scope, conversation: active, loading: false, error: null, hasMore: detail?.hasMore, before: detail?.before });
      } catch (error) {
        if (!controller.signal.aborted && selection.current === generation) setState({ scope, conversation: null, loading: false, error: error instanceof Error ? error.message : "Unable to restore history." });
      }
    }
    void load();
    return () => controller.abort();
  }, [scope, enabled]);

  const current = state.scope === scope ? state : { scope, conversation: null, loading: enabled, error: null };
  async function open(id: string) {
    const generation = ++selection.current;
    setState((s) => ({ ...s, scope, loading: true, error: null }));
    try {
      const detail: HistoryDetail = await jsonRequest(`/api/ai/history/${id}`);
      if (generation !== selection.current) return;
      if (conversationScope(detail.conversation) !== scope) throw new Error("Open the original page and AI mode to continue this conversation.");
      choices.current.set(scope, detail.conversation);
      onRestore(detail);
      setState({ scope, conversation: detail.conversation, loading: false, error: null, hasMore: detail.hasMore, before: detail.before });
    } catch (error) { if (generation === selection.current) setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : "Unable to open history." })); }
  }
  async function ensure(requestId: string): Promise<HistoryReference> {
    if (current.loading) throw new Error("Wait for saved history to load.");
    if (current.error) throw new Error(current.error);
    let conversation = choices.current.get(scope);
    if (!conversation) {
      const result = await jsonRequest("/api/ai/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: encoded });
      conversation = result.conversation as Conversation;
      choices.current.set(scope, conversation);
      setState((s) => s.scope === scope ? { scope, conversation: conversation!, loading: false, error: null } : s);
    }
    if (conversation.archived) throw new Error("Restore this archived conversation from History before continuing.");
    if (conversation.pending) throw new Error("A saved request is still processing. Reopen this conversation from History to check its reply.");
    return { conversationId: conversation.id, requestId, version: conversation.version };
  }
  function accept(result: { conversationId: string; version: number; title?: string; summary?: string } | undefined) {
    const prior = choices.current.get(scope);
    if (!result || !prior || prior.id !== result.conversationId) return;
    const conversation = { ...prior, version: result.version, title: result.title ?? prior.title, summary: result.summary ?? prior.summary, pending: false, updated_at: new Date().toISOString() };
    choices.current.set(scope, conversation);
    setState((s) => s.scope === scope ? { ...s, conversation } : s);
  }
  function newConversation() {
    selection.current++;
    choices.current.set(scope, null);
    setState({ scope, conversation: null, loading: false, error: null });
  }
  function update(patch: { title?: string; pinned?: boolean; archived?: boolean }) {
    const prior = choices.current.get(scope);
    if (!prior) return;
    const conversation = { ...prior, ...patch, ...(patch.title ? { title: patch.title.trim() } : {}) };
    choices.current.set(scope, conversation);
    setState((s) => s.scope === scope ? { ...s, conversation } : s);
  }
  async function loadOlder() {
    if (!current.conversation || !current.hasMore || current.loading) return;
    const generation = ++selection.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const detail: HistoryDetail = await jsonRequest(`/api/ai/history/${current.conversation.id}?before=${current.before}`);
      if (generation !== selection.current) return;
      onRestore(detail, true);
      setState((s) => ({ ...s, loading: false, before: detail.before, hasMore: detail.hasMore }));
    } catch (error) { if (generation === selection.current) setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : "Unable to load older messages." })); }
  }
  return { ...current, scope, open, ensure, accept, update, newConversation, loadOlder };
}
export type AiConversationController = ReturnType<typeof useAiConversation>;
