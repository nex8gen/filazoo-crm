import assert from "node:assert/strict";
import test from "node:test";
import { addDocumentUploadFiles, createDocumentUploadSession, isSameDocumentUpload } from "../lib/document-upload.ts";

const file = (name: string, size = 10) => ({ name, size, lastModified: 123 });
const ticket = { id: "upload-id", path: "workspace/upload-id", token: "token" };
test("file selection treats initial files and later drops alike and keeps valid files up to the limit", () => {
  const first = file("quote.pdf");
  const result = addDocumentUploadFiles([first], [first, file("empty.txt", 0), file("huge.pdf", 50 * 1024 * 1024 + 1), ...Array.from({ length: 21 }, (_, i) => file(`${i}.pdf`))]);
  assert.equal(result.files.length, 20);
  assert.equal(result.files[0], first);
  assert.equal(result.messages.length, 5);
  assert.ok(result.messages.some(message => message.includes("already")));
});
test("a save failure retries metadata with the same id without transferring the file again", async () => {
  let prepared = 0, transferred = 0, saved = 0;
  const ids: string[] = [];
  const upload = createDocumentUploadSession({ prepare: async () => { prepared++; return ticket; }, transfer: async () => { transferred++; }, save: async (value) => { ids.push(value.id); if (++saved === 1) throw new Error("Save timed out"); } });
  const item = file("quote.pdf"), stages: string[] = [];
  await assert.rejects(upload(item, {}, stage => stages.push(stage)), /timed out/);
  await upload(item, {}, stage => stages.push(stage));
  assert.equal(prepared, 1); assert.equal(transferred, 1); assert.equal(saved, 2);
  assert.deepEqual(ids, [ticket.id, ticket.id]);
  assert.equal(stages.at(-1), "completed");
});
test("a lost storage receipt is recovered by server verification before reporting success", async () => {
  const stages: string[] = [];
  const upload = createDocumentUploadSession({ prepare: async () => ticket, transfer: async () => { throw new Error("Connection lost"); }, save: async () => ({ document: { id: ticket.id } }) });
  await upload(file("quote.pdf"), {}, stage => stages.push(stage));
  assert.deepEqual(stages, ["uploading", "saving", "completed"]);
});
test("failed transfers remain failed when the server cannot verify an object", async () => {
  const stages: string[] = [];
  const upload = createDocumentUploadSession({ prepare: async () => ticket, transfer: async () => { throw new Error("Transfer failed"); }, save: async () => { throw new Error("No object"); } });
  await assert.rejects(upload(file("quote.pdf"), {}, stage => stages.push(stage)), /Transfer failed/);
  assert.ok(!stages.includes("completed"));
});
test("idempotent saves only accept the same active file, owner, destination and metadata", () => {
  const row = { id: ticket.id, created_by: "owner", kind: "file", object_path: ticket.path, name: "quote.pdf", category: "quotation", company_id: "customer", tags: ["PLA"], product_skus: ["PLA"] };
  assert.equal(isSameDocumentUpload({ ...row, deleted_at: null, source_type: null }, row), true);
  for (const patch of [{ created_by: "other" }, { folder_id: "different" }, { category: "general" }, { name: "different.pdf" }, { deleted_at: "2026-11-12" }, { source_type: "invoice" }, { tags: [] }]) assert.equal(isSameDocumentUpload({ ...row, ...patch }, row), false);
});
