import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as settings from "../lib/ai/usage-settings.ts";

const require = createRequire(import.meta.url);
const userId = "a1111111-1111-4111-8111-111111111111";
const otherId = "b2222222-2222-4222-8222-222222222222";
const initial: settings.AiUsageSettingsView = {
  revision: 4, monthlyMicros: 30000000, dailyMicros: null, minimumShares: 5, workspaceDailyMicros: 1000000, monthlyUsedMicros: 795000,
  members: [
    { userId, name: "Administrator", role: "admin", enabled: true, dailyMicros: null, usedMicros: 168000, effectiveDailyMicros: 200000 },
    { userId: otherId, name: "Other member", role: "bd_manager", enabled: true, dailyMicros: null, usedMicros: 14000, effectiveDailyMicros: 200000 },
  ],
};
type Element = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
function find(tree: unknown, match: (element: Element) => boolean): Element | undefined {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) return tree.map(child => find(child, match)).find(Boolean);
  const element = tree as Element;
  return match(element) ? element : find(element.props?.children, match);
}
function savedView(input: settings.AiUsageSettingsInput): settings.AiUsageSettingsView {
  return { ...initial, ...input, revision: input.revision + 1, members: initial.members.map(member => ({ ...member, ...input.members.find(value => value.userId === member.userId) })) };
}
function formHarness(save: (input: settings.AiUsageSettingsInput) => Promise<unknown>) {
  const slots: unknown[] = [];
  let cursor = 0, busy = false;
  let work: Promise<void> = Promise.resolve();
  const dependencies: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useTransition: () => [busy, (callback: () => Promise<void>) => { busy = true; work = callback().finally(() => { busy = false; }); }],
    },
    "lucide-react": { LoaderCircle: () => null },
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/switch": { Switch: "switch" },
    "@/lib/ai/usage-settings": settings,
    "./ai-usage-actions": { updateAiUsageSettings: save },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/settings/ai-usage-settings-form.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { AiUsageSettingsForm?: (props: unknown) => unknown } = {};
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Error, Number, JSON });
  const render = () => { cursor = 0; return exports.AiUsageSettingsForm!({ initial, viewerId: userId }); };
  const control = (id: string) => find(render(), element => element.props?.id === id)!;
  return {
    render, control,
    input(id: string, value: string) { (control(id).props.onChange as (event: unknown) => void)({ target: { value } }); },
    toggle(id: string, enabled: boolean) { (control(id).props.onCheckedChange as (enabled: boolean) => void)(enabled); },
    submit() { (find(render(), element => element.type === "form")!.props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); },
    discard() { (find(render(), element => element.props?.children === "Discard")!.props.onClick as () => void)(); },
    done: () => work,
  };
}

test("all budget fields and every member's toggle and cap reach the save action exactly", async () => {
  const writes: settings.AiUsageSettingsInput[] = [];
  let finish!: (result: unknown) => void;
  const form = formHarness(async input => { writes.push(input); return new Promise(resolve => { finish = resolve; }); });
  assert.equal(find(form.render(), element => element.props?.type === "submit")!.props.disabled, true);
  form.input("ai-monthly-budget", "45.123456");
  form.input("ai-daily-budget", "1.5");
  form.input("ai-shares", "8");
  form.input(`ai-limit-${userId}`, "0.45");
  form.input(`ai-limit-${otherId}`, "0");
  form.toggle(`ai-enabled-${userId}`, false);
  form.toggle(`ai-enabled-${otherId}`, false);
  const submit = find(form.render(), element => element.type === "form")!.props.onSubmit as (event: unknown) => void;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.equal(writes.length, 1, "repeated submit must not save the same revision twice");
  assert.deepEqual(writes[0], { revision: 4, monthlyMicros: 45123456, dailyMicros: 1500000, minimumShares: 8, members: [{ userId, enabled: false, dailyMicros: 450000 }, { userId: otherId, enabled: false, dailyMicros: 0 }] });
  assert.equal(find(form.render(), element => element.type === "fieldset")!.props.disabled, true);
  for (const id of [userId, otherId]) assert.equal(form.control(`ai-enabled-${id}`).props.disabled, true);
  form.input("ai-monthly-budget", "100"); form.discard();
  assert.equal(form.control("ai-monthly-budget").props.value, "45.123456", "events while pending cannot replace the submitted draft");
  finish({ saved: savedView(writes[0]) }); await form.done();
  assert.equal(form.control("ai-monthly-budget").props.value, "45.123456");
  assert.equal(find(form.render(), element => element.props?.role === "status")!.props.children, "AI usage limits saved.");
  assert.equal(find(form.render(), element => element.props?.type === "submit")!.props.disabled, true);
  form.submit(); assert.equal(writes.length, 1, "an unchanged form never writes");
});

test("discard restores every original value without writing, and blank caps remain automatic", async () => {
  const writes: settings.AiUsageSettingsInput[] = [];
  const form = formHarness(async input => { writes.push(input); return { saved: savedView(input) }; });
  form.input("ai-monthly-budget", "40"); form.input("ai-daily-budget", "0"); form.input("ai-shares", "9");
  form.input(`ai-limit-${otherId}`, "0.5"); form.toggle(`ai-enabled-${userId}`, false);
  form.discard();
  for (const [id, value] of [["ai-monthly-budget", "30"], ["ai-daily-budget", ""], ["ai-shares", "5"], [`ai-limit-${otherId}`, ""]]) assert.equal(form.control(id).props.value, value);
  assert.equal(form.control(`ai-enabled-${userId}`).props.checked, true);
  assert.equal(writes.length, 0);
  form.input("ai-monthly-budget", "40"); form.submit(); await form.done();
  assert.equal(writes[0].dailyMicros, null);
  assert.ok(writes[0].members.every(member => member.dailyMicros === null && member.enabled));
  form.input("ai-daily-budget", "0"); form.submit(); await form.done();
  assert.equal(writes[1].dailyMicros, 0);
  assert.equal(writes[1].revision, 5, "a subsequent save uses the returned revision");
});

test("invalid, fractional-share, oversized and sub-microdollar inputs never save", async () => {
  for (const [id, value] of [["ai-monthly-budget", "0"], ["ai-monthly-budget", "1000001"], ["ai-daily-budget", "-1"], ["ai-shares", "0"], ["ai-shares", "1.5"], ["ai-shares", "10001"], [`ai-limit-${otherId}`, "0.0000001"], ["ai-daily-budget", "0.1234567"]]) {
    let writes = 0;
    const form = formHarness(async () => { writes++; return {}; });
    form.input(id, value); form.submit(); await form.done();
    assert.equal(writes, 0, `${id}=${value}`);
    assert.match(String(find(form.render(), element => element.props?.role === "alert")!.props.children), /valid spending limits/);
  }
});

test("save failures preserve edits, release controls, and allow an explicit retry", async () => {
  for (const failure of [() => ({ error: "Unable to save AI usage settings. Please retry." }), () => { throw new Error("offline"); }]) {
    let attempts = 0;
    const form = formHarness(async input => ++attempts === 1 ? failure() : { saved: savedView(input) });
    form.input("ai-monthly-budget", "40"); form.toggle(`ai-enabled-${otherId}`, false);
    form.submit(); await form.done();
    assert.ok(find(form.render(), element => element.props?.role === "alert"));
    assert.equal(form.control("ai-monthly-budget").props.value, "40");
    assert.equal(form.control(`ai-enabled-${otherId}`).props.checked, false);
    assert.equal(form.control(`ai-enabled-${otherId}`).props.disabled, false);
    form.submit(); await form.done();
    assert.equal(attempts, 2);
    assert.equal(find(form.render(), element => element.props?.role === "alert"), undefined);
  }
});

test("a revision conflict preserves the draft and requires reload rather than overwriting another administrator", async () => {
  const message = "AI usage settings changed in another session. Reload this page before saving again.";
  const form = formHarness(async input => { assert.equal(input.revision, 4); return { error: message }; });
  form.input("ai-monthly-budget", "40"); form.submit(); await form.done();
  assert.equal(find(form.render(), element => element.props?.role === "alert")!.props.children, message);
  assert.equal(form.control("ai-monthly-budget").props.value, "40");
  assert.equal(find(form.render(), element => element.props?.role === "status")!.props.children, "Unsaved usage limits");
});

test("USD conversion preserves exact decimals, automatic blanks and explicit zero", () => {
  for (const [raw, expected] of [["", null], ["  ", null], ["0", 0], ["0.1", 100000], ["0.000001", 1], ["1e-6", 1], ["45.123456", 45123456], ["1000000", 1000000000000]] as const) assert.equal(settings.aiUsageAmount(raw), expected);
  for (const raw of ["0.0000001", "1.1234567", "NaN", "Infinity", "invalid"]) assert.ok(Number.isNaN(settings.aiUsageAmount(raw)));
});
