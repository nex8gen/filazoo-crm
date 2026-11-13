// Authenticated HTTP smoke test. Sends no outreach; its disposable plan is removed.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-marketing-assets.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { newMarketingAsset } from "../lib/marketing-assets.ts";
import { promotionEmailTemplate } from "../lib/document-promotions.ts";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { withWorkspaceContext } from "../lib/workspace-context.ts";

const origin = process.env.MARKETING_TEST_ORIGIN || "http://localhost:3000";
const control = createSupabaseControl();
const { data: workspace } = await control.from("workspaces").select("id,owner_id").eq("is_legacy", true).single().throwOnError();
assert.ok(workspace);
const { data: user, error: userError } = await control.auth.admin.getUserById(workspace.owner_id);
assert.ifError(userError); assert.ok(user.user?.email);
const { data: link, error: linkError } = await control.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
assert.ifError(linkError); assert.ok(link.properties?.hashed_token);
const cookies = new Map<string, string>();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)) } });
const { error: sessionError } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
assert.ifError(sessionError);
cookies.set("crm_workspace", workspace.id);
const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
const headers = { Cookie: cookie, Origin: origin, "Content-Type": "application/json" };
const endpoint = `${origin}/api/marketing-assets`;
let saved: ReturnType<typeof newMarketingAsset> | undefined;
let templateId: string | undefined;
try {
  const anonymous = await fetch(`${endpoint}?year=2098`, { redirect: "manual" });
  assert.ok([401, 307].includes(anonymous.status), `Anonymous request: ${anonymous.status}`);
  const crossSite = await fetch(endpoint, { method: "POST", headers: { ...headers, Origin: "https://attacker.invalid" }, body: "{}" });
  assert.equal(crossSite.status, 403);
  const draft = { ...newMarketingAsset("factory_sale", 2098), title: `Disposable verification ${randomUUID()}`, audience: "Test only", offer: "Ask for bulk pricing", message: "Subject: Partner offer\nContact your account manager for a quote.", status: "ready", campaignConfig: { subject: "Partner offer A", subjectTest: { subjectB: "Partner offer B" }, plainText: "Partner plain-text alternative" } };
  const create = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(draft) });
  const created = await create.json(); assert.equal(create.status, 200, JSON.stringify(created)); saved = created.asset;
  assert.ok(saved?.updatedAt); assert.equal(saved.title, draft.title);
  assert.equal(saved.campaignConfig?.subjectTest?.subjectB, "Partner offer B");
  assert.equal(saved.campaignConfig?.plainText, "Partner plain-text alternative");
  const deliveryResponse = await fetch(`${origin}/api/email/campaigns`, { method: "POST", headers, body: JSON.stringify({ action: "delivery", id: saved.id }) });
  const deliverySummary = await deliveryResponse.json(); assert.equal(deliveryResponse.status, 200, JSON.stringify(deliverySummary)); assert.equal(deliverySummary.total, 0);
  console.log("PASS A/B and plain-text settings round-trip; delivery query returns without sending");
  const list = await fetch(`${endpoint}?year=2098`, { headers });
  const listed = await list.json(); assert.equal(list.status, 200); assert.ok(listed.assets.some((asset: { id: string }) => asset.id === saved!.id));
  const update = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ...saved, title: `${draft.title} updated` }) });
  const updated = await update.json(); assert.equal(update.status, 200, JSON.stringify(updated));
  const stale = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ...saved, title: "Stale update" }) });
  assert.equal(stale.status, 409);
  saved = updated.asset;
  const oldPage = await fetch(`${origin}/workflow/marketing-assets?year=2098`, { headers, redirect: "manual" });
  const destination = "/email/campaigns?year=2098";
  if (oldPage.status === 307) assert.equal(oldPage.headers.get("location"), destination);
  else {
    // Next streams a client redirect when the shared layout has already flushed.
    assert.equal(oldPage.status, 200);
    const redirected = await oldPage.text();
    assert.match(redirected, /__next-page-redirect/);
    assert.ok(redirected.includes(destination.replaceAll("&", "&amp;")) || redirected.includes(destination));
  }
  const page = await fetch(origin + destination, { headers });
  const html = await page.text(); assert.equal(page.status, 200); assert.match(html, /Marketing campaigns/); assert.match(html, /Month-end promotions/); assert.doesNotMatch(html, /Make every promotion count/);
  const planner = await fetch(`${endpoint}?year=2098`, { headers });
  const plannerData = await planner.json(); assert.equal(planner.status, 200); assert.equal("products" in plannerData, false); assert.ok(plannerData.assets.some((asset: { id: string }) => asset.id === saved!.id));
  templateId = randomUUID();
  const template = promotionEmailTemplate(saved!);
  const saveTemplate = await fetch(`${origin}/api/documents`, { method: "POST", headers, body: JSON.stringify({ ...template, id: templateId, action: "create" }) });
  const templateResult = await saveTemplate.json(); assert.equal(saveTemplate.status, 200, JSON.stringify(templateResult));
  assert.equal(templateResult.document.subject, "Partner offer"); assert.equal(templateResult.document.body, "Contact your account manager for a quote.");
  const templates = await fetch(`${origin}/api/documents?view=templates&category=everyday&q=${encodeURIComponent(saved!.title)}`, { headers });
  const templateList = await templates.json(); assert.equal(templates.status, 200); assert.ok(templateList.documents.some((item: { id: string }) => item.id === templateId));
  const invalidAi = await fetch(`${endpoint}/draft`, { method: "POST", headers, body: JSON.stringify({ ...saved, offer: "" }) });
  assert.equal(invalidAi.status, 400);
  console.log("PASS saved campaign planning, campaign loading without a product catalog, old-page redirect, campaign page rendering, promotion-to-template conversion, subject/body separation, library search, stale-write protection and AI input validation");
} finally {
  if (templateId) {
    await withWorkspaceContext(workspace.id, async () => {
      const result = await createSupabaseAdmin().from("library_documents").delete().eq("id", templateId!);
      assert.ifError(result.error);
    });
    console.log("PASS disposable email template removed");
  }
  if (saved) {
    const remove = await fetch(endpoint, { method: "DELETE", headers, body: JSON.stringify({ id: saved.id, updatedAt: saved.updatedAt }) });
    assert.equal(remove.status, 200, await remove.text());
    const list = await fetch(`${endpoint}?year=2098`, { headers });
    const body = await list.json(); assert.ok(!body.assets.some((asset: { id: string }) => asset.id === saved!.id));
    console.log("PASS delete and reload; disposable plan removed");
  }
  // End only this disposable test session, preserving the user's open browsers.
  await client.auth.signOut({ scope: "local" });
}
