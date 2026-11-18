/** Infrastructure failures do not prove that a session is invalid. */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: string; status?: number; code?: string };
  return value.name === "AuthRetryableFetchError" || value.name === "TypeError" || value.name === "TimeoutError"
    || value.status === 408 || value.status === 429 || (typeof value.status === "number" && value.status >= 500)
    || (value.status === 409 && value.code === "conflict");
}
