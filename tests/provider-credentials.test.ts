import test from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { hasAiProvider, resolveGatewayToken } from "../lib/ai/provider-credentials.ts";

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
    assert.equal(hasAiProvider({ GEMINI_API_KEY: "direct-key" }), true);
  } finally {
    if (previous === undefined) delete globals[symbol];
    else globals[symbol] = previous;
  }
});
