import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as eligibility from "../lib/campaign-contact-eligibility.ts";
import * as campaigns from "../lib/email-campaigns.ts";
import { matchesSegment, type SegmentCompany, type SavedSegment } from "../lib/segments.ts";

type Row = Record<string, unknown>;
const company = (id: string, segment = "Wholesale"): SegmentCompany => ({ id, name: id, segment, country: "US", source: "manual", sourceLabel: "Manual", fitScore: 8, hasEmail: true });
const contact = (id: string, companyId: string, extra: Row = {}): Row => ({ id, company_id: companyId, name: id, email: `${id}@example.test`, verification_status: "valid", consent_source: null, unsubscribed: false, ...extra });
function fixture(companies: SegmentCompany[], contacts: Row[], segments: SavedSegment[] = [], suppression: Row[] = []) {
  const rows: Record<string, Row[]> = { contacts, suppression, mailbox_sent_messages: [] };
  const calls: string[] = [];
  const db = { from(table: string) {
    let data = [...rows[table]];
    const query = {
      select() { return query; }, order() { return query; },
      in(key: string, values: unknown[]) { data = data.filter(row => values.includes(row[key])); return query; },
      range(start: number, end: number) { calls.push(table); data = data.slice(start, end + 1); return query; },
      async throwOnError() { return { data }; },
    };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "../workspace-context.ts": { withWorkspaceViewer: (_viewer: unknown, action: () => unknown) => action() },
    "../supabase/admin.ts": { createSupabaseAdmin: () => db }, "../env.ts": { env: { dryRun: true } },
    "./crm.ts": { listSegmentCompanies: async () => ({ companies }) },
    "./segments.ts": { listSavedSegments: async () => segments },
    "./mailboxes.ts": { getViewerMailboxes: async () => [], mailboxHasSmtp: () => false },
    "../segments.ts": { matchesSegment }, "../email-campaigns.ts": campaigns,
    "../campaign-contact-eligibility.ts": eligibility,
  };
  const api = {} as { getCampaignOptions: (viewer: unknown) => Promise<campaigns.CampaignOptions>; resolveCampaignAudience: (viewer: unknown, config: campaigns.CampaignConfig) => Promise<{ recipients: campaigns.CampaignRecipient[]; excluded: number }> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-campaigns.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => deps[name] ?? {}, Date, Set, Map });
  const viewer = { id: "user", role: "admin", workspaceId: "legacy" };
  return { calls, load: () => api.getCampaignOptions(viewer), preview: () => api.resolveCampaignAudience(viewer, campaigns.campaignConfigSchema.parse({ includeSegments: ["all"], smartSending: false })) };
}

test("campaign audiences include every saved/business segment and every contact beyond query and company-batch boundaries", async () => {
  const companies = Array.from({ length: 205 }, (_, i) => company(`company-${i}`, i === 204 ? "Last business segment" : "Wholesale"));
  const contacts = [...Array.from({ length: 1205 }, (_, i) => contact(`contact-${i}`, "company-0")), contact("last", "company-204"), contact("unrelated", "outside-scope")];
  const segments: SavedSegment[] = [{ id: "saved", name: "Manual audience", description: "", createdAt: "", rules: { companyIds: ["company-0", "company-204"] } }, { id: "empty", name: "No members yet", description: "", createdAt: "", rules: { country: "Brazil" } }];
  const app = fixture(companies, contacts, segments);
  const result = await app.load();
  assert.equal(result.contacts!.length, 1206);
  assert.equal(result.audiences.find(a => a.id === "saved")?.count, 1206);
  assert.equal(result.audiences.find(a => a.id === "saved")?.companyCount, 2);
  assert.equal(result.audiences.find(a => a.id === "empty")?.count, 0);
  assert.equal(result.audiences.find(a => a.name === "Last business segment")?.count, 1);
  assert.deepEqual(Array.from(result.contacts!.find(c => c.id === "contact:last")!.audienceIds!), ["saved", "business:Last business segment"]);
  assert.ok(app.calls.filter(table => table === "contacts").length >= 3);
  contacts.push(contact("new", "company-204"));
  assert.equal((await app.load()).contacts!.length, 1207, "refresh includes newly added contacts");
});

test("contact reasons distinguish historical/unverified contacts from submitted, invalid, risky, suppressed, and unsubscribed addresses", async () => {
  const contacts = [
    contact("historical", "company", { verification_status: "unverified", consent_source: "historical_customer_email" }),
    contact("manual", "company", { verification_status: "unknown" }),
    contact("form", "company", { verification_status: "unverified", consent_source: "shopify_b2b_form" }),
    contact("meta", "company", { verification_status: "unknown", consent_source: "meta_lead_ads" }),
    contact("invalid", "company", { verification_status: "invalid", consent_source: "shopify_b2b_form" }),
    contact("risky", "company", { verification_status: "risky" }),
    contact("suppressed", "company"), contact("optout", "company", { unsubscribed: true }),
    contact("duplicate-optout", "company", { email: "optout@example.test" }),
    contact("missing", "company", { email: " " }), contact("verified", "company"),
  ];
  const app = fixture([company("company")], contacts, [], [{ email: " SUPPRESSED@example.test " }]);
  const result = await app.load();
  const byId = new Map(result.contacts!.map(c => [c.id.slice(8), c]));
  assert.match(byId.get("historical")!.eligibilityReason!, /email history/);
  assert.match(byId.get("manual")!.eligibilityReason!, /no recorded Shopify or Meta/);
  for (const [id, status] of [["historical", "Unverified email"], ["manual", "Unverified email"], ["invalid", "Invalid email"], ["risky", "Risky email"], ["suppressed", "Suppressed"], ["optout", "Unsubscribed"], ["duplicate-optout", "Unsubscribed"], ["missing", "Missing email"]]) {
    assert.equal(byId.get(id)!.eligible, false, id);
    assert.equal(byId.get(id)!.eligibilityStatus, status, id);
  }
  assert.equal(byId.get("form")!.eligibilityStatus, "Submitted");
  assert.equal(byId.get("meta")!.eligible, true);
  assert.equal(byId.get("verified")!.eligibilityStatus, "Verified");
  const preview = await app.preview();
  assert.deepEqual(Array.from(preview.recipients, c => c.id), ["form", "meta", "verified"]);
  assert.equal(preview.excluded, 2);
});
