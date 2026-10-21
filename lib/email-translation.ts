const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";
const MAX_CHUNK_LENGTH = 450;

type MyMemoryResponse = {
  responseData?: {
    translatedText?: string;
  };
  responseDetails?: string;
  responseStatus?: number | string;
};

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

export async function translateEnglishEmail(
  text: string,
  fetcher: typeof fetch = fetch,
) {
  const chunks = splitForTranslation(text);
  if (!chunks.length) throw new Error("Enter an English email to translate.");

  const translations: string[] = [];
  for (const chunk of chunks) {
    const url = new URL(MYMEMORY_ENDPOINT);
    url.searchParams.set("q", chunk);
    url.searchParams.set("langpair", "en|zh-CN");
    const contactEmail = process.env.MYMEMORY_CONTACT_EMAIL?.trim();
    if (contactEmail) url.searchParams.set("de", contactEmail);

    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const result = await response.json().catch(() => ({})) as MyMemoryResponse;
    const translatedText = result.responseData?.translatedText?.trim();
    if (!response.ok || !translatedText || Number(result.responseStatus ?? response.status) >= 400) {
      throw new Error(result.responseDetails || "The free translation service is temporarily unavailable.");
    }
    translations.push(translatedText);
  }

  return translations.join("\n\n");
}

