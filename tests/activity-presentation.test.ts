import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { companyPortrait, companyPortraits } from "../lib/company-avatar.ts";
import { activityAction, activityRelativeTime } from "../lib/activity-action.ts";

test("company portraits stay consistent across views and all referenced assets exist", () => {
  const companyIds = Array.from({ length: 200 }, (_, index) => `company-${index}`);
  const portraits = companyIds.map(companyPortrait);
  assert.deepEqual(companyIds.map(companyPortrait), portraits);
  assert.equal(new Set(portraits).size, 6);
  for (const portrait of companyPortraits) assert.ok(existsSync(new URL(`../public${portrait}`, import.meta.url)));
});

test("action badges identify the requested action with an honest generic fallback", () => {
  const cases = [
    ["Call the buyer", "call"], ["Reply to customer email", "email"],
    ["Shipping approval required: add delivery cost", "review"],
    ["Prepare invoice and send email", "invoice"], ["Arrange shipment", "shipping"],
    ["Follow-up reminder", "schedule"], ["Task completed: Call buyer", "complete"],
    ["回复客户邮件", "email"], ["Do the next step", "task"],
  ] as const;
  for (const [title, expected] of cases) assert.equal(activityAction(title, "task"), expected);
  assert.equal(activityAction("Workspace updated", "notification"), "notification");
});

test("relative timestamps use the supplied server snapshot, including invalid and future times", () => {
  const now = new Date("2026-10-30T06:00:00Z");
  assert.equal(activityRelativeTime("2026-10-30T04:00:00Z", now), "2 hours ago");
  assert.equal(activityRelativeTime("2026-10-30T06:30:00Z", now), "in 30 minutes");
  assert.equal(activityRelativeTime("2026-10-30T06:00:00Z", now), "Just now");
  assert.equal(activityRelativeTime("bad date", now), "");
});
