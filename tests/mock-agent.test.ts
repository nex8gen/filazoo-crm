import test from "node:test";
import assert from "node:assert/strict";
import { runMockProfileAgent } from "../lib/ai/mock-agent.ts";
test("returns a validated high-fit profile from supplied evidence",()=>{const profile=runMockProfileAgent({companyName:"Example Farm",websiteSummary:"Industrial 3D printing production for engineering prototypes and bulk manufacturing."});assert.ok(profile.fitScore>=8);assert.equal(profile.mode,"mock");assert.ok(profile.evidence[0].includes("Industrial"))});
