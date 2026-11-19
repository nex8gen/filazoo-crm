import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as media from "../lib/product-media.ts";

function fixture(failUpload = false, failSave = false) {
  const id = "a1111111-1111-4111-8111-111111111111", calls: string[] = [];
  let type = "", size = 0, name = "";
  const dependencies = {
    "./product-media.ts": media,
    "@/lib/supabase/client": { createClient: () => ({ storage: { from(bucket: string) { assert.equal(bucket, "workspace-documents"); return { async uploadToSignedUrl(path: string, token: string, file: File, options: { contentType: string }) {
      calls.push("upload"); assert.equal(path, `workspace/${id}`); assert.equal(token, "signed-token"); assert.equal(options.contentType, file.type); type = file.type; size = file.size; name = file.name;
      return { error: failUpload ? new Error("Failed") : null };
    } }; } } }) },
  };
  const api = {} as typeof import("../lib/product-media-upload.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/product-media-upload.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (key: keyof typeof dependencies) => dependencies[key], fetch: async (url: string, init: RequestInit) => {
    assert.equal(url, "/api/documents"); const body = JSON.parse(String(init.body)); calls.push(body.action);
    if (body.action === "prepare_upload") return Response.json({ id, path: `workspace/${id}`, token: "signed-token" });
    assert.equal(body.action, "create"); assert.equal(calls.at(-2), "upload"); assert.equal(body.id, id); assert.equal(body.name, name); assert.equal(body.kind, "file");
    return failSave ? Response.json({ error: "Could not save file details" }, { status: 503 }) : Response.json({ document: { id, name, mime_type: type, size, created_at: "2026-11-19T00:00:00Z" } });
  } });
  return { api, calls };
}

test("media uploads use company storage and register files before returning persistent product URLs", async () => {
  for (const [type, name] of [["image/png", "Spool.png"], ["video/mp4", "Print.mp4"]]) {
    const f = fixture(), file = new File(["file-content"], name, { type });
    const uploaded = await f.api.uploadCompanyMedia(file, "live");
    assert.deepEqual(f.calls, ["prepare_upload", "upload", "create"]);
    assert.equal(uploaded.url, media.productLibraryMediaUrl(uploaded.id, type));
    assert.equal(uploaded.name, name);
    assert.equal(uploaded.mimeType, type);
  }
});

test("failed or invalid media uploads never return unusable URLs", async () => {
  const rejected = fixture();
  await assert.rejects(rejected.api.uploadCompanyMedia(new File(["html"], "script.html", { type: "text/html" }), "live"), /Choose an image/);
  assert.equal(rejected.calls.length, 0);
  const failed = fixture(true);
  await assert.rejects(failed.api.uploadCompanyMedia(new File(["image"], "Image.png", { type: "image/png" }), "live"), /upload failed/);
  assert.deepEqual(failed.calls, ["prepare_upload", "upload"]);
  const saveFailed = fixture(false, true);
  await assert.rejects(saveFailed.api.uploadCompanyMedia(new File(["video"], "Print.mp4", { type: "video/mp4" }), "live"), /Could not save file details/);
});
