import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("local development refuses to start without a real Supabase server key", async () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const check = readFileSync(new URL("../scripts/check-local-env.mjs", import.meta.url), "utf8");

  assert.equal(packageJson.scripts.predev, "node scripts/check-local-env.mjs");
  assert.match(check, /localSupabaseConfig\(process\.env\)/);
  assert.match(check, /checkLocalSupabase\(config\)/);
  assert.match(check, /process\.exit\(1\)/);
  const { localSupabaseConfig } = await import(new URL("../scripts/local-supabase-check.mjs", import.meta.url).href) as {
    localSupabaseConfig: (environment: Record<string, string>) => { errors: string[] };
  };
  const environment = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
  for (const invalid of ["", "[SENSITIVE]", "sb_publishable_wrong_role"]) {
    const config = localSupabaseConfig({ ...environment, SUPABASE_SECRET_KEY: invalid });
    assert.ok(config.errors.some(error => error.includes("SUPABASE_SECRET_KEY")), "Reject missing, redacted and public server keys");
  }
  assert.equal(localSupabaseConfig({ ...environment, SUPABASE_SECRET_KEY: "sb_secret_test" }).errors.length, 0);
  assert.equal(localSupabaseConfig({ ...environment, SUPABASE_SERVICE_ROLE_KEY: "legacy.service.key" }).errors.length, 0);
});

test("workspace authorization reports server lookup failures instead of denying membership", () => {
  const auth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");

  assert.match(auth, /Supabase server authentication is not configured/);
  assert.match(auth, /Workspace membership lookup failed/);
  assert.doesNotMatch(auth, /if \(error \|\| !data\?\.activated_at\) return null/);
});
