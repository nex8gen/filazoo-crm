import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import * as media from "../lib/product-media.ts";
import { validProductImage, validProductMedia, productMediaFromTags, productMediaTag } from "../lib/product-images.ts";
import { emailDesignUrl } from "../lib/email-design.ts";
import { inlinePrivateEmailImages } from "../lib/email-products.ts";
import { newEmailBlock, newEmailDesign } from "../lib/email-design.ts";
import type { WorkspaceViewer } from "../lib/auth.ts";

const require = createRequire(import.meta.url);
const workspace = "11111111-1111-4111-8111-111111111111", otherWorkspace = "22222222-2222-4222-8222-222222222222";
const imageId = "a1111111-1111-4111-8111-111111111111", videoId = "b2222222-2222-4222-8222-222222222222";
const viewer = { id: imageId, workspaceId: workspace, role: "admin" } as WorkspaceViewer;
const imageUrl = media.productLibraryMediaUrl(imageId, "image/jpeg")!, videoUrl = media.productLibraryMediaUrl(videoId, "video/mp4")!;

function fixture() {
  const rows = [
    { id: imageId, name: "Spool.jpg", mime_type: "image/jpeg", size: 1234, workspace_id: workspace, kind: "file", source_type: null, deleted_at: null, object_path: `${workspace}/${imageId}`, created_at: "2026-11-19", search_text: "spool.jpg white" },
    { id: videoId, name: "Printer.mp4", mime_type: "video/mp4", size: 2000000, workspace_id: workspace, kind: "file", source_type: null, deleted_at: null, object_path: `${workspace}/${videoId}`, created_at: "2026-11-18", search_text: "printer.mp4" },
    { id: crypto.randomUUID(), name: "Secret.jpg", mime_type: "image/jpeg", size: 1500, workspace_id: otherWorkspace, kind: "file", source_type: null, deleted_at: null, object_path: "other/file", created_at: "2026-11-17", search_text: "secret" },
    { id: crypto.randomUUID(), name: "Trashed.jpg", mime_type: "image/jpeg", size: 1500, workspace_id: workspace, kind: "file", source_type: null, deleted_at: "2026-11-18", object_path: "trash/file", created_at: "2026-11-17", search_text: "trashed" },
    { id: crypto.randomUUID(), name: "Manual.pdf", mime_type: "application/pdf", size: 1500, workspace_id: workspace, kind: "file", source_type: null, deleted_at: null, object_path: "pdf/file", created_at: "2026-11-17", search_text: "manual" },
  ];
  let failed = false, signedPath = "";
  const admin = { from(table: string) {
    assert.equal(table, "library_documents");
    type Row = typeof rows[number];
    const predicates: Array<(row: Row) => boolean> = [];
    let start = 0, end = 99999;
    const result = () => { const data = rows.filter(row => predicates.every(predicate => predicate(row))); return { data: data.slice(start, end + 1), count: data.length, error: failed ? new Error("DB unavailable") : null }; };
    const query = {
      select() { return query; },
      eq(field: keyof Row, value: unknown) { predicates.push(row => row[field] === value); return query; },
      is(field: keyof Row, value: unknown) { predicates.push(row => row[field] === value); return query; },
      in(field: keyof Row, values: unknown[]) { predicates.push(row => values.includes(row[field])); return query; },
      ilike(field: keyof Row, value: string) { predicates.push(row => String(row[field]).includes(value.slice(1, -1))); return query; },
      like(field: keyof Row, value: string) { predicates.push(row => String(row[field]).startsWith(value.slice(0, -1))); return query; },
      lt(field: keyof Row, value: number) { predicates.push(row => Number(row[field]) < value); return query; },
      lte(field: keyof Row, value: number) { predicates.push(row => Number(row[field]) <= value); return query; },
      gt(field: keyof Row, value: number) { predicates.push(row => Number(row[field]) > value); return query; },
      gte(field: keyof Row, value: number) { predicates.push(row => Number(row[field]) >= value); return query; },
      order() { return query; }, range(from: number, to: number) { start = from; end = to; return query; },
      async maybeSingle() { const output = result(); return { ...output, data: output.data[0] ?? null }; },
      then(resolve: (result: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return query;
  }, storage: { from(bucket: string) { assert.equal(bucket, "workspace-documents"); return { async createSignedUrl(path: string, seconds: number) { signedPath = path; assert.equal(seconds, 300); return { data: { signedUrl: "https://storage.test/signed" }, error: null }; }, async download() { return { data: new Blob(["image"]), error: null }; } }; } } };
  class DocumentError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "../auth.ts": { getWorkspaceViewer: async () => viewer }, "../supabase/admin.ts": { createSupabaseAdmin: () => admin },
    "../workspace-context.ts": { withWorkspaceViewer: (scope: WorkspaceViewer, callback: () => unknown) => { assert.equal(scope.workspaceId, workspace); return callback(); }, currentWorkspaceContext: () => null },
    "../documents.ts": { DOCUMENT_BUCKET: "workspace-documents", escapeDocumentSearch: (value: string) => value }, "./documents.ts": { DocumentError }, "../product-media.ts": media,
  };
  const api = {} as typeof import("../lib/data/product-media.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/product-media.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => dependencies[name] ?? require(name) });
  return { api, rows, fail: () => { failed = true; }, signedPath: () => signedPath };
}

test("company media lists only active images and videos in the authenticated workspace", async () => {
  const f = fixture();
  const page = await f.api.listProductMedia(viewer, new URLSearchParams());
  assert.equal(page.total, 2);
  assert.deepEqual(Array.from(page.items, item => item.url), [imageUrl, videoUrl]);
  const video = await f.api.listProductMedia(viewer, new URLSearchParams("type=video&size=medium"));
  assert.equal(video.items.length, 1);
  assert.equal(video.items[0].url, videoUrl);
  assert.equal((await f.api.listProductMedia(viewer, new URLSearchParams("q=white"))).items[0].name, "Spool.jpg");
  assert.equal((await f.api.listProductMedia(viewer, new URLSearchParams("offset=2"))).items.length, 0);
  f.fail(); await assert.rejects(f.api.listProductMedia(viewer, new URLSearchParams()), /Could not load/);
});

test("saving company media rejects another workspace, trashed files and spoofed extensions", async () => {
  const f = fixture();
  assert.equal(await f.api.validateProductMediaReferences(viewer, [imageUrl, videoUrl, imageUrl]), null);
  for (const url of [media.productLibraryMediaUrl(f.rows[2].id, "image/jpeg")!, media.productLibraryMediaUrl(f.rows[3].id, "image/jpeg")!, imageUrl.replace("jpg", "mp4")]) assert.match((await f.api.validateProductMediaReferences(viewer, [url]))!, /unavailable/);
  assert.equal(await f.api.validateProductMediaReferences(viewer, ["/quotation-2610/PLA/white.png"]), null);
  f.fail(); assert.match((await f.api.validateProductMediaReferences(viewer, [imageUrl]))!, /Could not verify/);
});

test("stable media URLs get fresh storage links only after workspace and path checks", async () => {
  const f = fixture();
  assert.equal(await f.api.productMediaDownload(viewer, imageUrl), "https://storage.test/signed");
  assert.equal(f.signedPath(), `${workspace}/${imageId}`);
  assert.equal(await f.api.productMediaDownload(viewer, videoUrl), "https://storage.test/signed");
  await assert.rejects(f.api.productMediaDownload(viewer, imageUrl.replace("jpg", "mp4")), /unavailable/);
  await assert.rejects(f.api.productMediaDownload(viewer, media.productLibraryMediaUrl(f.rows[2].id, "image/jpeg")!), /unavailable/);
  f.rows[0].object_path = "another-workspace/file";
  await assert.rejects(f.api.productMediaDownload(viewer, imageUrl), /unavailable/);
});

test("image and video metadata survives reloads while video cannot become a product or variant photo", () => {
  assert.equal(validProductMedia(imageUrl), true);
  assert.equal(validProductMedia(videoUrl), true);
  assert.equal(validProductImage(imageUrl), true);
  assert.equal(validProductImage(videoUrl), false);
  assert.equal(validProductMedia("/api/product-media/../secret"), false);
  assert.equal(validProductMedia("javascript:bad()"), false);
  assert.deepEqual(productMediaFromTags([productMediaTag([videoUrl, imageUrl])], []), [videoUrl, imageUrl]);
  assert.equal(media.productMediaCover([videoUrl, imageUrl]), imageUrl);
  assert.equal(media.productMediaCover([videoUrl]), null);
  assert.equal(media.libraryMediaUploadError("video/mp4", 50 * 1024 * 1024), null);
  assert.match(media.libraryMediaUploadError("video/mp4", 50 * 1024 * 1024 + 1)!, /50 MB/);
  assert.ok(media.libraryMediaUploadError("text/html", 100));
});

test("company library images stay private in email previews and embed once for sending", async () => {
  assert.equal(emailDesignUrl(imageUrl, true, true), imageUrl);
  assert.equal(emailDesignUrl(imageUrl, true), "");
  assert.equal(emailDesignUrl(videoUrl, true, true), "");
  const design = { ...newEmailDesign(), blocks: [newEmailBlock("image", { src: imageUrl }), newEmailBlock("image", { src: imageUrl })] };
  let loaded = 0;
  const embedded = await inlinePrivateEmailImages(design, async url => { assert.equal(url, imageUrl); loaded++; return "data:image/png;base64,AAAA"; });
  assert.equal(loaded, 1);
  assert.equal(embedded.blocks[0].src, "data:image/png;base64,AAAA");
});
