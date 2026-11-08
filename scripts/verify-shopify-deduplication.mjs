// Uses isolated .test receipts only. Never invokes customer creation or flows.
// node --env-file=.env.development.local scripts/verify-shopify-deduplication.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });
assert.equal(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname, "hukbmbicpdmhoxpkvljz.supabase.co");
const email = `dedup-${randomUUID()}@example.test`;
const ids = Array.from({ length: 12 }, () => `form:${randomUUID()}`);
const deployment = process.argv[2];
const lead = id => ({
  webhook_id: id, customer_id: id, shop_domain: deployment ? "filazoo.com" : "dedup-regression.example.test",
  email, company_name: "Dedup regression", full_name: "Dedup regression",
  tags: [], created_at: new Date().toISOString(),
  raw_payload: { "contact[email]": email, "contact[Name]": "Dedup regression", "contact[Company]": "Dedup regression", "contact[body]": "Price please", submission_id: id,
    "h-captcha-response": randomUUID() },
});
try {
  const results = await Promise.all(ids.map(async id => {
    const { data, error } = await db.rpc("claim_shopify_lead", { p_lead: lead(id) });
    assert.ifError(error);
    return data;
  }));
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal(results.filter(result => !result.claimed && result.status === "processing").length, 11);
  const { data: rows, error } = await db.from("shopify_leads").select("webhook_id")
    .eq("email", email).in("webhook_id", ids);
  assert.ifError(error);
  assert.equal(rows.length, 1);
  const complete = await db.from("shopify_leads").update({ status: "processed" })
    .eq("email", email).eq("webhook_id", rows[0].webhook_id);
  assert.ifError(complete.error);
  const repeat = await db.rpc("claim_shopify_lead", { p_lead: lead(ids[1]) });
  assert.ifError(repeat.error);
  assert.equal(repeat.data.claimed, false);
  assert.equal(repeat.data.status, "processed");
  if (deployment) {
    assert.match(deployment, /^https:\/\/(?:filazoo-[a-z0-9-]+\.vercel\.app|crm\.filazoosupply\.com)$/);
    assert.ok(process.env.VERCEL_CLI_PATH, "Set VERCEL_CLI_PATH for authenticated receiver verification");
    const form = new URLSearchParams({ ...lead(ids[2]).raw_payload,
      submission_id: ids[2].slice(5), crm_form_id: "filazoo-b2b-2026" });
    const stdout = execFileSync(process.execPath, [process.env.VERCEL_CLI_PATH, "curl", "/api/shopify/form-lead",
      "--deployment", deployment, "--scope", "team_TuvssrxhHF8qgyVEckWNUiBq", "--", "--silent", "--show-error",
      "--request", "POST", "--header", "Origin: https://filazoo.com", "--data", form.toString()],
      { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
    const response = JSON.parse(stdout);
    assert.equal(response.ok, true);
    assert.equal(response.duplicate, true);
    console.log(JSON.stringify({ receiver: deployment, duplicate: true }));
    const contacts = await db.from("contacts").select("id", { count: "exact", head: true }).eq("email", email);
    assert.ifError(contacts.error);
    assert.equal(contacts.count, 0, "Receiver must not create a customer for a duplicate");
  }
  console.log(JSON.stringify({ passed: true, concurrentRequests: 12, claimed: 1, blockedRepeats: 11, completedRepeat: "deduplicated" }));
} finally {
  const cleanup = await db.from("shopify_leads").delete().eq("email", email).in("webhook_id", ids);
  assert.ifError(cleanup.error);
  const { count, error } = await db.from("shopify_leads").select("webhook_id", { count: "exact", head: true }).eq("email", email);
  assert.ifError(error);
  assert.equal(count, 0, "All fixtures must be removed");
}
