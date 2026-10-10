import test from "node:test";
import assert from "node:assert/strict";
import { getInitials, getPipelineStageLabel, normalizePipelineStage } from "../lib/crm-model.ts";
import { safeInternalPath } from "../lib/safe-redirect.ts";

test("uses one canonical pipeline model and maps legacy database stages", () => {
  assert.equal(normalizePipelineStage("interested"), "interested");
  assert.equal(normalizePipelineStage("qualified"), "interested");
  assert.equal(normalizePipelineStage("negotiation"), "big_order");
  assert.equal(getPipelineStageLabel("big_order"), "Big order");
});

test("creates stable company initials", () => {
  assert.equal(getInitials("Proto Labs Europe"), "PL");
  assert.equal(getInitials("Form3D"), "F");
});

test("accepts only internal post-login redirects", () => {
  assert.equal(safeInternalPath("/companies?stage=new"), "/companies?stage=new");
  assert.equal(safeInternalPath("//example.com"), "/");
  assert.equal(safeInternalPath("/\\example.com"), "/");
  assert.equal(safeInternalPath("https://example.com"), "/");
});
