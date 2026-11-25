import assert from "node:assert/strict";
import test from "node:test";
import { flowMailboxOptions, flowSenderOptions, resolveFlowSender, selectedFlowSender, visibleFlowSender, resolveAssignedOrTeamSender } from "../lib/flow-mailboxes.ts";
import { normalizeMailboxRows } from "../lib/mailbox-utils.ts";

function inventory() {
  return flowMailboxOptions(normalizeMailboxRows([
    { id: "team", type: "workspace", email: "team@example.com", is_default: true },
    { id: "mine", type: "personal", user_id: "owner", email: "me@example.com", is_default: true },
    { id: "other", type: "personal", user_id: "other-owner", email: "other@example.com", is_default: true },
  ].map((row) => ({ ...row, is_active: true, smtp_host: "smtp.example.com", smtp_username: row.email, smtp_password: "secret" }))));
}

test("explicit assigned-user routing prefers a ready personal sender and otherwise uses the team", () => {
  const mailboxes = inventory();
  assert.equal(resolveAssignedOrTeamSender(mailboxes, "owner")?.id, "mine");
  assert.equal(resolveAssignedOrTeamSender(mailboxes, "other-owner")?.id, "other");
  assert.equal(resolveAssignedOrTeamSender(mailboxes, null)?.id, "team");
  assert.equal(resolveAssignedOrTeamSender(mailboxes, "unassigned")?.id, "team");
  mailboxes[1].isActive = false;
  assert.equal(resolveAssignedOrTeamSender(mailboxes, "owner")?.id, "team");
  mailboxes[1].isActive = true; mailboxes[1].sendConfigured = false;
  assert.equal(resolveAssignedOrTeamSender(mailboxes, "owner")?.id, "team");
  mailboxes[0].isActive = false;
  assert.equal(resolveAssignedOrTeamSender(mailboxes, "owner"), null);
});

test("flow sender choices show each own or team account once, without other users or sender rules", () => {
  const mailboxes = inventory();
  const options = flowSenderOptions(mailboxes, "owner");
  assert.deepEqual(options.map((item) => item.id), ["team", "mine"]);
  assert.match(options[0].label, /Team email.*team@example.com/);
  assert.match(options[1].label, /Personal email.*me@example.com/);
  const other = flowSenderOptions(mailboxes, "other-owner");
  assert.match(other[1].label, /other@example.com/);
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
  assert.deepEqual(flowSenderOptions([], "owner"), []);
});

test("workflow defaults follow personal settings and keep explicit team choices", () => {
  const mailboxes = inventory();
  assert.equal(resolveFlowSender(mailboxes, "owner", "default")?.id, "mine");
  mailboxes[1].isDefault = false;
  assert.equal(resolveFlowSender(mailboxes, "owner", "default")?.id, "mine");
  assert.equal(resolveFlowSender(mailboxes, "owner", "owner")?.id, "mine");
  assert.equal(flowSenderOptions(mailboxes, "owner")[1].disabled, false);
  assert.equal(resolveFlowSender(mailboxes, "owner", "workspace")?.id, "team");
  assert.equal(resolveFlowSender(mailboxes, "owner", "team")?.id, "team");
  assert.equal(resolveFlowSender(mailboxes, "owner", "other"), null);
  mailboxes.splice(1, 1);
  assert.equal(resolveFlowSender(mailboxes, "owner", "default")?.id, "team");
  assert.equal(resolveFlowSender(mailboxes, "owner", "owner"), null);
});

test("a stopped personal default cannot silently switch to another personal or team sender", () => {
  const mailboxes = inventory();
  mailboxes[1].isActive = false;
  mailboxes.push({ ...mailboxes[1], id: "second", isDefault: false, isActive: true });
  assert.equal(resolveFlowSender(mailboxes, "owner", "default")?.id, "mine");
  assert.equal(selectedFlowSender(flowSenderOptions(mailboxes, "owner"), "default")?.disabled, true);
  assert.equal(resolveFlowSender(mailboxes, "owner", "owner")?.id, "mine");
});

test("legacy default choices select the resolved account without adding duplicate menu items", () => {
  const mailboxes = inventory();
  const options = flowSenderOptions(mailboxes, "owner");
  for (const value of ["default", "owner", "mine"]) assert.equal(selectedFlowSender(options, value)?.id, "mine");
  for (const value of ["workspace", "team"]) assert.equal(selectedFlowSender(options, value)?.id, "team");
  for (const value of ["assigned_owner", "other", "removed"]) assert.equal(selectedFlowSender(options, value), undefined);
  mailboxes.splice(1, 1);
  const teamOnly = flowSenderOptions(mailboxes, "owner");
  assert.equal(teamOnly.length, 1);
  assert.equal(selectedFlowSender(teamOnly, "default")?.id, "team");
  assert.equal(selectedFlowSender(teamOnly, "owner"), undefined);
});

test("editing another owner's flow never exposes their private sender or guesses a default", () => {
  const options = flowSenderOptions(inventory(), "other-owner", "owner");
  assert.deepEqual(options.map(option => option.id), ["team"]);
  assert.equal(selectedFlowSender(options, "default"), undefined);
  assert.equal(selectedFlowSender(options, "owner"), undefined);
  assert.equal(selectedFlowSender(options, "workspace")?.id, "team");
});

test("sender details never substitute the team mailbox for another owner's hidden default", () => {
  for (const mailboxes of [inventory(), inventory().filter(box => box.type === "workspace" || box.userId === "owner")]) {
    for (const choice of [undefined, null, "default", "owner", "other"]) {
      assert.equal(visibleFlowSender(mailboxes, "other-owner", "owner", choice), null);
    }
    assert.equal(visibleFlowSender(mailboxes, "other-owner", "owner", "workspace")?.id, "team");
    assert.equal(visibleFlowSender(mailboxes, "other-owner", "owner", "team")?.id, "team");
    assert.equal(visibleFlowSender(mailboxes, "owner", "owner", "default")?.id, "mine");
  }
});
