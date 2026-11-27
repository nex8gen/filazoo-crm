import test from "node:test";
import assert from "node:assert/strict";
import { assistantFailureDiagnostic, assistantProviderError } from "../lib/ai/assistant-provider-error.ts";

test("planning failure diagnostics retain type/status/frames and omit raw provider bodies and credentials", () => {
  const error = Object.assign(new Error("Provider rejected secret-token and PRIVATE CUSTOMER CONTENT"), {
    name: "APICallError", statusCode: 400, responseBody: "PRIVATE CUSTOMER CONTENT", requestBodyValues: { apiKey: "secret-token" },
  });
  const diagnostic = assistantFailureDiagnostic(error);
  assert.equal(diagnostic.name, "APICallError");
  assert.equal(diagnostic.status, 400);
  assert.match(diagnostic.stack ?? "", /at /);
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret-token|PRIVATE CUSTOMER CONTENT|responseBody|requestBodyValues/);
});

test("timeout and provider-authentication failures keep an actionable public reason", () => {
  assert.match(assistantProviderError(Object.assign(new Error("request timeout"), { name: "TimeoutError" })), /took too long/);
  assert.match(assistantProviderError(new Error("authentication failed")), /authentication failed/);
});
