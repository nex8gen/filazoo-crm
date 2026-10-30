// Page views and small snapshots: scoped to one account provider, never persisted to disk.
export function createWorkspaceMemory(limit = 200) {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    read<T>(key: string, fallback: T): T {
      return values.has(key) ? values.get(key) as T : fallback;
    },
    write<T>(key: string, value: T) {
      if (values.has(key) && Object.is(values.get(key), value)) return;
      values.delete(key);
      values.set(key, value);
      if (values.size > limit) {
        const oldest = values.keys().next().value!;
        const view = oldest.slice(0, oldest.lastIndexOf(".") + 1);
        // Evict the whole view together: a remembered page number must never
        // outlive its matching filtered rows and filter controls.
        for (const candidate of values.keys()) {
          if (view ? candidate.startsWith(view) : candidate === oldest) {
            values.delete(candidate);
            if (candidate !== key) listeners.get(candidate)?.forEach(listener => listener());
          }
        }
      }
      listeners.get(key)?.forEach(listener => listener());
    },
    subscribe(key: string, listener: () => void) {
      const subscribers = listeners.get(key) ?? new Set();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) listeners.delete(key);
      };
    },
  };
}
