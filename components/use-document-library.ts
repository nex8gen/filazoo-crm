"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { documentLibraryReducer, documentLibrarySearchDelay, initialDocumentLibraryState, selectDocumentLibrary } from "@/lib/document-library-state";
import type { LibraryResult } from "@/lib/documents";

export function useDocumentLibrary(queryKey: string, offset = 0, revision = 0, initialData?: LibraryResult) {
  const [state, dispatch] = useReducer(documentLibraryReducer, initialData ? { key: queryKey, result: initialData } : undefined, initialDocumentLibraryState);
  const requestSequence = useRef(0);
  const previousKey = useRef("");
  const loadedRevision = useRef(revision);
  const completedRequest = useRef(initialData ? `${queryKey}\0${offset}\0${revision}` : "");
  const collection = state.collection;
  useEffect(() => {
    const refreshing = loadedRevision.current !== revision;
    const identity = `${queryKey}\0${offset}\0${revision}`;
    if (completedRequest.current === identity || (!refreshing && collection)) { previousKey.current = queryKey; return; }
    const controller = new AbortController();
    const id = ++requestSequence.current;
    const delay = documentLibrarySearchDelay(previousKey.current, queryKey);
    previousKey.current = queryKey;
    const timer = setTimeout(async () => {
      dispatch({ type: "request", id, key: queryKey, offset });
      const params = new URLSearchParams(queryKey);
      params.set("offset", String(offset));
      if (collection !== null) params.set("bootstrap", "1");
      try {
        const response = await fetch(`/api/documents?${params}`, { signal: controller.signal, cache: "no-store" });
        const result: LibraryResult & { error?: string } = await response.json();
        if (!response.ok || !Array.isArray(result.documents)) throw new Error(result.error || "Unable to load the library.");
        if (!controller.signal.aborted) { completedRequest.current = identity; loadedRevision.current = revision; dispatch({ type: "success", id, key: queryKey, result }); }
      } catch (cause) {
        if (!controller.signal.aborted) dispatch({ type: "failure", id, key: queryKey, error: cause instanceof Error ? cause.message : "Unable to load the library." });
      }
    }, delay);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [queryKey, offset, revision, collection]);
  const invalidate = useCallback(() => dispatch({ type: "invalidate" }), []);
  const selected = useMemo(() => selectDocumentLibrary(state, queryKey, offset), [state, queryKey, offset]);
  return { ...selected, invalidate };
}
