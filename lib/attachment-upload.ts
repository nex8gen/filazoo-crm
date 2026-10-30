type UploadError = { message: string; statusCode?: string | number; status?: number };

/** Only use for a new operation's private, UUID-scoped object path. SMTP is never retried here. */
export async function uploadFlowAttachment(upload: (options: { upsert: boolean }) => PromiseLike<{ error: UploadError | null }>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let error: UploadError | null;
    try { ({ error } = await upload({ upsert: true })); }
    catch (cause) { error = { message: cause instanceof Error ? cause.message : String(cause) }; }
    if (!error) return;
    const status = Number(error.statusCode ?? error.status ?? 0);
    const transient = status === 429 || status >= 500 || /fetch failed|network|timed?\s*out|ECONNRESET|ETIMEDOUT/i.test(error.message);
    if (!transient || attempt === 2) throw new Error(`Could not store the email attachment: ${error.message}${status ? ` (${status})` : ""}`);
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
}
