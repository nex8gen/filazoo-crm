import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { optimizeEmailImage, emailImageSourceLimit, emailInlineImageLimit } from "../lib/email-image-client.ts";

test("small uploaded image bytes and GIF animation are preserved, with source limits enforced", async () => {
  const file = new File(["GIF89a"], "animated.gif", { type: "image/gif" });
  assert.equal(await optimizeEmailImage(file), file);
  await assert.rejects(optimizeEmailImage(new File(["svg"], "bad.svg", { type: "image/svg+xml" })), /PNG, JPG, GIF, or WebP/);
  await assert.rejects(optimizeEmailImage(new File([new Uint8Array(emailImageSourceLimit + 1)], "large.png", { type: "image/png" })), /10 MB/);
  await assert.rejects(optimizeEmailImage(new File([new Uint8Array(emailInlineImageLimit + 1)], "large.gif", { type: "image/gif" })), /animation can be preserved/);
});

function optimizer(width = 2400, height = 1200, fails = false) {
  const drawn: Array<[number, number]> = [], formats: string[] = []; let revoked = false;
  class Image { naturalWidth = width; naturalHeight = height; onload?: () => void; onerror?: () => void; set src(_: string) { if (fails) this.onerror?.(); else this.onload?.(); } }
  const api = {} as { optimizeEmailImage: typeof optimizeEmailImage };
  const document = { createElement: () => { const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => drawn.push([canvas.width, canvas.height]) }), toBlob: (callback: (blob: Blob) => void, format: string) => { formats.push(format); callback(new Blob(["optimized bytes"], { type: format })); } }; return canvas; } };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/email-image-client.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, Image, File, document, URL: { createObjectURL: () => "blob:image", revokeObjectURL: () => { revoked = true; } } });
  return { api, drawn, formats, revoked: () => revoked };
}

test("large static uploads are actually rasterized to bounded email dimensions and preserve transparent formats", async () => {
  for (const type of ["image/png", "image/webp", "image/jpeg"]) {
    const optimize = optimizer();
    const result = await optimize.api.optimizeEmailImage(new File([new Uint8Array(emailInlineImageLimit + 1)], "upload.webp", { type }));
    assert.deepEqual(optimize.drawn, [[1200, 600]]); assert.equal(result.type, type === "image/jpeg" ? "image/jpeg" : "image/png");
    assert.ok(result.size < emailInlineImageLimit); assert.equal(optimize.revoked(), true);
  }
});

test("unreadable and excessively large pixel sources fail and release their object URLs", async () => {
  for (const optimize of [optimizer(8000, 8000), optimizer(10, 10, true)]) {
    await assert.rejects(optimize.api.optimizeEmailImage(new File([new Uint8Array(emailInlineImageLimit + 1)], "upload.png", { type: "image/png" })), /40 megapixels|Unable to read/);
    assert.equal(optimize.revoked(), true); assert.equal(optimize.drawn.length, 0);
  }
});
