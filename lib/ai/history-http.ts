const unavailable = "Saved conversations are temporarily unavailable. Retry loading them.";
/** Retry reads once, but never replay a save, rename, deletion or AI request. */
export async function requestHistoryJson(url: string, init?: RequestInit, fetcher: typeof fetch = fetch) {
  const read = !init?.method || init.method.toUpperCase() === "GET";
  for (let attempt = 0; ; attempt++) {
    init?.signal?.throwIfAborted();
    let response: Response;
    try { response = await fetcher(url, { cache: "no-store", ...init }); }
    catch (error) {
      if (read && attempt === 0 && error instanceof TypeError && !init?.signal?.aborted) continue;
      if (init?.signal?.aborted) throw error;
      throw new Error(unavailable);
    }
    const result = await response.json().catch(() => null);
    if (response.ok && result) return result;
    if (read && attempt === 0 && [500, 502, 503, 504].includes(response.status) && !init?.signal?.aborted) continue;
    if (response.status === 401) throw new Error("Your session has expired. Sign in again to continue.");
    throw new Error(result?.error || unavailable);
  }
}
