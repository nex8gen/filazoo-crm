import { MAX_CHAT_ATTACHMENTS, MAX_CHAT_FILE_BYTES } from "./image-input.ts";

export type ChatLibraryFile = { id: string; name: string; mime_type: string; size: number; company?: string };

/** Resolve each file through the existing authenticated library access checks. */
export async function readChatLibraryFiles(documents: ChatLibraryFile[], fetcher: typeof fetch = fetch): Promise<File[]> {
  if (documents.length > MAX_CHAT_ATTACHMENTS) throw new Error("Add up to 5 files at a time, including images.");
  let total = 0;
  const files: File[] = [];
  for (const document of documents) {
    const link = await fetcher(`/api/documents/${encodeURIComponent(document.id)}?download=1`, { cache: "no-store" });
    const result = await link.json();
    if (!link.ok || typeof result.url !== "string") throw new Error(result.error || `Unable to open “${document.name}”.`);
    const response = await fetcher(result.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to download “${document.name}”. Try again.`);
    if (Number(response.headers.get("content-length")) + total > MAX_CHAT_FILE_BYTES) throw new Error("The selected files are too large. Attach up to 3 MB total.");
    if (!response.body) throw new Error(`Unable to read “${document.name}”.`);
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_CHAT_FILE_BYTES) { await reader.cancel(); throw new Error("The selected files are too large. Attach up to 3 MB total."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    files.push(new File(chunks, document.name, { type: response.headers.get("content-type")?.split(";")[0] || document.mime_type }));
  }
  return files;
}
