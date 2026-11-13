import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { campaignConfigSchema } from "../lib/email-campaigns.ts";
import { newMarketingAsset } from "../lib/marketing-assets.ts";
import { campaignEditorLocation, campaignEditorSearch, campaignSessionKey, campaignRecoverySchema, clearCampaignSession, readCampaignSession, recoverCampaign, writeCampaignSession } from "../lib/campaign-editor-session.ts";

const asset = { ...newMarketingAsset("factory_sale", 2026), updatedAt: "2026-11-13T02:00:00Z", campaignConfig: campaignConfigSchema.parse({ subject: "Original" }) };
const recovery = { base: asset, draft: { ...asset, title: "Unsaved name", campaignConfig: { ...asset.campaignConfig, subject: "Unsaved subject" } }, tagText: "launch, vip", step: "message" as const, view: "edit" as const, settingsOpen: false };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("campaign URL retains campaign, year, step and message view across reload", () => {
  const search = campaignEditorSearch("?q=launch", { campaign: asset.id, year: 2026, step: "message", view: "edit" });
  assert.deepEqual(campaignEditorLocation(search), { campaign: asset.id, step: "message", view: "edit" });
  assert.equal(new URLSearchParams(search).get("year"), "2026");
  assert.equal(new URLSearchParams(search).get("q"), "launch");
  assert.equal(campaignEditorSearch(search, { campaign: null }), "q=launch&year=2026");
});

test("invalid query values cannot select an editor or unknown step", () => {
  assert.deepEqual(campaignEditorLocation("?campaign=bad&step=send&view=bad"), { campaign: null, step: undefined, view: undefined });
});

test("drafts are isolated by workspace, user and campaign", () => {
  assert.notEqual(campaignSessionKey("workspace:user-a", asset.id), campaignSessionKey("workspace:user-b", asset.id));
  assert.notEqual(campaignSessionKey("workspace:user-a", asset.id), campaignSessionKey("another:user-a", asset.id));
  assert.notEqual(campaignSessionKey("workspace:user-a", asset.id), campaignSessionKey("workspace:user-a", crypto.randomUUID()));
});

test("valid unsaved changes round trip without a server save", () => {
  const source = storage();
  writeCampaignSession("draft", recovery, source);
  const restored = readCampaignSession("draft", campaignRecoverySchema, source);
  assert.equal(recoverCampaign(restored, asset)?.draft.campaignConfig?.subject, "Unsaved subject");
  assert.equal(restored?.tagText, "launch, vip");
  clearCampaignSession("draft", source);
  assert.equal(readCampaignSession("draft", campaignRecoverySchema, source), null);
});

test("temporarily empty settings and partial reply-to addresses survive reload", () => {
  const source = storage();
  writeCampaignSession("draft", { ...recovery, draft: { ...recovery.draft, title: "", startDate: "", campaignConfig: { ...recovery.draft.campaignConfig, replyTo: "alex@" } } }, source);
  const restored = readCampaignSession("draft", campaignRecoverySchema, source);
  assert.equal(restored?.draft.title, "");
  assert.equal(restored?.draft.startDate, "");
  assert.equal(restored?.draft.campaignConfig?.replyTo, "alex@");
});

test("new drafts recover before their first save", () => {
  const initial = { ...asset, updatedAt: null };
  assert.ok(recoverCampaign({ ...recovery, base: initial, draft: { ...recovery.draft, updatedAt: null } }, initial));
});

test("newer server revisions, deleted identities, and submitted campaigns reject local changes", () => {
  assert.equal(recoverCampaign(recovery, { ...asset, updatedAt: "2026-11-13T03:00:00Z" }), null);
  assert.equal(recoverCampaign(recovery, { ...asset, id: crypto.randomUUID() }), null);
  assert.equal(recoverCampaign({ ...recovery, draft: { ...recovery.draft, id: crypto.randomUUID() } }, asset), null);
  assert.equal(recoverCampaign(recovery, { ...asset, dispatch: { queuedAt: asset.updatedAt, scheduledAt: asset.updatedAt, recipientCount: 2, userId: "user" } }), null);
});

test("malformed, expired or incompatible storage is ignored", () => {
  const source = storage();
  for (const raw of ["{", "null", JSON.stringify({ version: 2, at: Date.now(), value: recovery }), JSON.stringify({ version: 1, at: Date.now() - 86400_001, value: recovery }), JSON.stringify({ version: 1, at: Date.now(), value: { bad: true } })]) {
    source.setItem("draft", raw);
    assert.equal(readCampaignSession("draft", campaignRecoverySchema, source), null);
  }
});

test("disabled or full storage never prevents editing", () => {
  const source = { getItem() { throw Error("disabled"); }, setItem() { throw Error("full"); }, removeItem() { throw Error("disabled"); } };
  assert.equal(readCampaignSession("draft", z.unknown(), source), null);
  assert.doesNotThrow(() => writeCampaignSession("draft", recovery, source));
  assert.doesNotThrow(() => clearCampaignSession("draft", source));
});
