import test from "node:test";
import assert from "node:assert/strict";
import { bridgeLeadRow, bridgeLeadSchema, getBridgeSecret, verifyBridgeAuthorization } from "../lib/meta-lead-bridge.ts";

test("bridge credential is stable, separated from the database key, and independently rotatable", () => {
  const credential = getBridgeSecret("database-key");
  assert.equal(credential?.length, 64);
  assert.notEqual(credential, "database-key");
  assert.equal(credential, getBridgeSecret("database-key"));
  assert.notEqual(credential, getBridgeSecret("different-database-key"));
  assert.equal(getBridgeSecret(undefined), undefined);
  assert.equal(getBridgeSecret("database-key", "too-short"), undefined);
  assert.equal(getBridgeSecret("database-key", "a".repeat(32)), "a".repeat(32));
});

test("bridge rejects missing, short, malformed, and incorrect credentials", () => {
  const secret = "a-secure-connection-secret-with-32-plus-characters";
  assert.equal(verifyBridgeAuthorization(`Bearer ${secret}`, secret), true);
  for (const header of [null, secret, `bearer ${secret}`, "Bearer incorrect", `Bearer ${secret} `]) {
    assert.equal(verifyBridgeAuthorization(header, secret), false);
  }
  assert.equal(verifyBridgeAuthorization("Bearer short", "short"), false);
  assert.equal(verifyBridgeAuthorization(`Bearer ${secret}`, undefined), false);
});

test("bridge preserves large Meta IDs and maps custom form answers", () => {
  const lead = bridgeLeadSchema.parse({
    lead_id: "12345678901234567890", page_id: "98765432109876543210",
    field_data: [
      { name: "first_name", values: ["Ada"] }, { name: "last_name", values: ["Lovelace"] },
      { name: "email", values: ["ada@example.com"] }, { name: "phone_number", values: ["+44 1234"] },
      { name: "company_name", values: ["Example"] },
    ],
  });
  const row = bridgeLeadRow(lead);
  assert.equal(row.leadgen_id, "12345678901234567890");
  assert.equal(row.full_name, "Ada Lovelace");
  assert.equal(row.email, "ada@example.com");
  assert.equal(row.phone, "+44 1234");
  assert.equal(row.field_data[4].values[0], "Example");
  assert.equal("created_at" in row, false);
});

test("bridge refuses placeholders, lossy numeric IDs, invalid timestamps, and empty lead notifications", () => {
  const valid = { lead_id: "123", page_id: "456", email: "lead@example.com" };
  for (const input of [
    { ...valid, lead_id: 12345678901234567890 }, { ...valid, lead_id: "MAP_META_LEAD_ID" },
    { ...valid, created_time: "yesterday" }, { ...valid, email: "invalid" },
    { lead_id: "123", page_id: "456" },
  ]) assert.equal(bridgeLeadSchema.safeParse(input).success, false);
  assert.equal(bridgeLeadSchema.safeParse({ ...valid, created_time: "2026-10-22T10:00:00+08:00" }).success, true);
});

test("bridge retains company and buying details for company creation", () => {
  const row = bridgeLeadRow(bridgeLeadSchema.parse({lead_id:"123",page_id:"456",email:"buyer@example.com",company_name:"Buyer Inc",website:"buyer.example.com",expected_order_quantity:"50–100 kg",field_data:[{name:"company_name",values:["Old name"]}]}));
  assert.deepEqual(row.field_data.find((field) => field.name === "company_name")?.values, ["Buyer Inc"]);
  assert.deepEqual(row.field_data.find((field) => field.name === "expected_order_quantity")?.values, ["50–100 kg"]);
  assert.equal(row.field_data.filter((field) => field.name === "company_name").length, 1);
});

test("bridge accepts Make's actual mappable field data without losing answers", () => {
  const row = bridgeLeadRow(bridgeLeadSchema.parse({lead_id:"123",page_id:"456",field_data:[{name:"email",value:"buyer@example.com"},{name:"full_name",value:'Buyer "Example"'},{name:"company_name",value:"Buyer Inc"}]}));
  assert.equal(row.email,"buyer@example.com");
  assert.equal(row.full_name,'Buyer "Example"');
  assert.deepEqual(row.field_data[2],{name:"company_name",values:["Buyer Inc"]});
});
