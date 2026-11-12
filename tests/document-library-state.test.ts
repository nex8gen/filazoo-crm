import assert from "node:assert/strict";
import test from "node:test";
import { documentLibraryQueryKey, documentLibraryReducer, documentLibrarySearchDelay, initialDocumentLibraryState, selectDocumentLibrary } from "../lib/document-library-state.ts";
import type { LibraryDocument, LibraryResult } from "../lib/documents.ts";

const quotationKey = documentLibraryQueryKey({ view: "all", category: "quotation", sort: "newest" });
const proformaKey = documentLibraryQueryKey({ view: "all", category: "proforma", sort: "newest" });
const invoiceKey = documentLibraryQueryKey({ view: "all", category: "invoice", sort: "newest" });
const quote = { id: "quotation-file", name: "Product quotation.pdf", category: "quotation", kind: "file" } as LibraryDocument;
function result(documents: LibraryDocument[], total = documents.length): LibraryResult {
  return { documents, total, folders: [{ id: "folder", name: "Brand & marketing", color: "green" }], stats: { files: 1, templates: 0, starred: 0, trash: 0 } };
}
function loadedQuotation() {
  let state = documentLibraryReducer(initialDocumentLibraryState(), { type: "request", id: 1, key: quotationKey, offset: 0 });
  state = documentLibraryReducer(state, { type: "success", id: 1, key: quotationKey, result: result([quote]) });
  return state;
}

test("switching categories hides old rows and counts before the new request starts", () => {
  const state = loadedQuotation();
  assert.equal(selectDocumentLibrary(state, quotationKey).data?.total, 1);
  const proforma = selectDocumentLibrary(state, proformaKey);
  assert.equal(proforma.data, null);
  assert.equal(proforma.loading, true);
  assert.equal(proforma.metadata?.folders[0].name, "Brand & marketing");
});

test("slow out-of-order requests cannot replace the latest category or report its errors", async () => {
  let state = loadedQuotation();
  let finishProforma!: (value: LibraryResult) => void;
  let finishInvoice!: (value: LibraryResult) => void;
  const proformaResponse = new Promise<LibraryResult>(resolve => { finishProforma = resolve; });
  const invoiceResponse = new Promise<LibraryResult>(resolve => { finishInvoice = resolve; });

  state = documentLibraryReducer(state, { type: "request", id: 2, key: proformaKey, offset: 0 });
  const old = proformaResponse.then(value => { state = documentLibraryReducer(state, { type: "success", id: 2, key: proformaKey, result: value }); });
  state = documentLibraryReducer(state, { type: "request", id: 3, key: invoiceKey, offset: 0 });
  const current = invoiceResponse.then(value => { state = documentLibraryReducer(state, { type: "success", id: 3, key: invoiceKey, result: value }); });
  finishInvoice(result([])); await current;
  finishProforma(result([{ ...quote, id: "different-file", category: "proforma" }])); await old;
  state = documentLibraryReducer(state, { type: "failure", id: 2, key: proformaKey, error: "Old request failed" });

  const invoice = selectDocumentLibrary(state, invoiceKey);
  assert.deepEqual(invoice.data?.documents, []);
  assert.equal(invoice.data?.total, 0);
  assert.equal(invoice.error, "");
  assert.equal(invoice.loading, false);
});

test("returning to a category immediately uses only that category's cached files", () => {
  let state = loadedQuotation();
  state = documentLibraryReducer(state, { type: "request", id: 2, key: proformaKey, offset: 0 });
  state = documentLibraryReducer(state, { type: "success", id: 2, key: proformaKey, result: result([]) });
  assert.deepEqual(selectDocumentLibrary(state, quotationKey).data?.documents, [quote]);
  assert.deepEqual(selectDocumentLibrary(state, proformaKey).data?.documents, []);
});

test("uploads and edits invalidate cached views and ignore already-running responses", () => {
  let state = loadedQuotation();
  state = documentLibraryReducer(state, { type: "request", id: 2, key: proformaKey, offset: 0 });
  state = documentLibraryReducer(state, { type: "invalidate" });
  state = documentLibraryReducer(state, { type: "success", id: 2, key: proformaKey, result: result([quote]) });
  assert.equal(selectDocumentLibrary(state, quotationKey).data, null);
  assert.equal(selectDocumentLibrary(state, proformaKey).data, null);
  assert.equal(state.metadata?.folders.length, 1);
});

test("pagination appends within the matching query and removes duplicate rows", () => {
  let state = loadedQuotation();
  state = documentLibraryReducer(state, { type: "request", id: 2, key: quotationKey, offset: 1 });
  const next = { ...quote, id: "quotation-file-2" };
  state = documentLibraryReducer(state, { type: "success", id: 2, key: quotationKey, result: result([quote, next], 2) });
  assert.deepEqual(selectDocumentLibrary(state, quotationKey).data?.documents.map(document => document.id), [quote.id, next.id]);
  assert.equal(selectDocumentLibrary(state, proformaKey).data, null);
});

test("server seed provides rows and navigation on the first render", () => {
  const state = initialDocumentLibraryState({ key: quotationKey, result: result([quote]) });
  assert.deepEqual(selectDocumentLibrary(state, quotationKey).data?.documents, [quote]);
  assert.equal(selectDocumentLibrary(state, quotationKey).loading, false);
  assert.equal(state.metadata?.folders.length, 1);
});

test("refresh retains the current rows and ignores a response from before invalidation", () => {
  let state = loadedQuotation();
  state = documentLibraryReducer(state, { type: "invalidate" });
  state = documentLibraryReducer(state, { type: "success", id: 1, key: quotationKey, result: result([]) });
  assert.deepEqual(selectDocumentLibrary(state, quotationKey).data?.documents, [quote]);
  state = documentLibraryReducer(state, { type: "request", id: 2, key: quotationKey, offset: 0 });
  assert.deepEqual(selectDocumentLibrary(state, quotationKey).data?.documents, [quote]);
  state = documentLibraryReducer(state, { type: "success", id: 2, key: quotationKey, result: result([]) });
  assert.equal(selectDocumentLibrary(state, quotationKey).data?.total, 0);
});

test("searches, customers, folders and picker tabs have distinct query identities", () => {
  const keys = [
    documentLibraryQueryKey({ view: "all", category: "quotation" }),
    documentLibraryQueryKey({ view: "all", category: "quotation", q: "PLA" }),
    documentLibraryQueryKey({ view: "all", category: "quotation", company: "KingTon" }),
    documentLibraryQueryKey({ view: "all", folder: "folder-1" }),
    documentLibraryQueryKey({ view: "all", kind: "file" }),
    documentLibraryQueryKey({ view: "templates", kind: "template" }),
  ];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(documentLibraryQueryKey({ q: " PLA ", view: "all" }), documentLibraryQueryKey({ view: "all", q: "PLA" }));
  assert.equal(documentLibrarySearchDelay(quotationKey, documentLibraryQueryKey({ view: "all", category: "quotation", sort: "newest", q: "PLA" })), 250);
  assert.equal(documentLibrarySearchDelay(documentLibraryQueryKey({ view: "all", category: "quotation", q: "PLA" }), documentLibraryQueryKey({ view: "all", category: "proforma", q: "PLA" })), 0);
});
