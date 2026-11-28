/** A mounted view owns its cache: pages never cross accounts or workspaces. */
export function createPageCache<T>(key: string, value: T, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("Page cache limit must be a positive integer.");
  const pages = new Map<string, T>([[key, value]]);
  const pending = new Map<string, Promise<T>>();
  let revision = 0;
  function get(key: string) {
    if (!pages.has(key)) return undefined;
    const value = pages.get(key)!;
    pages.delete(key);
    pages.set(key, value);
    return value;
  }
  function set(key: string, value: T) {
    pages.delete(key);
    pages.set(key, value);
    while (pages.size > limit) pages.delete(pages.keys().next().value!);
  }
  return {
    get,
    has: (key: string) => pages.has(key),
    set,
    clear() { revision++; pages.clear(); pending.clear(); },
    load(key: string, read: () => Promise<T>): Promise<T> {
      if (pages.has(key)) return Promise.resolve(get(key)!);
      const existing = pending.get(key);
      if (existing) return existing;
      const started = revision;
      const promise = read().then(value => { if (started === revision) set(key, value); return value; })
        .finally(() => { if (pending.get(key) === promise) pending.delete(key); });
      pending.set(key, promise);
      return promise;
    },
  };
}
