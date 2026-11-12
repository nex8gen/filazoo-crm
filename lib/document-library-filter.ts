import { documentSearchText, type LibraryResult, type LibrarySnapshot } from "./documents.ts";

const spreadsheets = new Set(["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.oasis.opendocument.spreadsheet"]);
const documents = new Set(["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown", "application/rtf"]);

/** Only use a complete, authorized collection; partial pages must go to the server. */
export function filterDocumentLibrary(snapshot: LibrarySnapshot, params: URLSearchParams, offset = 0, now = Date.now()): LibraryResult {
  const view = params.get("view"), kind = params.get("kind"), type = params.get("type");
  const category = params.get("category"), folder = params.get("folder");
  const search = params.get("q")?.trim().slice(0, 200).toLowerCase();
  const company = params.get("company")?.trim().slice(0, 160).toLowerCase();
  const after = params.get("after"), before = params.get("before");
  const start = after ? Date.parse(`${after}T00:00:00+08:00`) : NaN;
  const end = before ? Date.parse(`${before}T00:00:00+08:00`) + 86400000 : NaN;
  const rows = snapshot.documents.filter(item => {
    if (view === "trash" ? !item.deleted_at : !!item.deleted_at) return false;
    if ((kind === "file" || kind === "template") && item.kind !== kind) return false;
    if (view === "templates" && item.kind !== "template") return false;
    if (view === "starred" && !item.starred) return false;
    const updated = Date.parse(item.updated_at);
    if (view === "recent" && updated < now - 30 * 86400000) return false;
    if (updated < start || updated >= end) return false;
    if (category && item.category !== category) return false;
    if (folder && item.folder_id !== folder) return false;
    if (company && !item.company.toLowerCase().includes(company)) return false;
    if (search && !(item.search_text ?? documentSearchText(item)).includes(search)) return false;
    if (params.get("attachable") === "1" && item.mime_type === "application/x-filazoo-record") return false;
    if (type === "pdf" && item.mime_type !== "application/pdf") return false;
    if (type === "image" && !item.mime_type.startsWith("image/")) return false;
    if (type === "document" && !documents.has(item.mime_type)) return false;
    if (type === "spreadsheet" && !spreadsheets.has(item.mime_type)) return false;
    return true;
  });
  const sort = params.get("sort");
  rows.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : (Date.parse(a.updated_at) - Date.parse(b.updated_at)) * (sort === "oldest" ? 1 : -1)) || a.id.localeCompare(b.id));
  return { documents: rows.slice(0, Math.max(0, offset) + 60), total: rows.length, folders: snapshot.folders, stats: snapshot.stats };
}
