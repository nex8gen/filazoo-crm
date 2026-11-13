import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createHash, randomUUID } from "node:crypto";
import * as messageTools from "../lib/campaign-message-tools.ts";
import * as campaigns from "../lib/email-campaigns.ts";
import { newMarketingAsset, type MarketingAsset } from "../lib/marketing-assets.ts";
import { emailSendSchema } from "../lib/email-workbench.ts";
import { buildFlowEmail } from "../lib/flow-tracking.ts";
import { matchesSegment } from "../lib/segments.ts";
import { isCampaignContactEligible } from "../lib/campaign-contact-eligibility.ts";
import { renderEmailDesign, newEmailDesign, newEmailBlock } from "../lib/email-design.ts";
import { prepareComposerMessage } from "../lib/email-composer.ts";
import { emailProductIssues, resolveEmailProductFeeds } from "../lib/email-products.ts";
import { emailProductConfigSchema } from "../lib/email-block-config.ts";
import type { Product } from "../lib/types.ts";

function load(options: { dryRun?: boolean; noMailbox?: boolean; noAudience?: boolean; dispatch?: boolean; design?: boolean; submission?: boolean; subjectB?: string; plainText?: string; oneRecipient?: boolean; customDesign?: ReturnType<typeof newEmailDesign>; products?: Product[] } = {}) {
  const stamp = "2026-11-12T01:00:00Z";
  let asset: MarketingAsset = { ...newMarketingAsset("factory_sale", 2026), updatedAt: stamp, message: "Hi {{first_name}}, see https://example.test/products", campaignConfig: campaigns.campaignConfigSchema.parse({ subject: "Hello {{company}}", mailboxId: "sender-mailbox", includeSegments: options.noAudience ? [] : ["all"], utmTracking: true }) };
  if (options.subjectB !== undefined) asset.campaignConfig!.subjectTest = { subjectB: options.subjectB };
  if (options.plainText !== undefined) asset.campaignConfig!.plainText = options.plainText;
  if (options.dispatch) asset.dispatch = { queuedAt: stamp, scheduledAt: stamp, recipientCount: 2, userId: "sender" };
  if (options.design) { const design = newEmailDesign("Hi {{first_name}}"); design.blocks.push(newEmailBlock("button", { href: "https://example.test/shop", text: "Explore products" })); asset.campaignConfig!.emailDesign = design; }
  if (options.customDesign) asset.campaignConfig!.emailDesign = options.customDesign;
  const operations: Array<{ payload: ReturnType<typeof emailSendSchema.parse>; hash: string }> = [];
  let rpcCalls = 0, catalogCalls = 0;
  const rows: Record<string, Array<Record<string, unknown>>> = { contacts: [{ id: randomUUID(), company_id: "company", email: "one@example.test", name: "Jane Doe", verification_status: "valid", unsubscribed: false }, { id: randomUUID(), company_id: "company", email: "two@example.test", name: "Sam", verification_status: "valid", unsubscribed: false }], suppression: [], mailbox_sent_messages: [] };
  if (options.oneRecipient) rows.contacts.pop();
  if (options.submission) rows.contacts.forEach((row, index) => { row.verification_status = "unverified"; row.consent_source = index ? "meta_lead_ads" : "shopify_b2b_form"; });
  const db = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let offset = 0, end = 999;
      const query = {
        select() { return query; }, order() { return query; },
        in(key: string, values: string[]) { filters.push(row => values.includes(String(row[key]))); return query; },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
        gte() { return query; }, range(start: number, last: number) { offset = start; end = last; return query; },
        async throwOnError() { const source = table === "email_send_operations" ? operations.map((operation, index) => ({ id: String(index), campaign_id: asset.id, campaign: operation.payload.campaign, status: operation.payload.campaign?.variant === "B" ? "scheduled" : "sent" })) : rows[table] ?? []; return { data: source.filter(row => filters.every(filter => filter(row))).slice(offset, end + 1) }; },
      }; return query;
    },
    async rpc(_name: string, args: { p_operations: typeof operations; p_dispatch: NonNullable<MarketingAsset["dispatch"]>; p_expected_updated_at: string }) {
      assert.equal(args.p_expected_updated_at, stamp); rpcCalls++;
      operations.push(...args.p_operations); asset = { ...asset, dispatch: args.p_dispatch };
      return { data: args.p_dispatch, error: null };
    },
  };
  class MarketingAssetError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
  const deps: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { createHash, randomUUID },
    "../campaign-message-tools.ts": messageTools,
    "../email-products.ts": { emailProductIssues, resolveEmailProductFeeds },
    "./email-product-images.ts": { embedPrivateProductImages: async (design: unknown) => design },
    "../workspace-context.ts": { withWorkspaceViewer: async (_viewer: unknown, action: () => unknown) => action() },
    "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "../env.ts": { env: { dryRun: options.dryRun ?? false, NEXT_PUBLIC_APP_URL: "https://crm.test" } },
    "./crm.ts": { listProducts: async () => { catalogCalls++; return { products: options.products ?? [] }; }, listSegmentCompanies: async () => ({ companies: [{ id: "company", name: "Acme", segment: "Partner", country: "US", source: "imported", sourceLabel: "Imported", fitScore: 8, hasEmail: true }] }) },
    "./segments.ts": { listSavedSegments: async () => [] },
    "./mailboxes.ts": { getViewerMailboxes: async () => options.noMailbox ? [] : [{ id: "sender-mailbox", email: "sender@example.test", displayName: "Filazoo" }], mailboxHasSmtp: () => true },
    "../segments.ts": { matchesSegment }, "../email-campaigns.ts": campaigns,
    "../email-workbench.ts": { emailSendSchema }, "../flow-tracking.ts": { buildFlowEmail },
    "../campaign-contact-eligibility.ts": { isCampaignContactEligible }, "../email-design.ts": { renderEmailDesign }, "../email-composer.ts": { prepareComposerMessage },
    "./marketing-assets.ts": { listMarketingAssets: async () => [asset], MarketingAssetError },
  };
  const api = {} as { getCampaignDeliverySummary: (viewer: unknown, id: string) => Promise<campaigns.CampaignDeliverySummary>; queueCampaign: (viewer: unknown, id: string, year: number, stamp: string) => Promise<unknown> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-campaigns.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => { if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`); return deps[name]; }, Date, Set, Map });
  return { operations, catalogCalls: () => catalogCalls, summary: () => api.getCampaignDeliverySummary({ id: "sender", role: "operator" }, asset.id), calls: () => rpcCalls, queue: (revision = stamp, role = "operator") => api.queueCampaign({ id: "sender", role }, asset.id, asset.year, revision) };
}

test("campaign queue accepts advisory button and video link warnings", async () => {
  const design = newEmailDesign("Special offers");
  design.blocks.push(newEmailBlock("button", { text: "Shop now", href: "" }), newEmailBlock("video", { href: "javascript:alert(1)" }));
  const fixture = load({ customDesign: design });
  await fixture.queue();
  assert.equal(fixture.calls(), 1);
  assert.equal(fixture.operations.length, 2);
  for (const operation of fixture.operations) assert.doesNotMatch(operation.payload.html!, /javascript:/i);
});

test("campaign queue refreshes dynamic products before validation and snapshots the catalog once for every recipient", async () => {
  const design = newEmailDesign("Current products");
  design.blocks.push(newEmailBlock("product", { product: emailProductConfigSchema.parse({ mode: "dynamic", feed: { name: "PLA", material: "PLA", search: "", sort: "name", availableOnly: false, linkTemplate: "https://shop.test/products/{sku}" } }) }));
  const products = [{ sku: "PLA", name: "Updated filament", material: "PLA", price: "$25", imageUrl: "https://shop.test/pla.png", stockStatus: "In stock", status: "Active" }] as Product[];
  const fixture = load({ customDesign: design, products }); await fixture.queue();
  assert.equal(fixture.catalogCalls(), 1); assert.equal(fixture.calls(), 1); assert.equal(fixture.operations.length, 2);
  for (const operation of fixture.operations) { assert.match(operation.payload.html!, /Updated filament/); assert.match(operation.payload.html!, /https:\/\/shop.test\/products\/PLA/); assert.match(operation.payload.text, /\$25/); }
  const empty = load({ customDesign: design }); await assert.rejects(empty.queue(), /Choose products/); assert.equal(empty.calls(), 0);
  design.blocks.find(block => block.type === "product")!.product!.feed!.linkTemplate = "";
  const missingLink = load({ customDesign: design, products }); await assert.rejects(missingLink.queue(), /public product link/); assert.equal(missingLink.calls(), 0);
});

test("campaign submission queues one personalized private email per recipient with tracking and stable reservations", async () => {
  const fixture = load(); await fixture.queue();
  assert.equal(fixture.calls(), 1); assert.equal(fixture.operations.length, 2);
  assert.deepEqual(fixture.operations.map(item => item.payload.to), [["one@example.test"], ["two@example.test"]]);
  assert.equal(fixture.operations[0].payload.subject, "Hello Acme");
  assert.match(fixture.operations[0].payload.text, /Hi Jane/);
  assert.match(fixture.operations[0].payload.text, /utm_source=filazoo/);
  assert.ok(fixture.operations[0].payload.campaign?.smartSending);
  for (const operation of fixture.operations) {
    const message = { ...operation.payload }; delete message.requestId; delete message.scheduleAt;
    assert.equal(operation.hash, createHash("sha256").update(JSON.stringify(message)).digest("hex"));
  }
});

test("visual campaigns queue the designed HTML and accept submitted form and Meta contacts", async () => {
  const fixture = load({ design: true, submission: true }); await fixture.queue();
  assert.equal(fixture.operations.length, 2);
  assert.match(fixture.operations[0].payload.html ?? "", /Explore products/);
  assert.match(fixture.operations[0].payload.html ?? "", /Hi Jane/);
  assert.match(fixture.operations[0].payload.html ?? "", /utm_campaign=/);
  assert.equal(fixture.operations[0].payload.footerIncluded, true);
});

test("submitted campaigns cannot be submitted twice and stale, viewer, or invalid sends reserve nothing", async () => {
  const queued = load({ dispatch: true }); await queued.queue(); assert.equal(queued.calls(), 0);
  for (const options of [{ dryRun: true }, { noMailbox: true }, { noAudience: true }]) { const fixture = load(options); await assert.rejects(fixture.queue()); assert.equal(fixture.calls(), 0); }
  const stale = load(); await assert.rejects(stale.queue("2026-11-11T01:00:00Z"), /changed/); assert.equal(stale.calls(), 0);
  const viewer = load(); await assert.rejects(viewer.queue(undefined, "viewer"), /role/); assert.equal(viewer.calls(), 0);
});

 test("A/B submission sends exactly one variant per recipient and personalizes both subjects", async () => {
  const fixture = load({ subjectB: "Welcome {{first_name}}" }); await fixture.queue();
  assert.equal(fixture.operations.length, 2);
  assert.deepEqual(fixture.operations.map(operation => operation.payload.campaign?.variant).sort(), ["A", "B"]);
  for (const operation of fixture.operations) {
    assert.equal(operation.payload.subject, operation.payload.campaign?.variant === "A" ? "Hello Acme" : operation.payload.to[0] === "one@example.test" ? "Welcome Jane" : "Welcome Sam");
  }
  for (const subjectB of ["", "Hello {{company}}", "Hello {{unsupported}}"] ) { const invalid = load({ subjectB }); await assert.rejects(invalid.queue()); assert.equal(invalid.calls(), 0); }
});

test("designed emails include the personalized custom plain-text alternative", async () => {
  const fixture = load({ design: true, plainText: "Custom plain version for {{first_name}}" }); await fixture.queue();
  assert.equal(fixture.operations[0].payload.text, "Custom plain version for Jane");
  assert.match(fixture.operations[0].payload.html ?? "", /Explore products/);
});

test("A/B tests reject a single eligible recipient and report delivery counts for each variant", async () => {
  const single = load({ subjectB: "Second subject", oneRecipient: true }); await assert.rejects(single.queue(), /at least two/); assert.equal(single.calls(), 0);
  const fixture = load({ subjectB: "Second subject" }); await fixture.queue();
  const summary = await fixture.summary();
  assert.equal(summary.total, 2); assert.equal(summary.sent, 1); assert.equal(summary.scheduled, 1);
  assert.equal(summary.variants?.A.sent, 1); assert.equal(summary.variants?.B.scheduled, 1);
  assert.equal(summary.variants?.A.total, 1); assert.equal(summary.variants?.B.total, 1);
});
