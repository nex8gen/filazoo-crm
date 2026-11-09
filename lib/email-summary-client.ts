import { parseEmailSummary } from "./ai/email-summary.ts";

const pending = new Map<string, Promise<{ summary: ReturnType<typeof parseEmailSummary>; cached: boolean; generatedAt?: string }>>();

/** Share only in-flight work; every reopen still checks server access and policy. */
export function requestEmailSummary(body: string, refresh = false, fetcher: typeof fetch = fetch) {
  const input = JSON.parse(body);
  const content = { ...input };
  delete content.currentFollowUpAt;
  const key = JSON.stringify(content);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const signal = AbortSignal.timeout(110_000);
    let refreshSummary = refresh;
    while (true) {
      const response = await fetcher("/api/email/assist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, refreshSummary }), signal,
      });
      const result = await response.json().catch(() => null);
      if (response.status === 202 && result?.pending) {
        // Another server owns the generation. Poll for its saved result only.
        refreshSummary = false;
        await new Promise<void>((resolve, reject) => {
          signal.throwIfAborted();
          const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
          const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 2000);
          signal.addEventListener("abort", onAbort, { once: true });
        });
        continue;
      }
      if (!response.ok || !result?.ok) throw new Error(result?.error || "Unable to load the analysis. Check your connection and sign in again if your session expired.");
      return { summary: parseEmailSummary(result.output), cached: result.cached === true, generatedAt: result.generatedAt as string | undefined };
    }
  })();
  pending.set(key, work);
  void work.finally(() => { if (pending.get(key) === work) pending.delete(key); }).catch(() => {});
  return work;
}
