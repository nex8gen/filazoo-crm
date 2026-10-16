import test from "node:test";
import assert from "node:assert/strict";

import {
  buildShopifySignature,
  hasShopifyLeadTag,
  normalizeShopifyFormLead,
  normalizeShopifyCustomer,
  verifyShopifySignature,
} from "../lib/shopify-leads.ts";

test("verifies Shopify webhook HMAC signatures", () => {
  const body = JSON.stringify({ id: 123, email: "buyer@example.com" });
  const signature = buildShopifySignature("shopify-secret", body);
  assert.equal(verifyShopifySignature("shopify-secret", body, signature), true);
  assert.equal(verifyShopifySignature("wrong-secret", body, signature), false);
  assert.equal(verifyShopifySignature("shopify-secret", `${body} `, signature), false);
});

test("normalizes a Shopify B2B customer into a CRM lead", () => {
  const lead = normalizeShopifyCustomer({
    id: 7654321,
    email: "buyer@acme3d.com",
    first_name: "Ada",
    last_name: "Lovelace",
    phone: "+44 20 0000 0000",
    tags: "newsletter, B2B-Lead",
    note: "Website: acme3d.com\nJob title: Purchasing manager",
    accepts_marketing: true,
    created_at: "2026-10-16T09:00:00Z",
    default_address: { company: "Acme 3D", city: "London", country: "United Kingdom" },
  });

  assert.ok(lead);
  assert.equal(lead.customerId, "7654321");
  assert.equal(lead.name, "Ada Lovelace");
  assert.equal(lead.companyName, "Acme 3D");
  assert.equal(lead.website, "https://acme3d.com/");
  assert.equal(lead.domain, "acme3d.com");
  assert.equal(lead.role, "Purchasing manager");
  assert.equal(lead.acceptsMarketing, true);
  assert.deepEqual(lead.tags, ["newsletter", "B2B-Lead"]);
});

test("uses a safe fallback company for leads with personal email", () => {
  const lead = normalizeShopifyCustomer({ id: "9", email: "person@gmail.com", first_name: "Lin", tags: ["b2b-lead"] });
  assert.ok(lead);
  assert.equal(lead.companyName, "Lin (Shopify lead)");
  assert.equal(lead.domain, null);
});

test("matches the dedicated B2B form tag case-insensitively", () => {
  assert.equal(hasShopifyLeadTag(["Newsletter", "B2B-Lead"], "b2b-lead"), true);
  assert.equal(hasShopifyLeadTag(["Newsletter"], "b2b-lead"), false);
});

test("normalizes the live Shopify contact form fields", () => {
  const formData = new FormData();
  formData.set("submission_id", "89c65551-4a19-4d17-938f-9eb3537831ca");
  formData.set("contact[Name]", "Grace Hopper");
  formData.set("contact[email]", "buyer@example3d.com");
  formData.set("contact[Company]", "Example 3D");
  formData.set("contact[Estimated monthly volume]", "200–499 kg");
  formData.set("contact[Business type]", "Print farm / production bureau");
  formData.set("contact[Website]", "https://example3d.com");
  formData.set("contact[Material — PETG]", "Yes");
  formData.set("contact[Wants a sample kit]", "Yes");

  const lead = normalizeShopifyFormLead(formData);
  assert.ok(lead);
  assert.equal(lead.customerId, "form:89c65551-4a19-4d17-938f-9eb3537831ca");
  assert.equal(lead.companyName, "Example 3D");
  assert.equal(lead.domain, "example3d.com");
  assert.equal(lead.details.estimatedMonthlyVolume, "200–499 kg");
  assert.deepEqual(lead.details.materials, ["PETG"]);
  assert.deepEqual(lead.details.extras, ["Sample kit"]);
});
