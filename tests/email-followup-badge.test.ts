import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { emailFollowupBadge } from "../lib/email-followup-badge.ts";
import { followupActionState, type FollowupActionRecord } from "../lib/email-followup-filters.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const now = new Date(2026, 10, 12, 9, 0);
const dueAt = new Date(2026, 10, 12, 16, 30).toISOString();
const action: FollowupActionRecord = { id: "saved", source: "followup", kind: "reminder", status: "scheduled", dueAt, updatedAt: now.toISOString(), messageKey: "message", threadKey: "local:message", anchors: ["local:message"] };

test("scheduled badges show the actual action and saved local time in English and Chinese", () => {
  const reminder = emailFollowupBadge([action], "en", now);
  assert.equal(reminder.label, "Manual follow-up"); assert.equal(reminder.tone, "orange");
  assert.equal(reminder.detail, "Today, 16:30"); assert.equal(reminder.dueAt, dueAt);
  assert.match(reminder.title!, /Reminder:/);
  const ai = emailFollowupBadge([{ ...action, kind: "ai" }], "en", now);
  assert.equal(ai.label, "AI following up"); assert.equal(ai.tone, "blue"); assert.match(ai.title!, /Auto-send:/);
  const tomorrow = emailFollowupBadge([{ ...action, dueAt: new Date(2026, 10, 13, 9, 0).toISOString() }], "en", now);
  assert.equal(tomorrow.detail, "Tomorrow, 09:00");
  const zh = emailFollowupBadge([action], "zh-CN", now);
  assert.equal(zh.label, "等待手动跟进"); assert.equal(zh.detail, "今天 16:30");
  const nurture = emailFollowupBadge([{ ...action, kind: "ai", purpose: "nurture" }], "zh-CN", now);
  assert.equal(nurture.label, "沉睡客户 AI 培育"); assert.equal(nurture.tone, "violet");
});

test("completed, stopped and delivery-problem badges never promise a future send", () => {
  for (const patch of [{ status: "sent" }, { status: "cancelled" }, { taskStatus: "done" }, { taskStatus: "cancelled" }]) {
    const saved = { ...action, ...patch };
    const badge = emailFollowupBadge([saved], "en", now);
    assert.equal(followupActionState(saved), "completed");
    assert.equal(badge.dueAt, undefined); assert.equal(badge.detail, undefined);
    assert.ok(["Stopped", "Follow-up sent", "Completed"].includes(badge.label));
    assert.doesNotMatch(badge.label, /customer.*replied/i, "Cancellation does not prove who replied");
  }
  for (const status of ["failed", "uncertain", "needs_review", "waiting_shipping"]) {
    const saved = { ...action, kind: "ai" as const, status };
    const badge = emailFollowupBadge([saved], "en", now);
    assert.equal(followupActionState(saved), "manual");
    assert.equal(badge.label, "Needs attention"); assert.equal(badge.tone, "red");
    assert.equal(badge.dueAt, undefined);
    assert.equal(badge.detail, status === "uncertain" ? "Check Sent" : "Review follow-up");
  }
});

test("unconfigured and unrelated automations remain unset while active saved actions win over old history", () => {
  assert.equal(emailFollowupBadge([], "en", now).label, "Not set");
  assert.equal(emailFollowupBadge([{ ...action, source: "auto-reply" }], "en", now).label, "Not set");
  const ended = { ...action, id: "newer-ended", status: "cancelled", updatedAt: new Date(2026, 10, 13).toISOString() };
  assert.equal(emailFollowupBadge([ended, action], "en", now).label, "Manual follow-up");
  assert.equal(emailFollowupBadge([{ ...action, status: "processing", kind: "ai" }], "en", now).label, "Sending follow-up");
  assert.equal(emailFollowupBadge([{ ...action, status: "reminded" }], "en", now).label, "Reminder due");
  assert.equal(emailFollowupBadge([{ ...action, dueAt: "invalid" }], "en", now).detail, undefined);
  assert.match(emailFollowupBadge([{ ...action, dueAt: new Date(2027, 0, 1, 10).toISOString() }], "en", now).detail!, /2027/);
});

test("the rendered badge has an accessible text status, decorative icon and machine-readable schedule", () => {
  type Element = { type: unknown; props: Record<string, unknown> };
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
  const exports = {} as { EmailFollowupBadge: (props: unknown) => Element };
  const dependencies: Record<string, unknown> = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "lucide-react": { Bell: "bell" },
    "@/lib/email-followup-badge": { emailFollowupBadge },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-followup-badge.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; })(name) });
  const badge = exports.EmailFollowupBadge({ actions: [action], language: "en" });
  assert.equal(badge.type, "span", "Badges must not nest interactive controls in the email-row button");
  assert.match(String(badge.props["aria-label"]), /Manual follow-up/);
  const [label, detail] = badge.props.children as Element[];
  assert.equal((label.props.children as Element[])[0].props["aria-hidden"], "true");
  assert.equal((detail.props.children as Element).type, "time");
  assert.equal((detail.props.children as Element).props.dateTime, dueAt);
});
