/** Small HTML batches avoid oversized requests and long-running email translations. */
export async function requestEmailTranslation(segments: string[], fetcher: typeof fetch = fetch) {
  const translated: string[] = [];
  for (let start = 0; start < segments.length;) {
    const batch: string[] = [];
    let length = 0;
    while (start < segments.length && batch.length < 40) {
      const segment = segments[start];
      if (batch.length && length + segment.length > 8_000) break;
      batch.push(segment);
      length += segment.length;
      start++;
    }
    const response = await fetcher("/api/email/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "translate", text: "Email translation", segments: batch }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(result?.segments) || result.segments.length !== batch.length
      || result.segments.some((text: unknown) => typeof text !== "string" || !text.trim())) {
      throw new Error(result?.error || "Email translation could not finish. Please retry translation.");
    }
    translated.push(...result.segments);
  }
  return translated;
}
