import type { LibraryDocument } from "./documents.ts";

export function fillLibraryTemplate(text: string, context: { name?: string; company?: string }) {
  const values: Record<string, string | undefined> = { first_name: context.name?.trim().split(/\s+/)[0], contact_name: context.name, company_name: context.company };
  return text.replace(/\{\{\s*(first_name|contact_name|company_name)\s*\}\}/g, (placeholder, key: string) => values[key]?.trim() || placeholder);
}

export async function loadLibraryEmailItem(id: string, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/documents/${encodeURIComponent(id)}?details=1`, { signal });
  const result: { document: LibraryDocument; related: LibraryDocument[]; error?: string } = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to open this library item.");
  const documents = result.document.kind === "template" ? result.related : [result.document];
  if (documents.length > 10) throw new Error("An email supports up to 10 attachments.");
  if (documents.some(document => document.size > 7500000)) throw new Error("One of these files exceeds the 7.5 MB email attachment limit. Download and share it separately.");
  const files = await Promise.all(documents.map(async document => {
    const signedResponse = await fetcher(`/api/documents/${document.id}`, { signal });
    const signed = await signedResponse.json();
    if (!signedResponse.ok) throw new Error(signed.error || "Unable to attach this file.");
    const fileResponse = await fetcher(signed.url, { signal });
    if (!fileResponse.ok) throw new Error(`Unable to download ${document.name} for this email.`);
    const blob = await fileResponse.blob();
    if (blob.size > 7500000) throw new Error(`${document.name} exceeds the email attachment limit.`);
    return new File([blob], document.name, { type: document.mime_type });
  }));
  return { document: result.document, files };
}
