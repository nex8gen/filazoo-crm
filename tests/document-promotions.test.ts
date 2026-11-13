import assert from "node:assert/strict";
import test from "node:test";
import { promotionEmailTemplate, promotionLibraryRows } from "../lib/document-promotions.ts";
import { newMarketingAsset, monthEndSlots } from "../lib/marketing-assets.ts";
import { documentInputSchema } from "../lib/documents.ts";
import { campaignConfigSchema } from "../lib/email-campaigns.ts";
import { newEmailDesign } from "../lib/email-design.ts";

test("creating a template from a campaign preserves its designed layout", () => {
  const design = newEmailDesign("Hello {{first_name}}, welcome to Filazoo.");
  const plan = { ...newMarketingAsset("factory_sale", 2026), message: "Hello {{first_name}}, welcome to Filazoo.", campaignConfig: campaignConfigSchema.parse({ emailDesign: design }) };
  const template = promotionEmailTemplate(plan);
  assert.deepEqual(template.email_design, design);
  assert.equal(documentInputSchema.safeParse({ ...template, id: crypto.randomUUID() }).success, true);
});

test("promotion conversion separates the email subject and keeps planning notes out of its message", () => {
  const plan = { ...newMarketingAsset("month_end", 2026, monthEndSlots(2026)[0]), title: "January offer", audience: "Trade partners", productSkus: ["PLA"], offer: "Ask for bulk pricing", message: "Subject: Your January offer\r\n\r\nHello {{first_name}},\r\nAsk us for a quote." };
  const template = promotionEmailTemplate(plan);
  assert.equal(template.subject, "Your January offer");
  assert.equal(template.body, "Hello {{first_name}},\r\nAsk us for a quote.");
  assert.equal(template.category, "everyday");
  assert.doesNotMatch(template.description, /Products:|PLA/);
  assert.match(template.description, /Trade partners/);
  assert.doesNotMatch(template.body, /OFFER|MESSAGE|Audience:|Dates:/);
  assert.equal(documentInputSchema.safeParse({ ...template, id: crypto.randomUUID() }).success, true);
  assert.deepEqual(template.related_ids, []);
});

test("conversion preserves handwritten multilingual copy and bounds library metadata", () => {
  const plan = { ...newMarketingAsset("factory_sale", 2026), title: "Partner sale", audience: "A".repeat(2000), offer: "O".repeat(8000), message: "您好，欢迎咨询。" };
  const template = promotionEmailTemplate(plan);
  assert.equal(template.subject, plan.title); assert.equal(template.body, plan.message);
  assert.ok(template.description.length <= 2000);
  assert.equal(documentInputSchema.safeParse({ ...template, id: crypto.randomUUID() }).success, true);
  assert.throws(() => promotionEmailTemplate({ ...plan, message: "  " }), /Write a message/);
});

test("planner distinguishes saved and unplanned slots and never leaks another year or category", () => {
  const january = { ...newMarketingAsset("month_end", 2026, monthEndSlots(2026)[0]), status: "ready" as const, offer: "Bulk pricing", message: "Ask for prices" };
  const assets = [january, newMarketingAsset("month_end", 2027, monthEndSlots(2027)[0]), newMarketingAsset("factory_sale", 2026)];
  assert.equal(promotionLibraryRows(assets, "month_end", 2026, "all", "").length, 12);
  assert.equal(promotionLibraryRows(assets, "month_end", 2026, "unplanned", "").length, 11);
  assert.deepEqual(promotionLibraryRows(assets, "month_end", 2026, "ready", "bulk").map(row => row.asset?.id), [january.id]);
  assert.equal(promotionLibraryRows(assets, "month_end", 2027, "ready", "").length, 0);
  assert.deepEqual(promotionLibraryRows(assets, "factory_sale", 2026, "all", "").map(row => row.asset?.id), [assets[2].id]);
  assert.equal(promotionLibraryRows([], "factory_sale", 2026, "all", "").length, 0);
  const custom = { ...newMarketingAsset("holiday", 2026), slot: "custom-show", title: "Trade show" };
  assert.ok(promotionLibraryRows([custom], "holiday", 2026, "all", "Trade show").some(row => row.asset?.id === custom.id));
  const scheduled = { ...newMarketingAsset("factory_sale", 2026), campaignConfig: campaignConfigSchema.parse({ sendMode: "scheduled", tags: ["Product launch"] }), dispatch: { queuedAt: "2026-11-12T00:00:00Z", scheduledAt: "2026-12-01T00:00:00Z", recipientCount: 2, userId: crypto.randomUUID() } };
  assert.equal(promotionLibraryRows([scheduled], "factory_sale", 2026, "draft", "").length, 0);
  assert.equal(promotionLibraryRows([scheduled], "factory_sale", 2026, "scheduled", "Product launch").length, 1);
});
