import assert from "node:assert/strict";
import test from "node:test";
import { resizeProfilePhoto } from "../lib/profile-photo.ts";
import { PROFILE_AVATAR_MAX_BYTES } from "../lib/profile-avatar.ts";

const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
let bitmapClosed = 0;
let blob = new Blob(["encoded"], { type: "image/webp" });
let drawArgs: unknown[] = [];
let fallback = false;
let decodeError = false;
let contextAvailable = true;
let revoked: string[] = [];
const properties = ["document", "Image", "createImageBitmap"];
const original = properties.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

test.beforeEach(() => {
  bitmapClosed = 0;
  blob = new Blob(["encoded"], { type: "image/webp" });
  drawArgs = [];
  fallback = decodeError = false;
  contextAvailable = true;
  revoked = [];
  Object.assign(globalThis, {
    createImageBitmap: async () => {
      if (fallback) throw new Error("bitmap decode unavailable");
      return { width: 800, height: 600, close() { bitmapClosed++; } };
    },
    Image: class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload?: () => void;
      onerror?: () => void;
      set src(_value: string) { queueMicrotask(() => decodeError ? this.onerror?.() : this.onload?.()); }
    },
    document: { createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => contextAvailable ? { drawImage: (...args: unknown[]) => { drawArgs = args; } } : null,
      toBlob: (callback: (value: Blob) => void) => callback(blob),
    }) },
  });
  test.mock.method(URL, "createObjectURL", () => "blob:profile-preview");
  test.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
});
test.afterEach(() => {
  properties.forEach((key, index) => {
    const descriptor = original[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
  test.mock.restoreAll();
});

test("photos are center-cropped to 384 pixels and decoded bitmap resources are released", async () => {
  assert.equal(await resizeProfilePhoto(file), blob);
  assert.deepEqual(drawArgs.slice(1), [100, 0, 600, 600, 0, 0, 384, 384]);
  assert.equal(bitmapClosed, 1);
});
test("browsers that reject bitmap decoding fall back to an image element", async () => {
  fallback = true;
  assert.equal(await resizeProfilePhoto(file), blob);
  assert.deepEqual(revoked, ["blob:profile-preview"]);
});
test("browsers without createImageBitmap can still upload photos", async () => {
  Reflect.deleteProperty(globalThis, "createImageBitmap");
  assert.equal(await resizeProfilePhoto(file), blob);
  assert.deepEqual(revoked, ["blob:profile-preview"]);
});
test("unreadable images produce a useful error and release their object URL", async () => {
  fallback = decodeError = true;
  await assert.rejects(resizeProfilePhoto(file), /could not be read/);
  assert.deepEqual(revoked, ["blob:profile-preview"]);
});
test("silent PNG encoding fallback is detected before contacting the server", async () => {
  blob = new Blob(["PNG"], { type: "image/png" });
  await assert.rejects(resizeProfilePhoto(file), /cannot save WebP/);
  assert.equal(bitmapClosed, 1);
});
test("oversized encoded photos are rejected before the server action body limit", async () => {
  blob = new Blob([new Uint8Array(PROFILE_AVATAR_MAX_BYTES + 1)], { type: "image/webp" });
  await assert.rejects(resizeProfilePhoto(file), /too large after resizing/);
  assert.equal(bitmapClosed, 1);
});
test("canvas errors release bitmap resources", async () => {
  contextAvailable = false;
  await assert.rejects(resizeProfilePhoto(file), /could not process/);
  assert.equal(bitmapClosed, 1);
});
