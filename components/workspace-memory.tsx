"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { createWorkspaceMemory } from "@/lib/workspace-memory";

const MemoryContext = createContext<ReturnType<typeof createWorkspaceMemory> | null>(null);

export function WorkspaceMemoryProvider({ children }: { children: ReactNode }) {
  const [memory] = useState(() => createWorkspaceMemory());
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>;
}

/** Retain small view controls even when Next evicts a page's mounted tree. */
export function useWorkspaceState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(MemoryContext);
  if (!memory) throw new Error("WorkspaceMemoryProvider is missing");
  const [fallback] = useState(initial);
  const subscribe = useCallback((listener: () => void) => memory.subscribe(key, listener), [memory, key]);
  const getSnapshot = useCallback(() => memory.read(key, fallback), [memory, key, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const current = memory.read(key, fallback);
    memory.write(key, typeof next === "function" ? (next as (value: T) => T)(current) : next);
  }, [memory, key, fallback]);
  return [value, setValue];
}
