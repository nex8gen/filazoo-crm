import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { preferredStartPage } from "../lib/user-preferences.ts";

function fixture(membershipError: unknown, membership: unknown = null, signInError: unknown = null, preferences: unknown = null, next = "/") {
  let signOuts = 0;
  const logs: unknown[][] = [];
  const exports: { login?: (state: undefined, form: FormData) => Promise<{ error: string }> } = {};
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: membership, error: membershipError }) };
  const dependencies = {
    zod: { z },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "@/lib/safe-redirect": { safeInternalPath: (path: string) => path },
    "@/lib/user-preferences": { preferredStartPage },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      signInWithPassword: async () => ({ data: { user: { id: "fixture", user_metadata: { crm_preferences: preferences } } }, error: signInError }),
      signOut: async () => { signOuts++; },
    } }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => query }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/login/actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: keyof typeof dependencies) => dependencies[name], console: { error: (...args: unknown[]) => logs.push(args) } });
  const form = new FormData(); form.set("email", "staff@example.test"); form.set("password", "private-password-fixture");
  form.set("next", next);
  return { run: () => exports.login!(undefined, form), signOuts: () => signOuts, logs };
}

test("workspace membership is resolved after login and does not revoke a valid session", async () => {
  const f = fixture({ code: "PGRST000", message: "private provider response" });
  await assert.rejects(f.run(), /redirect:\//);
  assert.equal(f.signOuts(), 0);
  assert.equal(f.logs.length, 0);
  assert.ok(!JSON.stringify(f.logs).includes("private provider response"));
});

test("sign-in uses a validated start page and preserves explicit record links", async () => {
  for (const page of ["/", "/analytics", "/companies", "/email"]) {
    await assert.rejects(fixture(null, null, null, { startPage: page }).run(), new RegExp(`redirect:${page}$`));
  }
  for (const page of ["https://example.com", "//example.com", "/settings/team", "/my-day", "constructor"]) {
    await assert.rejects(fixture(null, null, null, { startPage: page }).run(), /redirect:\/$/);
  }
  await assert.rejects(fixture(null, null, null, { startPage: "/email" }, "/companies/record?tab=email").run(), /redirect:\/companies\/record\?tab=email$/);
});

test("a signed-in user without membership keeps their session for workspace onboarding", async () => {
  const f = fixture(null);
  await assert.rejects(f.run(), /redirect:\//);
  assert.equal(f.signOuts(), 0);
});

test("successful sign-in redirects and leaves workspace authorization to the destination", async () => {
  const f = fixture(null, { role: "admin", activated_at: "2026-01-01" });
  await assert.rejects(f.run(), /redirect:\//);
  assert.equal(f.signOuts(), 0);
});

test("authentication logs contain status and code without credentials or raw errors", async () => {
  const f = fixture(null, null, { status: 503, code: "unexpected_failure", message: "private-password-fixture" });
  assert.match((await f.run()).error, /temporarily unavailable/);
  const log = JSON.stringify(f.logs);
  assert.ok(log.includes("503") && log.includes("unexpected_failure"));
  assert.ok(!log.includes("private-password-fixture") && !log.includes("staff@example.test"));
});
