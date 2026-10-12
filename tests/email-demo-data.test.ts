import assert from "node:assert/strict";
import test from "node:test";
import { emailDrafts } from "../lib/mock-data.ts";

test("demo mode keeps sample email drafts visible", () => {
  assert.ok(emailDrafts.length >= 3);
  assert.ok(emailDrafts.some((email) => email.subject.includes("PETG")));
});
