import assert from "node:assert/strict";
import test from "node:test";
import { checkLocalSupabase, localSupabaseConfig } from "../scripts/local-supabase-check.mjs";

const environment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_public-fixture",
  SUPABASE_SECRET_KEY: "sb_secret_private-fixture",
};

test("local startup rejects missing and redacted Supabase configuration without leaking keys", () => {
  assert.equal(localSupabaseConfig(environment).errors.length, 0);
  for (const name of Object.keys(environment)) {
    const config = localSupabaseConfig({ ...environment, [name]: "[SENSITIVE]" });
    assert.equal(config.errors.length, 1, name);
    assert.ok(!config.errors.join().includes(environment.SUPABASE_SECRET_KEY));
  }
  assert.equal(localSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "header.payload.signature", SUPABASE_SERVICE_ROLE_KEY: "header.payload.signature" }).errors.length, 0);
});

test("startup probes auth and database with their own keys and never retrieves member records", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const errors = await checkLocalSupabase(localSupabaseConfig(environment), async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    assert.ok(init.signal instanceof AbortSignal);
    return new Response("{}", { status: 200 });
  });
  assert.deepEqual(errors, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, environment.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/settings");
  assert.equal((requests[0].init.headers as Record<string, string>).apikey, environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert.equal(requests[1].url, environment.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/workspace_members?select=user_id&limit=0");
  assert.equal((requests[1].init.headers as Record<string, string>).apikey, environment.SUPABASE_SECRET_KEY);
});

test("blocked network access gives actionable startup diagnostics instead of starting a broken CRM", async () => {
  const errors = await checkLocalSupabase(localSupabaseConfig(environment), async () => {
    throw new TypeError("fetch failed " + environment.SUPABASE_SECRET_KEY, { cause: { code: "EACCES" } });
  });
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error: string) => error.includes("terminal with network access")));
  assert.ok(!errors.join().includes(environment.SUPABASE_SECRET_KEY));
});

test("invalid API keys, upstream outages and timeouts fail startup without response body leakage", async () => {
  for (const status of [401, 403, 503]) {
    const errors = await checkLocalSupabase(localSupabaseConfig(environment), async () => new Response(environment.SUPABASE_SECRET_KEY, { status }));
    assert.equal(errors.length, 2);
    assert.ok(errors.every((error: string) => error.includes(`HTTP ${status}`)));
    assert.ok(!errors.join().includes(environment.SUPABASE_SECRET_KEY));
  }
  const errors = await checkLocalSupabase(localSupabaseConfig(environment), async () => { throw new DOMException("timed out", "TimeoutError"); });
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error: string) => error.includes("could not reach Supabase")));
});
