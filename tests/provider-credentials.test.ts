import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { hasAiProvider, resolveGatewayToken } from "../lib/ai/provider-credentials.ts";

test("an expired local OIDC token does not report AI as configured", () => {
  const token = (expiry: number) => `header.${Buffer.from(JSON.stringify({ exp: expiry })).toString("base64url")}.signature`;
  assert.equal(hasAiProvider({ VERCEL_OIDC_TOKEN: token(Math.floor(Date.now() / 1000) - 60) }), false);
  assert.equal(hasAiProvider({ VERCEL_OIDC_TOKEN: token(Math.floor(Date.now() / 1000) + 3600) }), true);
});

test("Gateway resolves Vercel's request identity without a static production key", async () => {
  const symbol = Symbol.for("@vercel/request-context");
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const previous = globals[symbol];
  const requests = new AsyncLocalStorage<{ headers: Record<string, string> }>();
  globals[symbol] = { get: () => requests.getStore() };
  try {
    const env = { AI_PROVIDER: "gateway", AI_BUDGET_ENFORCEMENT: "true" };
    assert.deepEqual(await Promise.all(["request-one", "request-two"].map(token =>
      requests.run({ headers: { "x-vercel-oidc-token": token } }, async () => {
        await Promise.resolve();
        assert.equal(hasAiProvider(env), true);
        assert.equal(resolveGatewayToken({ ...env, VERCEL_OIDC_TOKEN: "old-local-token" }), token);
        return resolveGatewayToken(env);
      }))), ["request-one", "request-two"]);
    assert.equal(resolveGatewayToken({ AI_GATEWAY_API_KEY: " explicit-key " }), "explicit-key");
    assert.equal(resolveGatewayToken({ VERCEL_OIDC_TOKEN: " local-token " }), "local-token");
    assert.equal(resolveGatewayToken({}), undefined);
    assert.equal(hasAiProvider({ ...env, GEMINI_API_KEY: "direct-key" }), false);
    assert.equal(hasAiProvider({ GEMINI_API_KEY: "direct-key" }), false);
  } finally {
    if (previous === undefined) delete globals[symbol];
    else globals[symbol] = previous;
  }
});

test("async resolution preserves explicit keys and request-scoped production identity", async () => {
  const { resolveGatewayTokenAsync } = await import("../lib/ai/provider-credentials.ts");
  assert.equal(await resolveGatewayTokenAsync({ AI_GATEWAY_API_KEY: " explicit-key " }), "explicit-key");
  assert.equal(await resolveGatewayTokenAsync({}), undefined);
});

test("concurrent expired development identities share one SDK refresh and production never uses CLI credentials", async () => {
  const { readFileSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const { default: vm } = await import("node:vm");
  const jwt = (offset: number) => `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offset })).toString("base64url")}.signature`;
  const environment = { NODE_ENV: "development", VERCEL_PROJECT_ID: "project", VERCEL_ORG_ID: "team", VERCEL_OIDC_TOKEN: jwt(-60) };
  const refreshed = jwt(3600);
  let refreshes = 0;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/ai/provider-credentials.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Buffer, Date, process: { env: environment },
    require: (name: string) => { assert.equal(name, "@vercel/oidc"); return { getVercelOidcTokenSync: () => environment.VERCEL_OIDC_TOKEN, getVercelOidcToken: async (options: { project: string; team: string }) => {
      refreshes++; assert.equal(options.project, "project"); assert.equal(options.team, "team"); await Promise.resolve(); environment.VERCEL_OIDC_TOKEN = refreshed; return refreshed;
    } }; },
  });
  const resolve = exports.resolveGatewayTokenAsync as () => Promise<string>;
  assert.deepEqual(await Promise.all([resolve(), resolve()]), [refreshed, refreshed]);
  assert.equal(refreshes, 1);
  environment.NODE_ENV = "production";
  environment.VERCEL_OIDC_TOKEN = jwt(-60);
  await resolve();
  assert.equal(refreshes, 1);
});
