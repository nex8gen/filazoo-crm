import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { evaluateSend } from "../lib/outreach-policy.ts";
import { CampaignDeliveryBlocked } from "../lib/email-send-failure.ts";
import { isCampaignContactEligible } from "../lib/campaign-contact-eligibility.ts";

function load(options: { unsubscribed?: boolean; suppressed?: boolean; recent?: boolean; unverified?: boolean; source?: string; dryRun?: boolean; revoked?: boolean; sentToday?: number } = {}) {
  const db = { from(table: string) {
    let head = false, smart = false;
    const query = {
      select(_fields: string, opts?: { head?: boolean }) { head = Boolean(opts?.head); return query; },
      eq(key: string) { if (key === "to_email") smart = true; return query; },
      gte() { return query; }, limit() { return query; }, maybeSingle() { return query; },
      async throwOnError() {
        if (table === "marketing_assets") return { data: { id: "campaign", dispatch: { userId: "sender" } } };
        if (table === "contacts") return head ? { count: options.unsubscribed ? 1 : 0 } : { data: { id: "contact", company_id: "company", email: "buyer@example.test", verification_status: options.unverified ? "unknown" : "valid", consent_source: options.source, unsubscribed: false } };
        if (table === "pipeline") return { data: options.revoked ? null : { id: "assignment" } };
        if (table === "suppression") return { count: options.suppressed ? 1 : 0 };
        if (table === "mailbox_sent_messages") return { count: smart ? options.recent ? 1 : 0 : options.sentToday ?? 0 };
        throw new Error(`Unexpected table ${table}`);
      },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
    "../env.ts": { env: { DAILY_SEND_LIMIT: 100, BOUNCE_PAUSE_PERCENT: 5, dryRun: options.dryRun ?? false } },
    "../outreach-policy.ts": { evaluateSend }, "../email-send-failure.ts": { CampaignDeliveryBlocked },
    "../campaign-contact-eligibility.ts": { isCampaignContactEligible },
  };
  const api = {} as { assertCampaignDelivery: (viewer: unknown, input: unknown) => Promise<void> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/campaign-send-guard.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => dependencies[name], Date, Error });
  return (input = { to: ["buyer@example.test"], campaign: { id: "campaign", contactId: "contact", smartSending: true } }) => api.assertCampaignDelivery({ id: "sender", role: options.revoked ? "bd_manager" : "operator" }, input);
}

test("campaign delivery rechecks current suppression, subscriptions, verification, assignments, and smart sending", async () => {
  await assert.doesNotReject(load());
  for (const options of [{ unsubscribed: true }, { suppressed: true }, { unverified: true }, { recent: true }, { revoked: true }, { sentToday: 100 }, { dryRun: true }]) await assert.rejects(load(options)(), CampaignDeliveryBlocked);
});

test("campaign delivery refuses a contact whose email changed after queuing", async () => {
  await assert.rejects(load()({ to: ["changed@example.test"], campaign: { id: "campaign", contactId: "contact", smartSending: true } }), /no longer available/);
});

test("submitted form and Meta contacts remain eligible at delivery while suppression still wins", async () => {
  for (const source of ["shopify_b2b_form", "meta_lead_ads"]) {
    await assert.doesNotReject(load({ unverified: true, source })());
    await assert.rejects(load({ unverified: true, source, suppressed: true })(), CampaignDeliveryBlocked);
    await assert.rejects(load({ unverified: true, source, unsubscribed: true })(), CampaignDeliveryBlocked);
  }
});
