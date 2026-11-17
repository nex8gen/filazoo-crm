import assert from "node:assert/strict";
import test from "node:test";
import { defaultFlowInput } from "../lib/flows.ts";
import { applyTriggerEvent, applyTriggerProfiles, editableTriggerTypes, triggerEventDraft, triggerProfileSummary, triggerSettingsError } from "../lib/flow-trigger-editor.ts";
import { matchesFlowCustomer, matchesProfileFilters } from "../lib/flow-engine.ts";
import { createSegmentFlowDraft } from "../lib/segment-flows.ts";

const companyId = "11111111-1111-4111-8111-111111111111";
const contactId = "22222222-2222-4222-8222-222222222222";
const mailboxId = "33333333-3333-4333-8333-333333333333";

test("trigger choices match the six supported entry events and all defaults validate", () => {
  assert.equal(editableTriggerTypes.length, 6);
  assert.ok(!editableTriggerTypes.includes("pipeline_stage_changed" as typeof editableTriggerTypes[number]));
  for (const type of editableTriggerTypes) {
    const config = triggerEventDraft(defaultFlowInput, type, ["Wholesale"]);
    assert.equal(triggerSettingsError(type, config), null, type);
  }
});

test("changing events preserves audience filters, recipient scope, and re-entry settings", () => {
  const flow = { ...defaultFlowInput, triggerConfig: { ...defaultFlowInput.triggerConfig, flowScope: "email", scopeCompanyId: companyId, scopeContactId: contactId, scopeLabel: "buyer@example.com", country: "Canada", companyStatus: "qualified", minFitScore: 6, reentryMode: "after_period", reentryAfterAmount: 10, reentryAfterUnit: "days" } };
  const next = applyTriggerEvent(flow, "email_received", { receivingMailboxId: mailboxId, scopeContactId: "foreign", country: "France", reentryMode: "every_event" });
  assert.equal(next.triggerConfig.scopeContactId, contactId);
  assert.equal(next.triggerConfig.country, "Canada");
  assert.equal(next.triggerConfig.reentryMode, "after_period");
  assert.equal(next.triggerConfig.reentryAfterAmount, 10);
  assert.equal(next.triggerConfig.receivingMailboxId, mailboxId);
  assert.ok(!("amount" in next.triggerConfig));
  assert.ok(!("unit" in next.triggerConfig));
  assert.equal(triggerSettingsError(next.triggerType, next.triggerConfig), null);
});

test("profile editing applies supported AND filters and never changes a locked scope", () => {
  const flow = { ...defaultFlowInput, triggerConfig: { ...defaultFlowInput.triggerConfig, flowScope: "email", scopeCompanyId: companyId, scopeContactId: contactId, scopeLabel: "buyer@example.com", reentryMode: "no_reentry", country: "France" } };
  const config = applyTriggerProfiles(flow, { country: "Canada", companyStatus: "qualified", minFitScore: 7, scopeContactId: "foreign", contactIds: [], reentryMode: "every_event", amount: 50 });
  assert.equal(config.scopeContactId, contactId);
  assert.equal(config.reentryMode, "no_reentry");
  assert.equal(config.amount, flow.triggerConfig.amount);
  assert.ok(!("contactIds" in config));
  assert.equal(matchesProfileFilters(config, { country: "Canada", companyStatus: "qualified", fitScore: 8 }), true);
  assert.equal(matchesProfileFilters(config, { country: "Canada", companyStatus: "engaged", fitScore: 8 }), false);
  assert.equal(matchesProfileFilters(config, { country: "Canada", companyStatus: "qualified", fitScore: 6 }), false);
  assert.equal(triggerSettingsError(flow.triggerType, config), null);
});

test("selected customers cannot silently broaden to everyone and invalid filters cannot save", () => {
  const flow = { ...defaultFlowInput, triggerConfig: { ...defaultFlowInput.triggerConfig, contactIds: [contactId] } };
  const empty = applyTriggerProfiles(flow, { contactIds: [] });
  assert.equal(matchesFlowCustomer(empty, contactId), false);
  assert.ok(triggerSettingsError(flow.triggerType, empty));
  assert.ok(triggerSettingsError(flow.triggerType, { ...flow.triggerConfig, minFitScore: 11 }));
  assert.ok(triggerSettingsError(flow.triggerType, { ...flow.triggerConfig, amount: 0 }));
  const all = applyTriggerProfiles(flow, {});
  assert.ok(!("contactIds" in all));
  assert.equal(matchesFlowCustomer(all, contactId), true);
});

test("segment membership keeps its fixed trigger and one-entry policy", () => {
  const flow = createSegmentFlowDraft({ id: companyId, name: "Wholesale", kind: "saved" });
  const changed = applyTriggerEvent(flow, "email_received", {});
  assert.equal(changed.triggerType, flow.triggerType);
  assert.deepEqual(changed.triggerConfig, flow.triggerConfig);
  const config = applyTriggerProfiles(flow, { segment: "Foreign segment", savedSegmentId: contactId, reentryMode: "every_event", contactIds: [contactId], country: "Canada" });
  assert.equal(config.segment, "Wholesale");
  assert.equal(config.savedSegmentId, companyId);
  assert.equal(config.reentryMode, "no_reentry");
  assert.equal(config.country, "Canada");
  assert.ok(!("contactIds" in config));
});

test("the overview summarizes actual CRM filters and keeps segment events separate", () => {
  assert.deepEqual(triggerProfileSummary({ ...defaultFlowInput, triggerConfig: { segment: "Wholesale", country: "Canada", companyStatus: "qualified", minFitScore: 7, contactIds: [contactId] } }), ["Company segment is Wholesale", "Country is Canada", "Company status is qualified", "Fit score is at least 7", "1 selected customer only"]);
  const segment = createSegmentFlowDraft({ id: companyId, name: "Wholesale", kind: "saved" });
  assert.deepEqual(triggerProfileSummary(segment), []);
});
