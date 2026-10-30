import assert from "node:assert/strict";
import test from "node:test";
import { flowMailboxOptions, flowSenderOptions } from "../lib/flow-mailboxes.ts";
import { normalizeMailboxRows } from "../lib/mailbox-utils.ts";

function inventory() {
  return flowMailboxOptions(normalizeMailboxRows([
    { id: "team", type: "workspace", email: "team@example.com", is_default: true },
    { id: "mine", type: "personal", user_id: "owner", email: "me@example.com", is_default: true },
    { id: "other", type: "personal", user_id: "other-owner", email: "other@example.com", is_default: true },
  ].map((row) => ({ ...row, is_active: true, smtp_host: "smtp.example.com", smtp_username: row.email, smtp_password: "secret" }))));
}

test("flow sender choices distinguish personal and team addresses and follow the flow owner", () => {
  const mailboxes = inventory();
  const options = flowSenderOptions(mailboxes, "owner");
  assert.deepEqual(options.map((item) => item.id), ["owner", "default", "team", "mine"]);
  assert.match(options[0].label, /Personal email.*me@example.com/);
  assert.match(options[1].label, /Team email.*team@example.com/);
  const other = flowSenderOptions(mailboxes, "other-owner");
  assert.match(other[0].label, /other@example.com/);
  assert.ok(!other.some((item) => item.id === "mine"));
  assert.ok(!JSON.stringify(mailboxes).includes("secret"));
  assert.ok(!JSON.stringify(mailboxes).includes("smtp_username"));
});

test("stopped and incomplete accounts are visible but cannot be chosen; missing defaults are explained", () => {
  const mailboxes = inventory();
  mailboxes[0].isActive = false;
  mailboxes[1].sendConfigured = false;
  const options = flowSenderOptions(mailboxes, "owner");
  for (const option of options) assert.equal(option.disabled, true);
  assert.match(options.find((item) => item.id === "mine")!.label, /setup required/);
  assert.match(options.find((item) => item.id === "team")!.label, /stopped/);
  assert.deepEqual(flowSenderOptions([], "owner").map((item) => item.disabled), [true, true]);
});
