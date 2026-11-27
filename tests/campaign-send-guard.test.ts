import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { evaluateSend } from "../lib/outreach-policy.ts";
import { CampaignDeliveryBlocked } from "../lib/email-send-failure.ts";
import { isCampaignContactEligible } from "../lib/campaign-contact-eligibility.ts";

function load(options: { unsubscribed?: boolean; suppressed?: boolean; recent?: boolean; unverified?: boolean; source?: string; dryRun?: boolean; revoked?: boolean; sentToday?: number; role?: string; otherCompany?: boolean; assignmentError?: boolean } = {}) {
  // Pipeline has no `id` column. Keep the fixture's real keys and apply both
  // ownership filters so an invalid projection or missing filter fails the test.
  const assignment = { company_id: options.otherCompany ? "other-company" : "company", owner_id: options.revoked ? "other-manager" : "sender" };
  const db = { from(table: string) {
    let head = false, smart = false;
    const filters: Array<[string, unknown]> = [];
    const query = {
      select(fields: string, opts?: { head?: boolean }) {
        head = Boolean(opts?.head);
        if (table === "pipeline") for (const field of fields.split(",")) {
          if (!(field in assignment)) throw new Error(`column pipeline.${field} does not exist`);
        }
        return query;
      },
      eq(key: string, value: unknown) { filters.push([key, value]); if (key === "to_email") smart = true; return query; },
      gte() { return query; }, limit() { return query; }, maybeSingle() { return query; },
      async throwOnError() {
        if (table === "marketing_assets") return { data: { id: "campaign", dispatch: { userId: "sender" } } };
        if (table === "contacts") return head ? { count: options.unsubscribed ? 1 : 0 } : { data: { id: "contact", company_id: "company", email: "buyer@example.test", verification_status: options.unverified ? "unknown" : "valid", consent_source: options.source, unsubscribed: false } };
        if (table === "pipeline") {
          if (options.assignmentError) throw new Error("Assignment lookup unavailable");
          return { data: filters.every(([key, value]) => assignment[key as keyof typeof assignment] === value) ? assignment : null };
        }
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
  return (input = { to: ["buyer@example.test"], campaign: { id: "campaign", contactId: "contact", smartSending: true } }) => api.assertCampaignDelivery({ id: "sender", role: options.role ?? "bd_manager" }, input);
}

test("BD managers can send campaigns to their assigned company's contacts using the real pipeline keys", async () => {
  await assert.doesNotReject(load()());
  await assert.rejects(load({ revoked: true })(), /no longer assigned/);
  await assert.rejects(load({ otherCompany: true })(), /no longer assigned/);
});

test("assignment lookup errors stop delivery while admins and operators do not require ownership", async () => {
  await assert.rejects(load({ assignmentError: true })(), /Assignment lookup unavailable/);
  for (const role of ["admin", "operator"]) await assert.doesNotReject(load({ role, revoked: true, assignmentError: true })());
});

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
