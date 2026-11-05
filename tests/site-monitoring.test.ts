import assert from "node:assert/strict";
import test from "node:test";
import { monitoringUrl } from "../lib/monitoring-url.ts";

test("telemetry removes auth tokens, CRM searches, fragments and customer keys", () => {
  const safe = new URL(monitoringUrl("https://crm.example.com/customer/private-invoice-key/invoice?key=secret&email=buyer%40example.com#access_token=token"));
  assert.equal(safe.search, "");
  assert.equal(safe.hash, "");
  assert.equal(decodeURI(safe.pathname), "/customer/[redacted]/invoice");
  assert.equal(decodeURI(new URL(monitoringUrl("https://crm.example.com/companies/12345678-abcd-4321-abcd-123456789abc?q=customer")).pathname), "/companies/[id]");
});
