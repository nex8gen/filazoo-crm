"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createHistoryListCache, type HistoryListCache, type HistoryListQuery } from "@/lib/ai/history-list-cache";
import type { Conversation } from "@/lib/ai/chat-history";

export function useAiHistoryList(input: HistoryListQuery, enabled: boolean, supplied?: HistoryListCache, conversation?: Conversation | null) {
  const [own] = useState(() => createHistoryListCache());
  const cache = supplied ?? own;
  const { scope, all, search, archived } = input;
  const query = useMemo(() => ({ scope, all, search, archived }), [scope, all, search, archived]);
  const read = useCallback(() => cache.read(query), [cache, query]);
  const snapshot = useSyncExternalStore(useCallback(listener => cache.subscribe(query, listener), [cache, query]), read, read);
  useEffect(() => { if (conversation) cache.remember(conversation); }, [cache, conversation]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => { void cache.load(query); }, search ? 200 : 0);
    return () => clearTimeout(timer);
  }, [cache, query, enabled, search]);
  useEffect(() => () => own.dispose(), [own]);
  return { ...snapshot, refresh: () => { void cache.load(query, true); }, loadMore: () => cache.load(query, false, true), change: cache.change };
}
