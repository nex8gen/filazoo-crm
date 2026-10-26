// Run against a local app with its configured Supabase database. Uses isolated,
// clearly labelled fixtures, removes them in finally, and sends no emails.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { invoicePortalKey } from "../lib/customer-portal-crypto.ts";
import { blankInvoiceDocument } from "../lib/invoices.ts";
nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const origin = process.env.PORTAL_TEST_ORIGIN || "http://localhost:3000";
const fixturePath = new URL("../tmp/customer-portal-ui.json", import.meta.url);
async function clean(fixture) {
  for (const id of fixture.ids) {
    const result = await db.from("invoices").delete().eq("id", id).eq("document->>customerEmail", fixture.email);
    if (result.error) throw result.error;
  }
  const account = await db.from("customer_portal_accounts").delete().eq("email", fixture.email);
  if (account.error) throw account.error;
}
if (process.argv.includes("--cleanup")) {
  await clean(JSON.parse(await readFile(fixturePath, "utf8")));
  await unlink(fixturePath);
  console.log("Customer portal fixtures removed.");
  process.exit(0);
}
const email = `portal-test-${randomUUID()}@example.test`;
const ids = [randomUUID(), randomUUID()];
const fixture = { email, ids };
let retained = false;
try {
  const document = { ...blankInvoiceDocument("2026-10-26"), customerEmail: email, customerName: "Customer Portal Verification", reference: "PORTAL TEST", sellerName: "Filazoo", items: [{ description: "Portal test product", quantity: 2, unitPriceMinor: 1250, taxBps: 0 }] };
  const created = await db.from("invoices").insert(ids.map((id, i) => ({ id, document, status: i === 0 ? "issued" : "draft", total_minor: 2500 })));
  if (created.error) throw created.error;
  const legacyFixture = await db.from("customer_portal_legacy_links").insert({ invoice_id: ids[0], billing_email: email });
  if (legacyFixture.error) throw legacyFixture.error;
  const key = invoicePortalKey(ids[0], email, process.env.CUSTOMER_PORTAL_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  let cookie = "";
  async function call(path, method = "GET", input, overrideCookie) {
    const response = await fetch(origin + path, { method, redirect: "manual", headers: { Origin: origin, "Content-Type": "application/json", Cookie: overrideCookie ?? cookie }, body: input ? JSON.stringify(input) : undefined });
    const setCookie = response.headers.getSetCookie().find(value => value.startsWith("filazoo_customer_session="));
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  }
  const endpoint = `/api/customer/invoices/${ids[0]}`;
  const oldQr = await call(`/invoices/${ids[0]}`);
  assert.equal(oldQr.status, 307);
  assert.ok(new URL(oldQr.headers.get("location"), origin).pathname.startsWith("/customer/legacy/"));
  const legacy = await call(`/customer/legacy/${ids[0]}`);
  assert.equal(legacy.status, 307);
  assert.equal(new URL(legacy.headers.get("location"), origin).pathname, `/customer/invoices/${ids[0]}`);
  assert.equal(new URL(legacy.headers.get("location"), origin).hash, `#key=${key}`);
  assert.equal((await call(`/customer/legacy/${ids[1]}`)).status, 404);
  assert.equal((await call(endpoint)).status, 401);
  assert.equal((await call("/api/customer/session", "POST", { invoiceId: ids[0], key: "forged" })).status, 403);
  const draftKey = invoicePortalKey(ids[1], email, process.env.CUSTOMER_PORTAL_SECRET || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const draftScan = await call("/api/customer/session", "POST", { invoiceId: ids[1], key: draftKey });
  assert.equal(draftScan.status, 403);
  assert.match((await draftScan.json()).error, /has not been issued yet/);
  const issueDraft = await db.from("invoices").update({ status: "issued" }).eq("id", ids[1]);
  if (issueDraft.error) throw issueDraft.error;
  const activatedScan = await call("/api/customer/session", "POST", { invoiceId: ids[1], key: draftKey });
  assert.equal(activatedScan.status, 200, await activatedScan.clone().text());
  assert.equal((await call(`/api/customer/invoices/${ids[1]}`)).status, 200);
  const scan = await call("/api/customer/session", "POST", { invoiceId: ids[0], key });
  assert.equal(scan.status, 200, await scan.clone().text());
  assert.equal((await scan.json()).requiresLogin, false);
  const guestCookie = cookie;
  const view = await call(endpoint);
  assert.equal(view.status, 200);
  const data = await view.json();
  assert.equal(data.email, email);
  assert.equal(data.needsPassword, true);
  assert.equal(data.invoice.total_minor, 2500);
  assert.equal("invoice_payments" in data.invoice, false);
  assert.equal((await call(`/api/customer/invoices/${ids[1]}`)).status, 401);
  assert.ok([401, 307].includes((await call(`/api/invoices/${ids[0]}`)).status));
  assert.ok([401, 307].includes((await call(`/api/invoices/${ids[0]}/portal`, "POST", { action: "reply", id: randomUUID(), body: "forged staff reply" })).status));
  const message = { id: randomUUID(), body: "Portal integration test message" };
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await call(`${endpoint}/messages`, "POST", message)).status, 200);
  assert.equal((await (await call(endpoint)).json()).messages.length, 1);
  const shipping = await db.from("customer_portal_shipments").insert({ invoice_id: ids[0], status: "in_transit", location: "Shenzhen dispatch hub", carrier: "Test carrier", tracking_number: "PORTAL-123", tracking_url: "https://example.com/tracking/PORTAL-123", expected_delivery: "2026-11-01" });
  if (shipping.error) throw shipping.error;
  const staffReply = await db.from("customer_portal_messages").insert({ invoice_id: ids[0], sender: "staff", body: "Your test order is on its way." });
  if (staffReply.error) throw staffReply.error;
  const payment = await db.from("invoices").update({ paid_minor: 1000 }).eq("id", ids[0]);
  if (payment.error) throw payment.error;
  const updated = await (await call(endpoint)).json();
  assert.equal(updated.messages.length, 2);
  assert.equal(updated.messages[1].sender, "staff");
  assert.equal(updated.shipment.location, "Shenzhen dispatch hub");
  assert.equal(updated.shipment.status, "in_transit");
  assert.equal(updated.invoice.paid_minor, 1000);
  assert.ok([401, 307].includes((await call(`/api/invoices/${ids[0]}`, "PATCH", { action: "payment", payment: { id: randomUUID(), amountMinor: 1500, method: "bank_transfer", paidOn: "2026-10-26", reference: "customer-forgery" } })).status));
  const crossOrigin = await fetch(origin + `${endpoint}/messages`, { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ id: randomUUID(), body: "blocked" }) });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await call("/api/customer/session", "PATCH", { action: "set-password", password: "weak" })).status, 400);
  const password = `Test!${randomUUID()}aA`;
  assert.equal((await call("/api/customer/session", "PATCH", { action: "set-password", password })).status, 200);
  assert.equal((await call(endpoint, "GET", undefined, guestCookie)).status, 401);
  const rescan = await call("/api/customer/session", "POST", { invoiceId: ids[0], key });
  assert.equal((await rescan.json()).requiresLogin, true);
  assert.equal((await call(endpoint)).status, 401);
  assert.equal((await call("/api/customer/session", "PATCH", { action: "set-password", password: "Overwrite!Password123" })).status, 409);
  assert.equal((await call("/api/customer/session", "PATCH", { action: "login", password: "Wrong!Password123" })).status, 401);
  assert.equal((await call("/api/customer/session", "PATCH", { action: "login", password })).status, 200);
  assert.equal((await (await call(endpoint)).json()).needsPassword, false);
  const pdf = await call(`${endpoint}/pdf`);
  assert.equal(pdf.status, 200, await pdf.clone().text());
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  assert.equal((await call("/api/customer/session", "DELETE")).status, 200);
  assert.equal((await call(endpoint)).status, 401);
  console.log("PASS: existing printed QR compatibility, QR entry, draft rejection and activation after issue with unchanged QR, invoice isolation, staff API/payment denial, chat idempotency, staff reply visibility, shipping/payment updates, CSRF, password setup, guest revocation, password re-entry, PDF, logout.");
  if (process.argv.includes("--keep-fixture")) {
    const reset = await db.from("customer_portal_accounts").update({ password_hash: null, credential_version: 2 }).eq("email", email);
    if (reset.error) throw reset.error;
    fixture.url = `${origin}/customer/invoices/${ids[0]}#key=${key}`;
    await mkdir(new URL("../tmp/", import.meta.url), { recursive: true });
    await writeFile(fixturePath, JSON.stringify(fixture));
    retained = true;
    console.log("UI fixture ready in tmp/customer-portal-ui.json. Run this script with --cleanup after browser review.");
  }
} finally {
  if (!retained) await clean(fixture);
}
