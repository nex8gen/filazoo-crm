import assert from "node:assert/strict";
import test from "node:test";
import { canPreviewDocument, documentInputSchema, documentSearchText, escapeDocumentSearch, formatDocumentSize } from "../lib/documents.ts";
import { fillLibraryTemplate, loadLibraryEmailItem } from "../lib/document-email.ts";

test("library templates require content and constrain metadata", () => {
  const template = { id: crypto.randomUUID(), kind: "template", name: "Introduction", body: "Hello {{first_name}}" };
  assert.equal(documentInputSchema.safeParse(template).success, true);
  assert.equal(documentInputSchema.safeParse({ ...template, body: "   " }).success, false);
  assert.equal(documentInputSchema.safeParse({ ...template, tags: Array(13).fill("tag") }).success, false);
  assert.equal(documentInputSchema.safeParse({ ...template, folder_id: "another-workspace" }).success, false);
});
test("search includes metadata and template contents, preserving multilingual text", () => {
  const text = documentSearchText({ name: "PLA Catalog", company: "KingTon", description: "产品目录", tags: ["Wholesale"], subject: "Welcome", body: "Hello Alice" });
  for (const value of ["pla", "kington", "产品目录", "wholesale", "welcome", "alice"]) assert.ok(text.includes(value));
  assert.equal(escapeDocumentSearch("50%_off\\sale"), "50\\%\\_off\\\\sale");
});
test("active formats cannot become inline library previews", () => {
  for (const mime of ["image/svg+xml", "text/html", "application/javascript", "application/octet-stream"]) assert.equal(canPreviewDocument(mime), false);
  for (const mime of ["application/pdf", "image/png", "image/jpeg"]) assert.equal(canPreviewDocument(mime), true);
  assert.equal(formatDocumentSize(52428800), "50.0 MB");
});

test("business documents and email templates cannot use each other's categories", () => {
  const input = { id: crypto.randomUUID(), kind: "file", name: "Catalog.pdf", category: "catalog" };
  assert.equal(documentInputSchema.safeParse(input).success, true);
  assert.equal(documentInputSchema.safeParse({ ...input, category: "promotion" }).success, false);
  assert.equal(documentInputSchema.safeParse({ ...input, kind: "template", body: "Hello", category: "quotation" }).success, false);
});

test("email insertion only replaces placeholders with known customer details", () => {
  assert.equal(fillLibraryTemplate("Hello {{first_name}}, {{company_name}} / {{unknown}}", { name: "Alex Chen", company: "KingTon" }), "Hello Alex, KingTon / {{unknown}}");
  assert.equal(fillLibraryTemplate("Hi {{first_name}}", {}), "Hi {{first_name}}");
});

test("a linked template loads its actual attachments before insertion", async () => {
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes("details=1")) return Response.json({ document: { kind: "template", body: "Hello" }, related: [{ id: "file-id", name: "catalog.txt", size: 7, mime_type: "text/plain" }] });
    if (url === "/api/documents/file-id") return Response.json({ url: "https://storage.example.test/signed" });
    assert.equal(url, "https://storage.example.test/signed");
    return new Response("Catalog", { headers: { "Content-Type": "text/plain" } });
  };
  const item = await loadLibraryEmailItem("template-id", undefined, fetcher);
  assert.equal(item.files[0].name, "catalog.txt");
  assert.equal(await item.files[0].text(), "Catalog");
});

test("email insertion rejects oversized attachments and unavailable items", async () => {
  await assert.rejects(loadLibraryEmailItem("id", undefined, async () => Response.json({ document: { kind: "file", size: 7500001 } })), /7.5 MB/);
  await assert.rejects(loadLibraryEmailItem("id", undefined, async () => Response.json({ error: "Unavailable" }, { status: 404 })), /Unavailable/);
});
