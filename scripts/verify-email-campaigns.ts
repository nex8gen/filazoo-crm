// Verifies a disposable draft through the local authenticated APIs. Never queues email.
// node --env-file=.env.local --experimental-strip-types scripts/verify-email-campaigns.ts
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { campaignConfigSchema } from "../lib/email-campaigns.ts";
import { newMarketingAsset, type MarketingAsset } from "../lib/marketing-assets.ts";
import { emailDesignText, newEmailBlock, newEmailDesign } from "../lib/email-design.ts";
import type { LibraryDocument } from "../lib/documents.ts";

const origin = "http://localhost:3000";
const db = createSupabaseControl();
const { data: workspace } = await db.from("workspaces").select("id,owner_id").eq("is_legacy", true).single().throwOnError();
assert.ok(workspace);
const { data: owner } = await db.auth.admin.getUserById(workspace.owner_id);
assert.ok(owner.user?.email);
const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email: owner.user.email });
assert.ifError(error); assert.ok(link.properties?.hashed_token);
const jar = new Map<string, string>();
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cookies => cookies.forEach(({ name, value }) => jar.set(name, value)) } });
assert.ifError((await auth.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })).error);
jar.set("crm_workspace", workspace.id);
const headers = { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), Origin: origin, "Content-Type": "application/json" };
async function request(path: string, body?: unknown, method = "POST") {
  return fetch(origin + path, { method: body === undefined ? "GET" : method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
}
let saved: MarketingAsset | undefined;
let template: LibraryDocument | undefined;
try {
  const options = await request("/api/email/campaigns"); assert.equal(options.status, 200, await options.clone().text());
  const metadata = await options.json(); assert.ok(Array.isArray(metadata.audiences)); assert.ok(Array.isArray(metadata.mailboxes));
  assert.ok(metadata.contacts.length > 200, "All customer contacts should be available");
  assert.ok(metadata.audiences.some((item: { kind: string }) => item.kind === "business"));
  assert.ok(metadata.contacts.some((item: { consentSource: string; eligible: boolean }) => item.consentSource === "meta_lead_ads" && item.eligible));
  assert.ok(metadata.contacts.some((item: { consentSource: string; eligible: boolean }) => item.consentSource === "shopify_b2b_form" && item.eligible));
  assert.ok(metadata.mailboxes.every((mailbox: Record<string, unknown>) => !Object.keys(mailbox).some(key => /password|smtp|imap|secret/i.test(key))));
  const config = campaignConfigSchema.parse({ tags: ["Disposable QA"], subject: "Campaign QA — never send", includeSegments: ["all"], smartSending: true });
  const preview = await request("/api/email/campaigns", { action: "preview", config }); assert.equal(preview.status, 200, await preview.clone().text());
  const audience = await preview.json(); assert.equal(typeof audience.count, "number"); assert.ok(audience.recipients.length <= 10);
  assert.ok(audience.count > 100, "Submitted contacts should be eligible");
  const individual = metadata.contacts.find((item: { eligible: boolean }) => item.eligible);
  const individualPreview = await request("/api/email/campaigns", { action: "preview", config: { ...config, smartSending: false, includeSegments: [individual.id] } });
  assert.equal(individualPreview.status, 200, await individualPreview.clone().text()); assert.equal((await individualPreview.json()).count, 1);
  const templates = await request("/api/documents?view=templates&sort=newest"); assert.equal(templates.status, 200); assert.ok(Array.isArray((await templates.json()).documents));
  const design = newEmailDesign("Hello {{first_name}}. This draft is only for verification.");
  design.blocks.push(newEmailBlock("button", { text: "Explore products", href: "https://filazoo.com" }));
  config.emailDesign = design;
  const templateResponse = await request("/api/documents", { action: "create", id: crypto.randomUUID(), kind: "template", name: `Disposable visual QA ${crypto.randomUUID()}`, category: "everyday", body: emailDesignText(design), email_design: design });
  assert.equal(templateResponse.status, 200, await templateResponse.clone().text()); template = (await templateResponse.json()).document;
  assert.deepEqual(template?.email_design, design);
  const details = await request(`/api/documents/${template!.id}?details=1`); assert.equal(details.status, 200, await details.clone().text());
  assert.deepEqual((await details.json()).document.email_design, design);
  const changed = { ...design, theme: { ...design.theme, radius: 8 } };
  const templateUpdate = await request("/api/documents", { ...template, action: "update", email_design: changed, body: emailDesignText(changed) });
  assert.equal(templateUpdate.status, 200, await templateUpdate.clone().text()); template = (await templateUpdate.json()).document;
  assert.equal(template?.email_design?.theme.radius, 8);
  const draft = { ...newMarketingAsset("factory_sale", 2098), title: `Disposable campaign QA ${crypto.randomUUID()}`, campaignConfig: config, message: emailDesignText(design) };
  const created = await request("/api/marketing-assets", draft); assert.equal(created.status, 200, await created.clone().text()); saved = (await created.json()).asset;
  assert.ok(saved?.updatedAt); assert.deepEqual(saved.campaignConfig, config);
  const updated = await request("/api/marketing-assets", { ...saved, campaignConfig: { ...config, preheader: "Saved preview text", excludeSegments: [] } }); assert.equal(updated.status, 200, await updated.clone().text()); saved = (await updated.json()).asset;
  assert.equal(saved?.campaignConfig?.preheader, "Saved preview text");
  const reloaded = await request("/api/marketing-assets?year=2098"); assert.equal(reloaded.status, 200);
  assert.equal((await reloaded.json()).assets.find((item: MarketingAsset) => item.id === saved!.id)?.campaignConfig.preheader, "Saved preview text");
  const delivery = await request("/api/email/campaigns", { action: "delivery", id: saved!.id }); assert.equal(delivery.status, 200); assert.equal((await delivery.json()).total, 0);
  console.log(`PASS: ${metadata.contacts.length} contacts, ${metadata.audiences.length} audiences, ${audience.count} eligible recipients; individual selection; visual template create/update/reopen; campaign design persistence; private sender options. No emails queued or sent.`);
} finally {
  if (saved?.updatedAt) { const removed = await request("/api/marketing-assets", { id: saved.id, updatedAt: saved.updatedAt }, "DELETE"); assert.equal(removed.status, 200, "Disposable campaign cleanup failed"); }
  if (template) await db.from("library_documents").delete().eq("workspace_id", workspace.id).eq("id", template.id).throwOnError();
  await auth.auth.signOut({ scope: "local" });
}
