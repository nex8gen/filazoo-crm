import assert from "node:assert/strict";
import test from "node:test";
import { resolveMemberAvatars } from "../lib/data/member-avatars.ts";
import { AVATAR_PRESETS } from "../lib/profile-avatar.ts";

test("member avatars use saved photos, presets and the same default as the account menu", async () => {
  const calls: string[] = [];
  const signed: string[] = [];
  const filename = "12345678-1111-2222-3333-444444444444.webp";
  const metadata: Record<string, Record<string, string>> = {
    photo: { avatar_path: `photo/${filename}`, avatar_preset: "female" },
    preset: { avatar_preset: "glasses" },
    legacy: {},
    foreign: { avatar_path: `photo/${filename}`, avatar_preset: "curly" },
    storageFailure: { avatar_path: `storageFailure/${filename}`, avatar_preset: "lavender" },
  };
  const admin = {
    auth: { admin: { getUserById: async (id: string) => {
      calls.push(id);
      if (id === "networkFailure") throw new Error("Auth unavailable");
      return { data: { user: metadata[id] ? { user_metadata: metadata[id] } : null }, error: null };
    } } },
    storage: { from: (bucket: string) => {
      assert.equal(bucket, "profile-avatars");
      return { createSignedUrl: async (path: string, expires: number) => {
        signed.push(path);
        assert.equal(expires, 3600);
        if (path.startsWith("storageFailure/")) throw new Error("Storage unavailable");
        return { data: { signedUrl: "https://storage.example/private-photo" } };
      } };
    } },
  } as unknown as Parameters<typeof resolveMemberAvatars>[0];
  const avatars = await resolveMemberAvatars(admin, [...Object.keys(metadata), "photo", "", "missing", "networkFailure"]);
  assert.equal(avatars.get("photo"), "https://storage.example/private-photo");
  assert.equal(avatars.get("preset"), "/avatars/round-glasses.webp");
  assert.equal(avatars.get("legacy"), AVATAR_PRESETS[0].image);
  assert.equal(avatars.get("foreign"), "/avatars/black-curls.webp");
  assert.equal(avatars.get("storageFailure"), "/avatars/lavender.webp");
  assert.equal(avatars.has("missing"), false);
  assert.equal(avatars.has("networkFailure"), false);
  assert.equal(calls.filter((id) => id === "photo").length, 1);
  assert.deepEqual(signed.sort(), [`photo/${filename}`, `storageFailure/${filename}`]);
});
