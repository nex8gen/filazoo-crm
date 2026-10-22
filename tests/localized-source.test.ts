import assert from "node:assert/strict";
import test from "node:test";
import { localizedSource } from "../lib/localized-source.ts";

test("English UI updates keep the newly selected email instead of restoring the previous contact", () => {
  assert.equal(localizedSource("Victor", "Isaac", "Isaac"), "Victor");
  assert.equal(localizedSource("Reply to victor@example.com", "Reply to isaac@example.com", "Reply to isaac@example.com"), "Reply to victor@example.com");
});

test("translation passes preserve the English source until React changes the value", () => {
  assert.equal(localizedSource("收件箱", "Inbox", "收件箱"), "Inbox");
  assert.equal(localizedSource("Sent", "Inbox", "收件箱"), "Sent");
  assert.equal(localizedSource("Sent", "Sent", "Sent"), "Sent");
  assert.equal(localizedSource("Inbox", undefined, undefined), "Inbox");
  assert.equal(localizedSource("", "Old placeholder", "Old placeholder"), "");
});
