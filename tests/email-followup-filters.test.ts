import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { conversationFollowupActions, followupConversationFilters, followupView, indexFollowupActions, updateFollowupActions, type FollowupActionRecord, type FollowupFilter } from "../lib/email-followup-filters.ts";
import type { EmailFollowup } from "../lib/email-followup.ts";

const messages = [{ id: "crm-inquiry", messageId: null, threadId: "local:crm-inquiry" }];
const record: FollowupActionRecord = { id: "action", source: "followup", kind: "ai", status: "scheduled", messageKey: "crm-inquiry", threadKey: "local:crm-inquiry", anchors: ["local:crm-inquiry"], updatedAt: "2026-11-11T08:00:00Z" };
function filters(records: FollowupActionRecord[]) {
  return [...followupConversationFilters(messages, indexFollowupActions(records))].sort();
}
test("saved AI actions, manual reminders and completed tasks use their actual states", () => {
  assert.deepEqual(filters([record]), ["ai"]);
  assert.deepEqual(filters([{ ...record, kind: "reminder" }]), ["manual"]);
  for (const status of ["failed", "uncertain", "waiting_shipping", "needs_review"]) assert.deepEqual(filters([{ ...record, status }]), ["manual"], status);
  for (const status of ["sent", "cancelled"]) assert.deepEqual(filters([{ ...record, status }]), ["completed"], status);
  assert.deepEqual(filters([{ ...record, kind: "reminder", status: "reminded", taskStatus: "done" }]), ["completed"]);
  assert.deepEqual(filters([{ ...record, source: "auto-reply", status: "active", enabled: true }]), []);
  assert.deepEqual(filters([{ ...record, source: "auto-reply", status: "paused", enabled: false }]), []);
});
test("dormant nurture requires explicit action enrollment; a dormant customer tag cannot enroll anyone", () => {
  for (const tag of ["Inactive Customers", "Long-term Inactive Customers"]) {
    const tagged = [{ ...messages[0], category: tag }];
    assert.deepEqual([...followupConversationFilters(tagged, indexFollowupActions([record]))], ["ai"]);
    assert.equal(followupConversationFilters(tagged, indexFollowupActions([])).size, 0);
  }
  assert.deepEqual(filters([{ ...record, purpose: "nurture" }]), ["nurture"]);
  assert.deepEqual(filters([{ ...record, purpose: "nurture", status: "sent" }]), ["completed"]);
  assert.deepEqual(filters([{ ...record, purpose: "nurture", status: "failed" }]), ["manual"]);
  assert.deepEqual(filters([]), []);
  assert.deepEqual(filters([{ ...record, kind: "reminder" }]), ["manual"]);
  assert.deepEqual(filters([{ ...record, status: "sent" }]), ["completed"]);
});
test("legacy follow-up dates do not enroll emails or create reminder badges", () => {
  const legacy = [{ ...messages[0], followUpAt: "2026-11-12T08:00:00Z" }];
  const index = indexFollowupActions([]);
  assert.equal(followupConversationFilters(legacy, index).size, 0);
  assert.deepEqual(conversationFollowupActions(legacy, index), []);
  assert.deepEqual(filters([{ ...record, id: "old", status: "cancelled" }, record]), ["ai"]);
  assert.deepEqual([...followupConversationFilters(legacy, indexFollowupActions([{ ...record, status: "sent" }]))], ["completed"]);
});
test("a reply and its original resolve to the same action, without counting unrelated conversations", () => {
  const action = { ...record, messageKey: "provider-original", threadKey: "message:<root@example.test>", anchors: ["<root@example.test>"] };
  const index = indexFollowupActions([action]);
  assert.deepEqual([...followupConversationFilters([{ id: "provider-reply", messageId: "<reply@example.test>", references: ["<root@example.test>"] }], index)], ["ai"]);
  assert.equal(followupConversationFilters([{ id: "unrelated", messageId: "<other@example.test>" }], index).size, 0);
  assert.equal(followupConversationFilters([], index).size, 0);
});
test("All includes only enrolled conversations and counts respect the search/source scope", () => {
  const groups = new Map<string, Set<Exclude<FollowupFilter, "all">>>([
    ["sent-ai", new Set(["ai"])], ["inbox-manual", new Set(["manual"])], ["sent-nurture", new Set(["nurture"])], ["ended", new Set(["completed"])],
  ]);
  const sent = [{ id: "sent-ai" }, { id: "sent-nurture" }, { id: "ended" }, { id: "sent-without-action" }];
  assert.deepEqual(followupView(sent, groups, "all").counts, { all: 3, ai: 1, manual: 0, completed: 1, nurture: 1 });
  assert.deepEqual(followupView(sent, groups, "all").conversations, sent.slice(0, 3));
  assert.deepEqual(followupView(sent, groups, "ai").conversations, [{ id: "sent-ai" }]);
  assert.deepEqual(followupView(sent, groups, "nurture").conversations, [{ id: "sent-nurture" }]);
  assert.deepEqual(followupView(sent.filter(item => item.id === "ended"), groups, "all").counts, { all: 1, ai: 0, manual: 0, completed: 1, nurture: 0 });
});

test("confirmed panel actions immediately move the conversation between action tabs without duplicates", () => {
  const saved: EmailFollowup = { id: "saved-reminder", revision: 1, kind: "reminder", status: "scheduled", due_at: "2026-11-12T10:00:00Z", subject: "Quote", body: "", error: null, task_id: "task" };
  let actions: FollowupActionRecord[] = [];
  const views = () => {
    const index = indexFollowupActions(actions);
    return new Map([["conversation", followupConversationFilters(messages, index)]]);
  };
  const conversations = [{ id: "conversation" }, { id: "unrelated" }];
  assert.deepEqual(followupView(conversations, views(), "all").conversations, []);
  for (const [patch, expected] of [
    [{}, "manual"], [{ kind: "ai" }, "ai"], [{ kind: "ai", purpose: "nurture" }, "nurture"],
    [{ kind: "ai", status: "sent" }, "completed"], [{ status: "cancelled" }, "completed"],
    [{ revision: 2 }, "manual"],
  ] as Array<[Partial<EmailFollowup>, Exclude<FollowupFilter, "all">]>) {
    actions = updateFollowupActions(actions, { ...saved, ...patch }, messages);
    assert.equal(actions.length, 1);
    assert.deepEqual([...views().get("conversation")!], [expected]);
    assert.equal(followupView(conversations, views(), expected).counts.all, 1);
    assert.deepEqual(followupView(conversations, views(), expected).conversations, [{ id: "conversation" }]);
    assert.equal(conversationFollowupActions(messages, indexFollowupActions(actions))[0].dueAt, saved.due_at);
  }
});
test("each filter button switches its selected action and reports the selected state", () => {
  type Element = { type: unknown; props: Record<string, unknown> };
  const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });
  const exports = {} as { EmailFollowupFilters: (props: unknown) => Element };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/email-followup-filters.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {} });
  let selected: string | null = null;
  const render = () => exports.EmailFollowupFilters({ value: selected, onChange: (value: string) => { selected = value; }, counts: { all: 4, ai: 2, manual: 1, completed: 1, nurture: 1 }, loading: false });
  function buttons(tree: Element) { return (tree.props.children as Element[][])[0]; }
  assert.ok(buttons(render()).every(button => button.props["aria-pressed"] === false), "Ordinary inbox folders do not select a follow-up tab");
  for (const [position, expected] of ["all", "ai", "manual", "completed", "nurture"].entries()) {
    (buttons(render())[position].props.onClick as () => void)();
    assert.equal(selected, expected); assert.equal(buttons(render())[position].props["aria-pressed"], true);
  }
});
