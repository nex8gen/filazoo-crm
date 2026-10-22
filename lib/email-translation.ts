const GOOGLE_TRANSLATION_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_CHUNK_LENGTH = 1_500;
const MAX_PROVIDER_REQUESTS = 4;
let activeRequests = 0;
const waitingRequests: Array<() => void> = [];
const translationCaches = new WeakMap<typeof fetch, Map<string, Promise<string>>>();

async function withProviderSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeRequests >= MAX_PROVIDER_REQUESTS) await new Promise<void>((resolve) => waitingRequests.push(resolve));
  else activeRequests++;
  try {
    return await run();
  } finally {
    const next = waitingRequests.shift();
    if (next) next();
    else activeRequests--;
  }
}

async function fetchTranslation(fetcher: typeof fetch, url: URL, options: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await withProviderSlot(() => fetcher(url, { ...options, signal: AbortSignal.timeout(12_000) }));
    } catch {
      if (attempt >= 2) throw new Error("Could not connect to the translation service. Please retry translation shortly.");
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
      continue;
    }
    return response;
  }
}

export function getEmailTranslationProvider() {
  return process.env.LIBRETRANSLATE_URL?.trim() ? "libretranslate" : "google-translate";
}

function readGoogleTranslation(result: unknown): string | undefined {
  if (!Array.isArray(result) || !Array.isArray(result[0]) || !result[0].length) return;
  const segments: unknown[] = result[0];
  if (!segments.every((segment) => Array.isArray(segment) && typeof segment[0] === "string")) return;
  return segments.map((segment) => (segment as string[])[0]).join("").trim();
}

function splitForTranslation(text: string, maxLength = MAX_CHUNK_LENGTH) {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength + 1);
    const candidates = [window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf(" ")];
    const splitAt = candidates.find((index) => index >= Math.floor(maxLength * 0.55)) ?? maxLength;
    const includeSeparator = window.slice(splitAt, splitAt + 2) === ". " ? 1 : 0;
    const end = splitAt + includeSeparator;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function looksLikeEnglish(text: string) {
  const latinCharacters = text.match(/[A-Za-z]/g)?.length ?? 0;
  const chineseCharacters = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  return latinCharacters >= 2 && latinCharacters >= chineseCharacters * 2;
}

/** Keep each HTML text node aligned with its result, with bounded provider concurrency. */
export async function translateEmailSegments(segments: string[], fetcher: typeof fetch = fetch) {
  const output = new Array<string>(segments.length);
  let nextIndex = 0;
  let failed = false;
  let cache = translationCaches.get(fetcher);
  if (!cache) { cache = new Map(); translationCaches.set(fetcher, cache); }
  await Promise.all(Array.from({ length: Math.min(4, segments.length) }, async () => {
    while (!failed && nextIndex < segments.length) {
      const index = nextIndex++;
      if (!looksLikeEnglish(segments[index])) { output[index] = segments[index]; continue; }
      const key = JSON.stringify([process.env.LIBRETRANSLATE_URL?.trim() || "google", segments[index]]);
      let translation = cache.get(key);
      if (!translation) {
        translation = translateEnglishEmail(segments[index], fetcher);
        cache.set(key, translation);
        // Bound memory while retaining completed segments for a failed email's retry.
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
      }
      try {
        output[index] = await translation;
      } catch (error) {
        if (cache.get(key) === translation) cache.delete(key);
        failed = true;
        throw error;
      }
    }
  }));
  return output;
}

export async function translateEnglishEmail(
  text: string,
  fetcher: typeof fetch = fetch,
) {
  const chunks = splitForTranslation(text);
  if (!chunks.length) throw new Error("Enter an English email to translate.");

  const translations: string[] = [];
  const libreTranslateUrl = process.env.LIBRETRANSLATE_URL?.trim();
  for (const chunk of chunks) {
    const url = libreTranslateUrl
      ? new URL(`${libreTranslateUrl.replace(/\/+$/, "")}/translate`)
      : new URL(GOOGLE_TRANSLATION_ENDPOINT);
    if (!libreTranslateUrl) {
      url.searchParams.set("client", "gtx");
      url.searchParams.set("sl", "en");
      url.searchParams.set("tl", "zh-CN");
      url.searchParams.set("dt", "t");
      url.searchParams.set("q", chunk);
    }

    const response = await fetchTranslation(fetcher, url, {
      method: libreTranslateUrl ? "POST" : "GET",
      headers: { Accept: "application/json", ...(libreTranslateUrl ? { "Content-Type": "application/json" } : {}) },
      ...(libreTranslateUrl ? {
        body: JSON.stringify({ q: chunk, source: "en", target: "zh", format: "text", api_key: process.env.LIBRETRANSLATE_API_KEY?.trim() || undefined }),
      } : {}),
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(response.status === 429
        ? "The translation service is busy. Please try again shortly."
        : "The translation service is temporarily unavailable. Please try again.");
    }
    const result: unknown = await response.json().catch(() => null);
    const translatedText = libreTranslateUrl
      ? (result && typeof result === "object" && "translatedText" in result && typeof result.translatedText === "string" ? result.translatedText.trim() : undefined)
      : readGoogleTranslation(result);
    if (!translatedText) {
      throw new Error("The translation service returned an invalid response. Please try again.");
    }
    translations.push(translatedText);
  }

  return translations.join("\n\n");
}

