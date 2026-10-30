import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

function fixture(membershipError: unknown, membership: unknown = null, signInError: unknown = null) {
  let signOuts = 0;
  const logs: unknown[][] = [];
  const exports: { login?: (state: undefined, form: FormData) => Promise<{ error: string }> } = {};
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: membership, error: membershipError }) };
  const dependencies = {
    zod: { z },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "@/lib/safe-redirect": { safeInternalPath: () => "/" },
    "@/lib/supabase/server": { createClient: async () => ({ auth: {
      signInWithPassword: async () => ({ data: { user: { id: "fixture" } }, error: signInError }),
      signOut: async () => { signOuts++; },
    } }) },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => query }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/login/actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: keyof typeof dependencies) => dependencies[name], console: { error: (...args: unknown[]) => logs.push(args) } });
  const form = new FormData(); form.set("email", "staff@example.test"); form.set("password", "private-password-fixture");
  return { run: () => exports.login!(undefined, form), signOuts: () => signOuts, logs };
}

test("a temporary membership failure does not revoke the new session or falsely claim the user lacks an invitation", async () => {
  const f = fixture({ code: "PGRST000", message: "private provider response" });
  assert.match((await f.run()).error, /temporarily unavailable/);
  assert.equal(f.signOuts(), 0);
  assert.ok(JSON.stringify(f.logs).includes("PGRST000"));
  assert.ok(!JSON.stringify(f.logs).includes("private provider response"));
});

test("missing membership still signs out the unauthorized user", async () => {
  const f = fixture(null);
  assert.match((await f.run()).error, /not been invited/);
  assert.equal(f.signOuts(), 1);
});

test("successful sign-in redirects only after active membership is verified", async () => {
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
