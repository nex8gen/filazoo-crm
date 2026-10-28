import type { AutoReplyState } from "./email-auto-reply.ts";

type AutoReplyResponse = { ok: boolean; automation: AutoReplyState | null; error?: string };

/** Bound requests so a stalled connection never leaves the switch loading forever. */
export async function requestAutoReply(url: string, init: RequestInit = {}, {
  request = fetch, timeoutMs = 12_000,
}: { request?: typeof fetch; timeoutMs?: number } = {}): Promise<AutoReplyResponse> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  try {
    const response = await request(url, { ...init, cache: "no-store", signal: controller.signal });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || "Unable to save auto-reply. Try again.");
    return result;
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw new Error("Connection timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", abort);
  }
}
