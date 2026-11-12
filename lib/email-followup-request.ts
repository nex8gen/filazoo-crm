/** Preserve actionable errors even when a proxy or expired session returns HTML. */
export async function requestFollowup(url: string, init?: RequestInit, timeoutMs = 15_000) {
  const signal = AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(timeoutMs)]);
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init, signal }); }
  catch (cause) {
    if (init?.signal?.aborted) throw cause;
    if (signal.aborted) throw new Error("The follow-up request timed out. Please retry.");
    throw new Error("Could not reach follow-ups. Check your connection and retry.");
  }
  if (response.redirected && /\/(?:login|workspaces|access-denied)(?:[/?]|$)/.test(response.url)) throw new Error("Your session has expired. Sign in again to load follow-ups.");
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const message = response.status === 401 ? "Your session has expired. Sign in again to load follow-ups."
      : response.status === 403 ? "Your account cannot access this follow-up."
      : `Follow-ups are temporarily unavailable (${response.status}). Please retry.`;
    throw new Error(typeof result?.error === "string" ? result.error : message);
  }
  return result;
}
