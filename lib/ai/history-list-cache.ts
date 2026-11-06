import { conversationScope, type Conversation } from "./chat-history.ts";
import { HistoryHttpError, requestHistoryJson } from "./history-http.ts";

export type HistoryListQuery = { scope: string; all?: boolean; search: string; archived: boolean };
export type HistoryListSnapshot = { items: Conversation[]; more: boolean; offset: number; unavailable: number; loading: boolean; loaded: boolean; error: Error | null };
const empty: HistoryListSnapshot = { items: [], more: false, offset: 0, unavailable: 0, loading: false, loaded: false, error: null };
type Entry = { query: HistoryListQuery; snapshot: HistoryListSnapshot; updatedAt: number; request?: { controller: AbortController; promise: Promise<void> } };
export const historyListKey = (query: HistoryListQuery) => JSON.stringify([query.all ? "all" : query.scope, query.search, query.archived]);

/** One mounted workspace's title metadata only. Never shared globally or persisted. */
export function createHistoryListCache(fetcher: typeof fetch = fetch, now = Date.now) {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  const emit = (key: string) => listeners.get(key)?.forEach(listener => listener());
  function entry(query: HistoryListQuery) {
    const key = historyListKey(query);
    let value = entries.get(key);
    if (!value) {
      value = { query, snapshot: empty, updatedAt: 0 };
      entries.set(key, value);
      if (entries.size > 30) {
        const oldest = entries.keys().next().value!;
        entries.get(oldest)?.request?.controller.abort();
        entries.delete(oldest); emit(oldest);
      }
    }
    return value;
  }
  function load(query: HistoryListQuery, force = false, append = false): Promise<void> {
    const value = entry(query);
    if (value.request && !force) return value.request.promise;
    if (!force && !append && value.snapshot.loaded && now() - value.updatedAt < 30_000) return Promise.resolve();
    value.request?.controller.abort();
    const controller = new AbortController();
    const key = historyListKey(query);
    const offset = append ? value.snapshot.offset : 0;
    value.snapshot = { ...value.snapshot, loading: true, error: null }; emit(key);
    const promise = (async () => {
      try {
        const data = await requestHistoryJson(`/api/ai/history?${new URLSearchParams({ scope: query.scope, view: query.all ? "all" : "record", titles: "true", search: query.search, archived: String(query.archived), offset: String(offset) })}`, { signal: controller.signal }, fetcher);
        if (controller.signal.aborted) return;
        const items = append ? [...new Map([...value.snapshot.items, ...data.conversations as Conversation[]].map(item => [item.id, item])).values()] : data.conversations as Conversation[];
        value.snapshot = { items, more: data.hasMore, offset: data.offset, unavailable: (append ? value.snapshot.unavailable : 0) + (data.unavailable ?? 0), loading: false, loaded: true, error: null };
        value.updatedAt = now();
      } catch (error) {
        if (controller.signal.aborted) return;
        const failure = error instanceof Error ? error : new Error("Unable to load history.");
        if (error instanceof HistoryHttpError && [401, 403].includes(error.status)) {
          for (const [otherKey, other] of entries) {
            if (other !== value) { other.request?.controller.abort(); other.request = undefined; }
            other.snapshot = { ...empty, error: failure }; other.updatedAt = 0; emit(otherKey);
          }
        } else value.snapshot = { ...value.snapshot, loading: false, error: failure };
      } finally {
        if (!controller.signal.aborted) { value.request = undefined; emit(key); }
      }
    })();
    value.request = { controller, promise };
    return promise;
  }
  return {
    read: (query: HistoryListQuery) => entries.get(historyListKey(query))?.snapshot ?? empty,
    subscribe(query: HistoryListQuery, listener: () => void) {
      const key = historyListKey(query);
      const subscribers = listeners.get(key) ?? new Set(); subscribers.add(listener); listeners.set(key, subscribers);
      return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(key); };
    },
    load,
    remember(conversation: Conversation) {
      if (conversation.version < 1) return;
      for (const [key, value] of entries) {
        if (value.query.search || value.query.archived !== conversation.archived || (!value.query.all && value.query.scope !== conversationScope(conversation))) continue;
        const prior = value.snapshot.items.find(item => item.id === conversation.id);
        if (prior && prior.version === conversation.version && prior.updated_at === conversation.updated_at && prior.title === conversation.title) continue;
        value.request?.controller.abort(); value.request = undefined; value.updatedAt = 0;
        const items = [{ ...conversation, summary: "" }, ...value.snapshot.items.filter(item => item.id !== conversation.id)];
        items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
        value.snapshot = { ...value.snapshot, items, loading: false }; emit(key);
      }
    },
    change(id: string, patch?: { title?: string; pinned?: boolean; archived?: boolean }) {
      for (const [key, value] of entries) {
        value.request?.controller.abort(); value.request = undefined; value.updatedAt = 0;
        const items = value.snapshot.items.flatMap(item => item.id !== id ? [item] : !patch || (patch.archived !== undefined && patch.archived !== value.query.archived) ? [] : [{ ...item, ...patch }]);
        items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
        value.snapshot = { ...value.snapshot, items, loading: false }; emit(key);
      }
    },
    dispose() {
      for (const value of entries.values()) value.request?.controller.abort();
      entries.clear();
      for (const key of listeners.keys()) emit(key);
    },
  };
}
export type HistoryListCache = ReturnType<typeof createHistoryListCache>;
