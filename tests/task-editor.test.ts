import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as dates from "../lib/company-followup.ts";
import type { ActivityTask } from "../lib/task-activity.ts";
import { setImmediate } from "node:timers/promises";
const actorId = "a1111111-1111-4111-8111-111111111111";
const teammateId = "b2222222-2222-4222-8222-222222222222";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}
function editor(task?: ActivityTask) {
  const state: unknown[] = [];
  const effects: Array<() => unknown> = [];
  let cursor = 0, saved = 0, fail = false, replyMode = "normal";
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  const react = {
    useState(initial: unknown) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value: unknown) => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
    useRef(initial: unknown) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
    useEffect(effect: () => unknown) { const i = cursor++; if (!state[i]) { state[i] = true; effects.push(effect); } },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const dependencies: Record<string, unknown> = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "lucide-react": {},
    "@/components/ui/button": { Button: "button" }, "@/components/ui/dialog": {}, "@/lib/company-followup": dates,
    "@/components/ui/date-picker": { DatePicker: "date-picker" },
    "./task-assignee-picker": { TaskAssigneePicker: "assignee-picker" },
  };
  const exports = {} as { TaskEditor: (props: unknown) => Element };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../components/task-editor.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => dependencies[name], crypto, AbortController,
    fetch: async (_url: unknown, init: RequestInit) => {
      if (!init.method) return Response.json({ ok: true, viewerId: actorId, members: [{ id: actorId, name: "Current user", role: "admin" }, { id: teammateId, name: "Teammate", role: "operator" }] });
      const body = JSON.parse(String(init.body)); requests.push({ method: init.method!, body }); return Response.json(fail ? { error: "Task changed. Refresh before retrying." } : { ok: true, version: replyMode === "old" ? 1 : 2, task: { assigned_to: replyMode === "wrong" ? actorId : body.assignedTo ?? task?.assigned_to ?? actorId } }, { status: fail ? 409 : 200 });
    },
  });
  const render = () => { cursor = 0; return exports.TaskEditor({ task, viewerId: actorId, onClose() {}, onSaved() { saved++; } }); };
  const ready = async () => { render(); for (const effect of effects.splice(0)) effect(); await setImmediate(); };
  return { render, ready, requests, saved: () => saved, fail() { fail = true; }, unsafeReply(mode: string) { replyMode = mode; },
    submit: async () => { await ready(); const form = elements(render()).find(element => element.type === "form")!; await (form.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {} }); },
  };
}

test("task editor exposes a real submit control and submits new tasks through the form", async () => {
  const app = editor();
  await app.ready();
  let tree = elements(app.render());
  const submit = tree.find(element => element.type === "button" && element.props.type === "submit");
  assert.ok(submit, "Base UI buttons default to type=button; saving requires an explicit submit type");
  assert.equal(submit.props.disabled, true);
  const title = tree.find(element => element.type === "input" && element.props.maxLength === 200)!;
  (title.props.onChange as (event: unknown) => void)({ target: { value: "Call buyer" } });
  tree = elements(app.render());
  assert.equal(tree.find(element => element.type === "button" && element.props.type === "submit")!.props.disabled, false);
  await app.submit();
  assert.equal(app.requests[0].method, "POST");
  assert.equal((app.requests[0].body.task as Record<string, unknown>).title, "Call buyer");
  assert.equal(app.saved(), 1);
});

test("an older API or wrong saved recipient cannot be reported as a successful assignment", async () => {
  for (const mode of ["old", "wrong"]) {
    const app = editor(); await app.ready(); app.unsafeReply(mode);
    const tree = elements(app.render());
    (tree.find(element => element.type === "assignee-picker")!.props.onChange as (id: string) => void)(teammateId);
    (tree.find(element => element.type === "input" && element.props.maxLength === 200)!.props.onChange as (event: unknown) => void)({ target: { value: "Team task" } });
    await app.submit();
    assert.equal(app.saved(), 0); assert.ok(elements(app.render()).some(element => element.props.role === "alert"));
  }
});

test("the editor sends the selected teammate and preserves long review evidence", async () => {
  const app = editor(); await app.ready();
  let tree = elements(app.render());
  (tree.find(element => element.type === "assignee-picker")!.props.onChange as (id: string) => void)(teammateId);
  (tree.find(element => element.type === "input" && element.props.maxLength === 200)!.props.onChange as (event: unknown) => void)({ target: { value: "Team follow-up" } });
  await app.submit();
  assert.equal(app.requests[0].body.assignedTo, teammateId);
  const context = editor({ id: "task", title: "Review reply", notes: "Evidence ".repeat(2000), assigned_to: actorId, company_id: null, due_at: null, updated_at: "revision", priority: "normal" });
  await context.ready(); tree = elements(context.render());
  assert.equal(tree.find(element => element.type === "textarea")!.props.readOnly, true);
  await context.submit();
  assert.ok(!("notes" in (context.requests[0].body.changes as object)), "Unchanged evidence must not be truncated or rejected by the editable-notes limit");
});

test("editing preserves an unchanged exact due time and the saved revision", async () => {
  const task = { id: "task", title: "Follow up", notes: "Context", priority: "normal", due_at: "2026-10-30T01:30:45.123Z", company_id: null, updated_at: "saved revision", status: "open" };
  const app = editor(task);
  await app.submit();
  assert.equal(app.requests[0].body.expectedUpdatedAt, "saved revision");
  assert.ok(!("dueAt" in (app.requests[0].body.changes as object)), "Opening datetime-local must not silently round away stored seconds");
  assert.equal(app.requests[0].method, "PATCH");
});

test("company linkage remains protected and a failed save stays visible with the same retry ID", async () => {
  const task = { id: "task", title: "Follow up", notes: "Company purchase analysis: internal-key", priority: "normal", due_at: null, company_id: "company", updated_at: "revision", status: "open" };
  const linked = editor(task); await linked.submit();
  assert.ok(!("notes" in (linked.requests[0].body.changes as object)));
  const app = editor(); app.fail();
  await app.submit(); await app.submit();
  assert.equal(app.saved(), 0);
  assert.equal(app.requests[0].body.requestId, app.requests[1].body.requestId);
  assert.ok(elements(app.render()).some(element => element.props.role === "alert"));
});
