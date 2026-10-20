import assert from "node:assert/strict";
import test from "node:test";

import { analyticsChannelForSource } from "../lib/analytics-dashboard.ts";

test("maps real CRM acquisition sources into dashboard channels", () => {
  assert.equal(analyticsChannelForSource("shopify_b2b_form"), "store");
  assert.equal(analyticsChannelForSource("facebook_lead_ad"), "meta");
  assert.equal(analyticsChannelForSource("wholesale_referral"), "partner");
  assert.equal(analyticsChannelForSource(null), "store");
});
