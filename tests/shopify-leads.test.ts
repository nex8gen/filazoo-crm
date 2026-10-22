import test from "node:test";
import assert from "node:assert/strict";

import {
  buildShopifySignature,
  estimatedOrderQuantity,
  getShopifyLeadLocation,
  hasShopifyLeadTag,
  normalizeShopifyFormLead,
  normalizeShopifyCustomer,
  verifyShopifySignature,
} from "../lib/shopify-leads.ts";
import { buildShopifyFormInboxItems } from "../lib/email-inbox.ts";

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

test("uses request IP geography when the Shopify form country is blank", () => {
  const formData = new FormData();
  formData.set("submission_id", "89c65551-4a19-4d17-938f-9eb3537831ca");
  formData.set("contact[Name]", "Grace Hopper");
  formData.set("contact[email]", "buyer@example3d.com");
  formData.set("contact[Company]", "Example 3D");
  const headers = new Headers({
    "x-vercel-ip-country": "US",
    "x-vercel-ip-city": "New%20York",
    "x-forwarded-for": "203.0.113.10, 10.0.0.1",
  });

  const lead = normalizeShopifyFormLead(formData, headers);
  assert.ok(lead);
  assert.equal(lead.country, "United States");
  assert.equal(lead.city, "New York");
  assert.deepEqual(lead.rawPayload._crm_location, {
    source: "ip",
    ipAddress: "203.0.113.10",
    country: "United States",
    city: "New York",
  });
});

test("prefers a submitted country and parses estimated monthly volume", () => {
  const location = getShopifyLeadLocation(new Headers({ "x-vercel-ip-country": "CA" }), "US", null);
  assert.equal(location.country, "United States");
  assert.equal(location.source, "form");
  assert.equal(estimatedOrderQuantity("Under 50 kg"), 50);
  assert.equal(estimatedOrderQuantity("200-499 kg"), 200);
  assert.equal(estimatedOrderQuantity(null), null);
});

test("turns Shopify form submissions into replyable inbox conversations", () => {
  const [message] = buildShopifyFormInboxItems([{
    webhook_id: "form:abc-123",
    customer_id: "form:abc-123",
    email: "buyer@example3d.com",
    full_name: "Grace Hopper",
    company_name: "Example 3D",
    phone: null,
    tags: ["b2b-lead"],
    raw_payload: {
      "contact[body]": "Please send wholesale pricing.",
      "contact[Estimated monthly volume]": "200-499 kg",
    },
    created_at: "2026-10-21T08:00:00Z",
  }]);

  assert.equal(message.source, "shopify");
  assert.equal(message.contact, "buyer@example3d.com");
  assert.equal(message.contactName, "Grace Hopper");
  assert.match(message.body, /wholesale pricing/);
  assert.match(message.body, /200-499 kg/);
});

test("turns tagged Shopify customer webhooks into inbox leads too", () => {
  const [message] = buildShopifyFormInboxItems([{
    webhook_id: "webhook-123",
    customer_id: "7654321",
    email: "buyer@acme3d.com",
    full_name: "Ada Lovelace",
    company_name: "Acme 3D",
    phone: "+44 20 0000 0000",
    tags: ["newsletter", "B2B-Lead"],
    raw_payload: {},
    created_at: "2026-10-21T08:00:00Z",
  }]);

  assert.equal(message.source, "shopify");
  assert.equal(message.status, "Shopify lead");
  assert.match(message.subject, /Shopify lead/);
  assert.match(message.body, /B2B-Lead/);
});
