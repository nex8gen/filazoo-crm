import { MAX_DOCUMENT_BYTES } from "./documents.ts";

type UploadFile = { name: string; size: number; lastModified: number };
export function addDocumentUploadFiles<T extends UploadFile>(existing: T[], incoming: T[]) {
  const files = [...existing], messages: string[] = [];
  const signatures = new Set(existing.map(file => JSON.stringify([file.name, file.size, file.lastModified])));
  for (const file of incoming) {
    if (!file.size || file.size > MAX_DOCUMENT_BYTES) { messages.push(`${file.name}: choose a non-empty file up to 50 MB.`); continue; }
    const signature = JSON.stringify([file.name, file.size, file.lastModified]);
    if (signatures.has(signature)) { messages.push(`${file.name}: already in this upload.`); continue; }
    if (files.length >= 20) { messages.push(`${file.name}: the 20-file limit has been reached.`); continue; }
    signatures.add(signature); files.push(file);
  }
  return { files, messages };
}

export type UploadTicket = { id: string; path: string; token: string };
export type UploadStage = "uploading" | "saving" | "completed";
/** Keep one object/id per file, even if transferring or saving loses its response. */
export function createDocumentUploadSession<T extends object>(dependencies: {
  prepare: (file: T) => Promise<UploadTicket>;
  transfer: (file: T, ticket: UploadTicket) => Promise<void>;
  save: (ticket: UploadTicket, metadata: Record<string, unknown>) => Promise<unknown>;
}) {
  const tickets = new WeakMap<T, { ticket: UploadTicket; transferred: boolean }>();
  return async (file: T, metadata: Record<string, unknown>, report: (stage: UploadStage) => void) => {
    let state = tickets.get(file);
    if (!state?.transferred) report("uploading");
    if (!state) { state = { ticket: await dependencies.prepare(file), transferred: false }; tickets.set(file, state); }
    if (!state.transferred) {
      try { await dependencies.transfer(file, state.ticket); state.transferred = true; }
      catch (transferError) {
        // A timeout can occur after storage has accepted the object. Let the
        // server verify that object and finalize it before reporting a failure.
        report("saving");
        try { await dependencies.save(state.ticket, metadata); state.transferred = true; report("completed"); return; }
        catch { throw transferError; }
      }
    }
    report("saving");
    await dependencies.save(state.ticket, metadata);
    report("completed");
  };
}

export function isSameDocumentUpload(existing: Record<string, unknown>, requested: Record<string, unknown>) {
  if (existing.deleted_at || existing.source_type || existing.kind !== "file") return false;
  return ["id", "created_by", "kind", "object_path", "mime_type", "size", "name", "category", "folder_id", "company", "company_id", "purchase_order_id", "invoice_id", "product_skus", "tags", "description", "subject", "body", "related_ids"].every(key => JSON.stringify(existing[key]) === JSON.stringify(requested[key]));
}
