import assert from "node:assert/strict";
import test from "node:test";
import { isWebp, ownAvatarPath, profileAvatarUrl } from "../lib/profile-avatar.ts";

const userId = "c0c0c0c0-1111-2222-3333-444444444444";
const filename = "12345678-1111-2222-3333-444444444444.webp";

test("avatar access is restricted to the viewer's own image", () => {
  assert.equal(ownAvatarPath(userId, `${userId}/${filename}`), `${userId}/${filename}`);
  for (const path of [null, "", `another-user/${filename}`, `${userId}/../${filename}`, `${userId}/nested/${filename}`, `${userId}/${filename}?other=user`, `${userId}/photo.svg`, "https://example.com/photo.webp"]) {
    assert.equal(ownAvatarPath(userId, path), null);
    assert.equal(profileAvatarUrl(userId, path), undefined);
  }
  assert.equal(profileAvatarUrl(userId, `${userId}/${filename}`), `/api/profile/avatar?v=${filename}`);
});

test("uploads must contain WebP bytes rather than only a claimed MIME type", () => {
  assert.equal(isWebp(new TextEncoder().encode("RIFF1234WEBPpayload")), true);
  assert.equal(isWebp(new TextEncoder().encode("<svg>image</svg>")), false);
  assert.equal(isWebp(new TextEncoder().encode("RIFF")), false);
  assert.equal(isWebp(new TextEncoder().encode("RIFF1234WAVEpayload")), false);
});
