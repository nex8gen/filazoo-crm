import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("local development refuses to start without a real Supabase server key", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const check = readFileSync(new URL("../scripts/check-local-env.mjs", import.meta.url), "utf8");

  assert.equal(packageJson.scripts.predev, "node scripts/check-local-env.mjs");
  assert.match(check, /SUPABASE_SECRET_KEY/);
  assert.match(check, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(check, /\[SENSITIVE\]/);
  assert.match(check, /process\.exit\(1\)/);
});

test("workspace authorization reports server lookup failures instead of denying membership", () => {
  const auth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");

  assert.match(auth, /Supabase server authentication is not configured/);
  assert.match(auth, /Workspace membership lookup failed/);
  assert.doesNotMatch(auth, /if \(error \|\| !data\?\.activated_at\) return null/);
});
