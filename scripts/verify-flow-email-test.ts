// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flow-email-test.ts
// Exercises the local authenticated preview API with real AI. Never sends mail or creates CRM records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { blankStep } from "../lib/flows.ts";

const admin = createSupabaseAdmin();
const { data: member } = await admin.from("workspace_members").select("user_id").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
const { data: user } = await admin.auth.admin.getUserById(member!.user_id);
const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
if (error) throw error;
const cookies = new Map<string, string>();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, {
  cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)) },
});
const { error: sessionError } = await client.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
if (sessionError) throw sessionError;
const origin = process.env.FLOW_TEST_ORIGIN || "http://localhost:3000";
const name = `Email preview verification ${randomUUID()}`;
const step = blankStep("ai_auto_reply");
const input = { flow: { name, triggerType: "new_lead", triggerConfig: {}, status: "draft", steps: [
  { type: "wait", config: { amount: 5, unit: "minutes" } }, step,
] }, customerName: "Alex", companyName: "Sample print farm", firstMessage: true,
emails: [{ from: "preview@example.com", subject: "Product catalog", body: "Hi, please send your filament product catalog and ask about the quantities our print farm needs. We have not chosen a material yet." }] };

try {
  const headers = { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "Content-Type": "application/json", origin };
  const response = await fetch(`${origin}/api/flows/test-email`, { method: "POST", headers, body: JSON.stringify(input) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].error, undefined, result.cases[0].error);
  assert.equal(result.cases[0].trace[0].status, "waiting");
  assert.equal(result.cases[0].replies[0].subject, "Re: Product catalog");
  assert.ok(result.cases[0].replies[0].body.length > 50);
  assert.equal(result.cases[0].replies[0].attachments[0].filename, "Filazoo-product-catalog.pdf");
  assert.ok(result.cases[0].replies[0].attachments[0].size > 100);
  assert.equal(result.cases[0].replies[0].attachments[0].content, undefined);
  console.log("PASS authenticated API generates a real AI preview, simulates the wait, and reports the generated catalog");
  const later = await fetch(`${origin}/api/flows/test-email`, { method: "POST", headers, body: JSON.stringify({ ...input, firstMessage: false }) });
  const laterResult = await later.json();
  assert.equal(later.status, 200, JSON.stringify(laterResult));
  assert.equal(laterResult.cases[0].error, undefined, laterResult.cases[0].error);
  assert.equal(laterResult.cases[0].replies[0].attachments.length, 0);
  console.log("PASS later-message preview omits the first-message catalog");
  const { count } = await admin.from("flows").select("id", { count: "exact", head: true }).eq("name", name).throwOnError();
  assert.equal(count, 0);
  assert.equal((await fetch(`${origin}/api/flows/test-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })).status, 401);
  console.log("PASS previews save no flow and anonymous requests are rejected");
} finally {
  await client.auth.signOut({ scope: "local" });
  console.log("Verification session signed out.");
}
