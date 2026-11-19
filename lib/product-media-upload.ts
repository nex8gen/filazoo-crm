import type { DataMode } from "./types.ts";
import { libraryMediaUploadError, productLibraryMediaUrl, type ProductLibraryMedia } from "./product-media.ts";

async function libraryRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "Could not upload this file to company storage.");
  return result;
}

export async function uploadCompanyMedia(file: File, mode: DataMode): Promise<ProductLibraryMedia> {
  const error = libraryMediaUploadError(file.type, file.size);
  if (error) throw new Error(error);
  if (mode === "demo") {
    const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read this media file.")); reader.readAsDataURL(file); });
    return { id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, createdAt: new Date().toISOString(), url };
  }
  const ticket = await libraryRequest({ action: "prepare_upload", size: file.size });
  const { createClient } = await import("@/lib/supabase/client");
  const uploaded = await createClient().storage.from("workspace-documents").uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (uploaded.error) throw new Error("The upload failed. Please try again.");
  const saved = await libraryRequest({ action: "create", id: ticket.id, kind: "file", name: file.name.slice(0, 200), category: "general" });
  const document = saved.document;
  const url = productLibraryMediaUrl(document.id, document.mime_type);
  if (!url) throw new Error("This file format cannot be added to product media.");
  return { id: document.id, name: document.name, mimeType: document.mime_type, size: document.size, createdAt: document.created_at, url };
}
