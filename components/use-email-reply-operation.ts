"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

type ReplyOperationState = { scope: string; progress: string | null; error: string | null };

/** A single cancellable operation owned by one reply, independent of app notices. */
export function useEmailReplyOperation(scope: string) {
  const active = useRef<{ scope: string; controller: AbortController } | null>(null);
  const [state, setState] = useState<ReplyOperationState>({ scope, progress: null, error: null });
  if (state.scope !== scope) setState({ scope, progress: null, error: null });

  useLayoutEffect(() => {
    return () => {
      active.current?.controller.abort();
      active.current = null;
    };
  }, [scope]);

  const cancel = useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
    setState({ scope, progress: null, error: null });
  }, [scope]);

  const start = useCallback((progress: string) => {
    if (active.current) return null;
    const operation = { scope, controller: new AbortController() };
    active.current = operation;
    setState({ scope, progress, error: null });
    const isCurrent = () => active.current === operation && !operation.controller.signal.aborted;
    return {
      signal: operation.controller.signal,
      isCurrent,
      update(progress: string) {
        if (isCurrent()) setState({ scope, progress, error: null });
      },
      fail(error: string) {
        if (!isCurrent()) return;
        active.current = null;
        setState({ scope, progress: null, error });
      },
      finish() {
        if (!isCurrent()) return;
        active.current = null;
        setState({ scope, progress: null, error: null });
      },
    };
  }, [scope]);

  return {
    busy: state.scope === scope && Boolean(state.progress),
    progress: state.scope === scope ? state.progress : null,
    error: state.scope === scope ? state.error : null,
    start,
    cancel,
  };
}
