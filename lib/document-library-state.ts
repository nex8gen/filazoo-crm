import type { LibraryResult } from "./documents.ts";
import { filterDocumentLibrary } from "./document-library-filter.ts";

export function documentLibraryQueryKey(filters: Record<string, string | null | undefined>) {
  const params = new URLSearchParams();
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** Typing is debounced; changing a category, folder or tab starts immediately. */
export function documentLibrarySearchDelay(previousKey: string, nextKey: string) {
  if (!previousKey || previousKey === nextKey) return 0;
  const previous = new URLSearchParams(previousKey), next = new URLSearchParams(nextKey);
  const textChanged = previous.get("q") !== next.get("q") || previous.get("company") !== next.get("company");
  for (const params of [previous, next]) { params.delete("q"); params.delete("company"); }
  return textChanged && previous.toString() === next.toString() ? 250 : 0;
}

type Request = { id: number; key: string; offset: number; pending: boolean; error: string };
export type DocumentLibraryState = {
  snapshots: Record<string, LibraryResult>;
  recentKeys: string[];
  metadata: Pick<LibraryResult, "folders" | "stats"> | null;
  request: Request | null;
  collection: LibraryResult["collection"];
};
export type DocumentLibraryAction =
  | { type: "request"; id: number; key: string; offset: number }
  | { type: "success"; id: number; key: string; result: LibraryResult }
  | { type: "failure"; id: number; key: string; error: string }
  | { type: "invalidate" };

export function initialDocumentLibraryState(seed?: { key: string; result: LibraryResult }): DocumentLibraryState {
  return { snapshots: seed ? { [seed.key]: seed.result } : {}, recentKeys: seed ? [seed.key] : [], metadata: seed ? { folders: seed.result.folders, stats: seed.result.stats } : null, request: null, collection: seed?.result.collection };
}

export function documentLibraryReducer(state: DocumentLibraryState, action: DocumentLibraryAction): DocumentLibraryState {
  if (action.type === "invalidate") {
    // Keep the current view visible during refresh, discard other cached pages.
    const key = state.request?.key ?? state.recentKeys.at(-1);
    return { ...state, snapshots: key && state.snapshots[key] ? { [key]: state.snapshots[key] } : {}, recentKeys: key ? [key] : [], request: null };
  }
  if (action.type === "request") {
    if (state.request && action.id < state.request.id) return state;
    return { ...state, request: { ...action, pending: true, error: "" } };
  }
  if (state.request?.id !== action.id || state.request.key !== action.key) return state;
  if (action.type === "failure") return { ...state, request: { ...state.request, pending: false, error: action.error } };

  const previous = state.snapshots[action.key];
  const documents = state.request.offset > 0 && previous
    ? [...previous.documents, ...action.result.documents.filter(item => !previous.documents.some(existing => existing.id === item.id))]
    : action.result.documents;
  const snapshots = { ...state.snapshots, [action.key]: { ...action.result, documents } };
  const recentKeys = [...state.recentKeys.filter(key => key !== action.key), action.key];
  while (recentKeys.length > 12) delete snapshots[recentKeys.shift()!];
  return { snapshots, recentKeys, collection: action.result.collection === undefined ? state.collection : action.result.collection, metadata: { folders: action.result.folders, stats: action.result.stats }, request: { ...state.request, pending: false, error: "" } };
}

/** Never show rows, counts or errors belonging to a different set of filters. */
export function selectDocumentLibrary(state: DocumentLibraryState, key: string, offset = 0) {
  const data = state.collection ? filterDocumentLibrary(state.collection, new URLSearchParams(key), offset) : state.snapshots[key] ?? null;
  const request = state.request?.key === key ? state.request : null;
  return { data, metadata: state.metadata, loading: request ? request.pending : !data, error: request?.error ?? "" };
}
