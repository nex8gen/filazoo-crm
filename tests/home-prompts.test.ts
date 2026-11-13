import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { homePrompts } from "../lib/home-prompts.ts";
import { homePromptResponseInstruction } from "../lib/ai/home-prompts.ts";
import { buildWorkspaceAssistantPrompt, workspaceAssistantSchema } from "../lib/ai/workspace-assistant.ts";
import { zhCNHome } from "../lib/i18n-home.ts";

const require = createRequire(import.meta.url);
type Element = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object") return [];
  const element = value as Element;
  return [element, ...elements(element.props?.children)];
}

test("every visible starter has a translated label and a bounded assistant request in both modes", () => {
  assert.equal(new Set(homePrompts.map(item => item.id)).size, 8);
  assert.equal(homePrompts.filter(item => item.placement === "card").length, 4);
  assert.equal(homePrompts.filter(item => item.placement === "chip").length, 4);
  for (const starter of homePrompts) {
    assert.ok(zhCNHome[starter.label], starter.label);
    if (starter.placement === "card") assert.ok(zhCNHome[starter.description]);
    for (const mode of ["analyze", "work"] as const) {
      const input = workspaceAssistantSchema.parse({ mode, pathname: "/", pageLabel: "Home", pageText: "", messages: [{ role: "user", content: starter.prompt }] });
      const prompt = buildWorkspaceAssistantPrompt(input);
      assert.ok(prompt.includes("HOME_PROMPT_RESPONSE_GUIDANCE"), `${mode}: ${starter.label}`);
      assert.match(prompt, /permission-scoped CRM lookups/);
      assert.match(prompt, /coverage is incomplete/);
      assert.match(prompt, /recommendations do not authorize changes or sending/);
    }
    assert.equal(homePromptResponseInstruction(`  ${starter.label.toUpperCase()}?  `), homePromptResponseInstruction(starter.prompt), "typing a card title receives the same guidance");
  }
});

test("homepage text, previous requests and partial matches cannot select unrelated response guidance", () => {
  const input = workspaceAssistantSchema.parse({ mode: "analyze", pathname: "/", pageLabel: "Home", pageText: homePrompts.map(item => item.label).join("\n"), messages: [
    { role: "user", content: homePrompts[0].prompt }, { role: "assistant", content: "What is the campaign goal?" }, { role: "user", content: "Explain how quotations work." },
  ] });
  assert.ok(!buildWorkspaceAssistantPrompt(input).includes("HOME_PROMPT_RESPONSE_GUIDANCE"));
  assert.equal(homePromptResponseInstruction("Do not plan a campaign"), "");
  assert.equal(homePromptResponseInstruction(`${homePrompts[0].prompt} Send it now.`), "", "edits remain the user's own request");
});

test("response guidance covers payment, quotation, inventory and drafting edge cases", () => {
  assert.match(homePromptResponseInstruction("Find overdue invoices"), /due today is not overdue/);
  assert.match(homePromptResponseInstruction("Find overdue invoices"), /total_minor minus paid_minor/);
  assert.match(homePromptResponseInstruction("Follow up on quotations"), /Check customer messages before claiming there has been no reply/);
  assert.match(homePromptResponseInstruction("Check product stock"), /missing snapshot as zero stock/);
  assert.match(homePromptResponseInstruction("Draft a customer reply"), /Do not choose a random recent customer/);
  assert.match(homePromptResponseInstruction("Plan a campaign"), /\/email\/campaigns/);
});

function composerFixture() {
  const slots: unknown[] = [];
  let cursor = 0;
  const launches: unknown[] = [];
  const react = {
    useRef: () => ({ current: null }),
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = value; }];
    },
  };
  const ui = new Proxy({}, { get: () => () => null });
  const dependencies: Record<string, unknown> = {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "lucide-react": ui,
    "@/components/ai-icon": ui, "@/components/agent-icon": ui,
    "@/components/home-prompt-icon": ui,
    "@/components/ui/button": ui, "@/components/ui/popover": ui,
    "@/lib/ai/launch": { launchWorkspaceAi: (detail: unknown) => launches.push(detail) },
    "@/lib/home-prompts": { homePrompts },
  };
  const exports: Record<string, (props: Record<string, unknown>) => unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL("../components/home-ai-composer.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, Intl, Date, require: (name: string) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; } });
  return { launches, exports, render() { cursor = 0; return elements(exports.HomeAiComposer({ name: "Sourav", asOf: "2026-11-13T04:00:00Z" })); } };
}

test("all homepage cards and chips submit the correct prompt once in the selected mode", () => {
  const fixture = composerFixture();
  for (const mode of ["chat", "agent"]) {
    let tree = fixture.render();
    const input = tree.find(element => element.type === fixture.exports.HomeAiInput)!;
    (input.props!.onModeChange as (mode: string) => void)(mode);
    tree = fixture.render();
    const buttons = tree.filter(element => element.type === "button" && /^home-ai-prompt-(card|chip)$/.test(String(element.props?.className)));
    assert.equal(buttons.length, 8);
    for (let index = 0; index < buttons.length; index++) {
      const before = fixture.launches.length;
      (buttons[index].props!.onClick as () => void)();
      assert.equal(fixture.launches.length, before + 1);
      assert.equal(JSON.stringify(fixture.launches.at(-1)), JSON.stringify({ mode, prompt: homePrompts[index].prompt, submit: true }));
    }
  }
});

test("quick-prompt menu fills an editable draft and focuses input without submitting", () => {
  const fixture = composerFixture();
  const changes: string[] = [];
  let focuses = 0;
  const tree = elements(fixture.exports.HomeAiInput({
    id: "test", inputRef: { current: { focus: () => { focuses++; } } }, mode: "chat", onModeChange() {}, value: "", onChange: (value: string) => changes.push(value), onSend() { assert.fail("must not submit from menu"); }, canSend: false,
  }));
  const buttons = tree.filter(element => element.type === "button");
  const menuItems = buttons.filter(element => homePrompts.some(item => item.label === (element.props?.children as Element[] | undefined)?.[1]));
  assert.equal(menuItems.length, 8);
  for (const item of menuItems) (item.props!.onClick as () => void)();
  assert.deepEqual(changes, homePrompts.map(item => item.prompt));
  assert.equal(focuses, 8);
  assert.equal(fixture.launches.length, 0);
});
