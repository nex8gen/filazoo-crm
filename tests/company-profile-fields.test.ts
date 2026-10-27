import test from "node:test";
import assert from "node:assert/strict";
import { companyProfileChangesSchema, countryFromAddress, deriveCompanyAddressFields } from "../lib/company-profile-fields.ts";
import { workspaceActionSchema, workspaceAssistantInstruction } from "../lib/ai/workspace-assistant.ts";

export const profileExamples = {
  name: "Updated company", website: "https://example.invalid", country: "United States", city: "Tarrytown", segment: "Manufacturing",
  contactName: "Jimmy Przybylinski", contactRole: "Purchasing", contactEmail: "buyer@example.invalid", stage: "interested", summary: "Customer account notes",
  tags: "PLA, PETG", fitScore: 8, estimatedOrderQuantity: 200, estimatedValue: 1234.56, currency: "CAD", nextFollowupAt: "2026-10-29T09:00:00+08:00",
  commerce: { phone: "+1 555 0100", shippingRecipient: "Jimmy Przybylinski", shippingPhone: "+1 555 0101", shippingAddress: "1 Dixon Ln, Tarrytown, NY 10591, United States", shippingNotes: "Deliver weekdays", address: "Billing office", taxId: "VAT-42", email: "billing@example.invalid", currency: "USD", termsDays: 30 },
} as const;

test("every existing editable profile field validates independently without requiring other fields", () => {
  for (const [field, value] of Object.entries(profileExamples)) {
    if (field === "commerce") {
      for (const [key, text] of Object.entries(value)) assert.deepEqual(companyProfileChangesSchema.parse({ commerce: { [key]: text } }), { commerce: { [key]: text } });
    } else assert.deepEqual(companyProfileChangesSchema.parse({ [field]: value }), { [field]: value });
  }
  for (const key of ["fitScore", "estimatedOrderQuantity", "estimatedValue", "nextFollowupAt"]) assert.deepEqual(companyProfileChangesSchema.parse({ [key]: "" }), { [key]: "" });
});

test("patch validation rejects unsupported fields, empty patches and invalid supplied values", () => {
  for (const patch of [{}, { commerce: {} }, { commerce: { phone: undefined } }, { owner_id: "forged" }, { name: "" }, { country: "X" }, { fitScore: 11 }, { estimatedOrderQuantity: 2.5 }, { nextFollowupAt: "tomorrow" }, { commerce: { email: "invalid" } }, { commerce: { termsDays: -1 } }, { commerce: { arbitrary: "new field" } }]) assert.equal(companyProfileChangesSchema.safeParse(patch).success, false);
});

test("explicit country suffixes normalize safely; state codes and postal codes do not imply a country", () => {
  for (const [address, expected] of [
    ["1 Dixon Ln, Tarrytown, NY 10591, United States", "United States"],
    ["1 Dixon Ln, Tarrytown, NY 10591, USA", "United States"],
    ["1 Dixon Ln, Tarrytown, NY 10591, U.S.A.", "United States"],
    ["1 Dixon Ln, Tarrytown, NY 10591, US", "United States"],
    ["10 Example Road\nLondon SW1A 1AA\nUK", "United Kingdom"],
    ["Example building, Shanghai 200000, China", "China"],
    ["10 Example St, Toronto, Canada", "Canada"],
    ["10 Example St, Sydney, Australia", "Australia"],
    ["1 Dixon Ln, Tarrytown, NY 10591", null],
    ["100 Example St, San Francisco, CA", null],
    ["Atlanta, Georgia", null],
    ["", null],
  ] as const) assert.equal(countryFromAddress(address), expected, address);
});

test("derivation fills an empty country and preserves explicit or conflicting saved values", () => {
  const patch = { commerce: { shippingAddress: profileExamples.commerce.shippingAddress } };
  assert.equal(deriveCompanyAddressFields(patch, { country: "" }).country, "United States");
  assert.equal(deriveCompanyAddressFields(patch, { country: "Canada" }).country, undefined);
  assert.equal(deriveCompanyAddressFields({ ...patch, country: "Japan" }, { country: "" }).country, "Japan");
  const action = workspaceActionSchema.parse({ type: "update_company", companyId: "a1111111-1111-4111-8111-111111111111", deriveAddressFields: true, changes: patch });
  assert.equal(action.type, "update_company");
  const instruction = workspaceAssistantInstruction("work", "2026-10-27T00:00:00Z");
  assert.match(instruction, /deriveAddressFields:true/);
  assert.match(instruction, /shipping-only/);
});
