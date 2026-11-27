/** A mounted view owns its cache: pages never cross accounts or workspaces. */
export function createPageCache<T>(key: string, value: T) {
  const pages = new Map<string, T>([[key, value]]);
  const pending = new Map<string, Promise<T>>();
  let revision = 0;
  return {
    get: (key: string) => pages.get(key),
    has: (key: string) => pages.has(key),
    set(key: string, value: T) { pages.set(key, value); },
    clear() { revision++; pages.clear(); pending.clear(); },
    load(key: string, read: () => Promise<T>): Promise<T> {
      if (pages.has(key)) return Promise.resolve(pages.get(key)!);
      const existing = pending.get(key);
      if (existing) return existing;
      const started = revision;
      const promise = read().then(value => { if (started === revision) pages.set(key, value); return value; })
        .finally(() => { if (pending.get(key) === promise) pending.delete(key); });
      pending.set(key, promise);
      return promise;
    },
  };
}
