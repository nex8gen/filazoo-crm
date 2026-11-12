import assert from "node:assert/strict";
import test from "node:test";
import { filterDocumentLibrary } from "../lib/document-library-filter.ts";
import { documentLibraryReducer, initialDocumentLibraryState, selectDocumentLibrary } from "../lib/document-library-state.ts";
import type { LibraryDocument, LibrarySnapshot } from "../lib/documents.ts";

const file: LibraryDocument = { id: "1", name: "PLA.pdf", kind: "file", category: "quotation", mime_type: "application/pdf", size: 100, folder_id: "brand", company: "KingTon", tags: ["PLA"], description: "Datasheet", subject: "", body: "", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z", deleted_at: null, starred: true, related_ids: [] };
const snapshot: LibrarySnapshot = { documents: [file, { ...file, id: "2", name: "Greeting", kind: "template", category: "everyday", mime_type: "text/plain", body: "Hello partner", starred: false }, { ...file, id: "3", deleted_at: "2026-11-02T00:00:00Z" }], folders: [], stats: { files: 1, templates: 1, starred: 1, trash: 1 } };
const ids = (query: string) => filterDocumentLibrary(snapshot, new URLSearchParams(query), 0, Date.parse("2026-11-12")).documents.map(item => item.id);

test("complete collection filters categories, folders, views and literal searches instantly", () => {
  assert.deepEqual(ids("category=quotation"), ["1"]);
  assert.deepEqual(ids("category=invoice"), []);
  assert.deepEqual(ids("view=templates&q=hello"), ["2"]);
  assert.deepEqual(ids("view=starred"), ["1"]);
  assert.deepEqual(ids("view=trash"), ["3"]);
  assert.deepEqual(ids("company=king&folder=brand&type=pdf"), ["1"]);
  assert.deepEqual(ids("q=%25"), []);
  assert.deepEqual(ids("view=recent"), ["1", "2"]);
});

test("date boundaries use the workspace timezone and types use server MIME rules", () => {
  assert.deepEqual(ids("after=2026-11-01&before=2026-11-01"), ["1", "2"]);
  assert.deepEqual(ids("after=2026-11-02"), []);
  assert.deepEqual(ids("type=document"), ["2"]);
  assert.deepEqual(ids("type=image"), []);
  assert.deepEqual(ids("type=spreadsheet"), []);
});

test("pagination slices locally, preserving total and deterministic ordering", () => {
  const many = { ...snapshot, documents: Array.from({ length: 135 }, (_, i) => ({ ...file, id: String(i).padStart(3, "0") })) };
  const page = filterDocumentLibrary(many, new URLSearchParams());
  assert.equal(page.total, 135);
  assert.equal(page.documents.length, 60);
  assert.equal(filterDocumentLibrary(many, new URLSearchParams(), 60).documents.length, 120);
  assert.equal(filterDocumentLibrary(many, new URLSearchParams(), 120).documents.length, 135);
});

test("switching categories needs no request, and refresh replaces the whole collection", () => {
  let state = initialDocumentLibraryState({ key: "view=all", result: { ...filterDocumentLibrary(snapshot, new URLSearchParams()), collection: snapshot } });
  assert.deepEqual(selectDocumentLibrary(state, "category=quotation").data?.documents.map(item => item.id), ["1"]);
  assert.equal(selectDocumentLibrary(state, "category=invoice").loading, false);
  state = documentLibraryReducer(state, { type: "invalidate" });
  assert.equal(selectDocumentLibrary(state, "category=quotation").data?.total, 1);
  state = documentLibraryReducer(state, { type: "request", id: 1, key: "view=all", offset: 0 });
  const empty = { ...snapshot, documents: [] };
  state = documentLibraryReducer(state, { type: "success", id: 1, key: "view=all", result: { ...filterDocumentLibrary(empty, new URLSearchParams()), collection: empty } });
  assert.equal(selectDocumentLibrary(state, "category=quotation").data?.total, 0);
});
