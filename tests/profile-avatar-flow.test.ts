import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const userId = "c0c0c0c0-1111-2222-3333-444444444444";
const oldPath = `${userId}/12345678-1111-2222-3333-444444444444.webp`;
const state = {
  viewer: { id: userId, avatarPath: oldPath },
  user: { id: userId, email: "member@example.com", user_metadata: { avatar_path: oldPath, avatar_preset: "female" } },
  saved: null as unknown,
  uploads: [] as string[],
  removed: [] as string[],
  revalidated: [] as unknown[],
  failSave: false,
  throwSave: false,
  failCleanup: false,
  failUpload: false,
  bucketMissing: false,
  bucketsCreated: 0,
  authenticated: true,
};
const storage = {
  upload: async (path: string) => { state.uploads.push(path); return { error: state.failUpload ? new Error("upload failed") : null }; },
  remove: async (paths: string[]) => { state.removed.push(...paths); if (state.failCleanup) throw new Error("cleanup failed"); return { error: null }; },
  download: async (path: string) => ({ data: new Blob([path], { type: "image/webp" }), error: null }),
};
const client = { auth: {
  getUser: async () => ({ data: { user: state.authenticated ? state.user : null }, error: null }),
  // Stale claims must never be used to resolve the current avatar.
  getClaims: async () => { throw new Error("stale claims accessed"); },
  refreshSession: async () => { throw new Error("unnecessary token rotation"); },
  updateUser: async (attributes: unknown) => {
    if (state.throwSave) throw new Error("network failed");
    if (state.failSave) return { error: new Error("save failed") };
    state.saved = attributes;
    return { error: null };
  },
} };
const admin = { storage: {
  from: () => storage,
  getBucket: async () => ({ data: state.bucketMissing ? null : {}, error: state.bucketMissing ? { statusCode: "404" } : null }),
  createBucket: async () => { state.bucketsCreated++; return { error: null }; },
} };
// Exercise the actual action, reader, and route with deterministic Auth/Storage
// responses, without modifying a real workspace member's profile.
const runtimeKey = "__profileAvatarTestRuntime";
Object.assign(globalThis, { [runtimeKey]: { state, client, admin } });
const runtime = `const {state, client, admin} = globalThis.${runtimeKey};`;
const mocks: Record<string, string> = {
  "@/lib/auth": `${runtime} export async function requireWorkspaceMember() { return state.viewer; } export async function getWorkspaceViewer() { return state.authenticated ? state.viewer : null; }`,
  "@/lib/supabase/server": `${runtime} export async function createClient() { return client; }`,
  "@/lib/supabase/admin": `${runtime} export function createSupabaseAdmin() { return admin; }`,
  "next/cache": `${runtime} export function revalidatePath(...args) { state.revalidated.push(args); }`,
  "next/server": "export async function connection() {}",
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    let source = mocks[specifier];
    if (context.parentURL?.endsWith("/lib/auth.ts")) {
      if (specifier === "./supabase/server.ts") source = mocks["@/lib/supabase/server"];
      if (specifier === "./supabase/admin.ts") source = mocks["@/lib/supabase/admin"];
      if (specifier === "./env.ts") source = "export const hasSupabaseAuthConfig = () => true; export const hasSupabaseConfig = () => true;";
    }
    if (source) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    if (specifier === "@/lib/profile-avatar") return { url: new URL("../lib/profile-avatar.ts", import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { saveProfileAvatar } = await import("../app/settings/profile-actions.ts");
const { getViewer } = await import("../lib/auth.ts");
const { GET } = await import("../app/api/profile/avatar/route.ts");
test.after(() => { hooks.deregister(); Reflect.deleteProperty(globalThis, runtimeKey); });
test.beforeEach(() => {
  state.saved = null;
  state.uploads = [];
  state.removed = [];
  state.revalidated = [];
  state.failSave = state.throwSave = state.failCleanup = state.failUpload = state.bucketMissing = false;
  state.bucketsCreated = 0;
  state.authenticated = true;
});
function form(upload = false) {
  const data = new FormData();
  data.set("preset", "glasses");
  data.set("removePhoto", "true");
  if (upload) data.set("photo", new Blob(["RIFF1234WEBPpayload"], { type: "image/webp" }), "avatar.webp");
  return data;
}

test("profile readers use fresh Auth metadata without requiring token rotation", async () => {
  const viewer = await getViewer();
  assert.deepEqual(viewer, { id: userId, email: "member@example.com", avatarPath: oldPath, avatarPreset: "female", preferences: { tablePageSize: 25, density: "comfortable", reduceMotion: false, emailTranslate: true, emailMarkRead: true, emailSyncSeconds: 15, emailAiSuggestions: true, emailSignature: "" } });
});
test("preset selection removes the photo and refreshes every avatar surface", async () => {
  assert.ok((await saveProfileAvatar(form())).success);
  assert.deepEqual(state.saved, { data: { avatar_path: null, avatar_preset: "glasses" } });
  assert.deepEqual(state.removed, [oldPath]);
  assert.deepEqual(state.revalidated, [["/", "layout"]]);
});
test("photo replacement stores a unique version before deleting the old image", async () => {
  assert.ok((await saveProfileAvatar(form(true))).success);
  assert.equal(state.uploads.length, 1);
  assert.notEqual(state.uploads[0], oldPath);
  assert.deepEqual(state.saved, { data: { avatar_path: state.uploads[0], avatar_preset: "glasses" } });
  assert.deepEqual(state.removed, [oldPath]);
});
test("the first upload prepares private photo storage", async () => {
  state.bucketMissing = true;
  assert.ok((await saveProfileAvatar(form(true))).success);
  assert.equal(state.bucketsCreated, 1);
});
for (const failure of ["failSave", "throwSave"] as const) {
  test(`${failure}: a failed metadata update removes only the new upload`, async () => {
    state[failure] = true;
    assert.ok((await saveProfileAvatar(form(true))).error);
    assert.deepEqual(state.removed, state.uploads);
    assert.ok(!state.removed.includes(oldPath));
    assert.deepEqual(state.revalidated, []);
  });
}
test("cleanup failure cannot turn a committed avatar update into a save error", async () => {
  state.failCleanup = true;
  assert.ok((await saveProfileAvatar(form(true))).success);
  assert.deepEqual(state.revalidated, [["/", "layout"]]);
});
test("upload failure preserves the previous profile and image", async () => {
  state.failUpload = true;
  assert.ok((await saveProfileAvatar(form(true))).error);
  assert.equal(state.saved, null);
  assert.deepEqual(state.removed, []);
});
test("avatar delivery is authenticated and never cached", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await response.text(), oldPath);
  state.authenticated = false;
  assert.equal((await GET()).status, 401);
});
