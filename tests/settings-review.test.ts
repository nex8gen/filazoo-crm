import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../lib/ai-policy.ts";
import { translateUiText } from "../lib/i18n.ts";
import * as apps from "../lib/connection-apps.ts";
import * as connections from "../lib/email-connections.ts";
import * as status from "../lib/app-connection-status.ts";

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props };
function find(tree: unknown, match: (element: Element) => boolean): Element | undefined {
  if (!tree || typeof tree !== "object") return;
  if (Array.isArray(tree)) return tree.map(child => find(child, match)).find(Boolean);
  const element = tree as Element;
  return match(element) ? element : find(element.props?.children, match);
}

function harness(file: string, name: string, props: Props, overrides: Props = {}) {
  const slots: unknown[] = [];
  let cursor = 0, busy = false, guarded = false;
  let work = Promise.resolve();
  const element = (type: unknown, props: Props) => ({ type, props });
  function useState(initial: unknown) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  }
  const dependencies: Props = {
    react: {
      useState,
      useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useTransition: () => [busy, (callback: () => Promise<void>) => { busy = true; work = callback().finally(() => { busy = false; }); }],
      useActionState(action: (previous: unknown, form: FormData) => Promise<unknown>, initial: unknown) {
        const [state, setState] = useState(initial) as [unknown, (value: unknown) => void];
        return [state, async (form: FormData) => setState(await action(state, form)), false];
      },
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "next/link": { default: "a" },
    "lucide-react": new Proxy({}, { get: (_, name) => String(name) }),
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": { Input: "input" },
    "@/components/ui/label": { Label: "label" },
    "@/components/ui/badge": { Badge: "badge" },
    "@/components/ui/switch": { Switch: "switch" },
    "@/components/ui/notification-toast": { NotificationToast: "toast" },
    "@/components/connection-app-logo": { ConnectionAppLogo: "logo" },
    "@/lib/ai-policy": policy,
    "@/lib/connection-apps": apps,
    "@/lib/email-connections": connections,
    "@/lib/app-connection-status": status,
    "./use-unsaved-settings": { useUnsavedSettings: (dirty: boolean) => { guarded = dirty; } },
    "@/components/workspace-memory": { useWorkspaceState: (_key: string, initial: unknown) => useState(initial) },
    ...overrides,
  };
  const exports: Record<string, (props: Props) => unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (key: string) => {
    assert.ok(key in dependencies, `Unexpected dependency: ${key}`);
    return dependencies[key];
  }, FormData });
  const render = () => { cursor = 0; return exports[name](props); };
  const control = (match: (element: Element) => boolean) => {
    const result = find(render(), match);
    assert.ok(result, "Expected control to exist");
    return result;
  };
  return {
    render, control, done: () => work,
    guarded() { render(); return guarded; },
    click(label: string) { (control(element => element.type === "button" && element.props.children === label).props.onClick as () => void)(); },
    change(id: string, value: string) { (control(element => element.props?.id === id).props.onChange as (event: unknown) => void)({ target: { value } }); },
    async submit() {
      const form = control(element => element.type === "form");
      let prevented = false;
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault() { prevented = true; } });
      if (!prevented && typeof form.props.action === "function") {
        const data = new FormData();
        const selected = find(form, element => element.props?.name === "userId");
        if (selected) data.set("userId", String(selected.props.value));
        await form.props.action(data);
      }
      return prevented;
    },
  };
}

test("ownership transfer requires a selected member and a separate confirmation", async () => {
  const writes: string[] = [];
  const form = harness("app/settings/team-workspace-controls.tsx", "TransferOwnershipForm", { members: [{ id: "teammate", name: "Teammate" }] }, {
    "./team-actions": { transferWorkspaceOwnership: async (_: unknown, data: FormData) => { writes.push(String(data.get("userId"))); return { success: "Transferred" }; } },
  });
  assert.equal(await form.submit(), true);
  form.change("new-owner", "teammate");
  assert.equal(await form.submit(), true, "Enter cannot bypass the review step");
  form.click("Transfer ownership");
  form.click("Cancel");
  assert.equal(await form.submit(), true);
  assert.deepEqual(writes, []);
  form.click("Transfer ownership");
  assert.equal(await form.submit(), false);
  assert.deepEqual(writes, ["teammate"]);
});

test("leaving a workspace requires confirmation and cancellation performs no action", async () => {
  let writes = 0;
  const form = harness("app/settings/team-workspace-controls.tsx", "LeaveWorkspaceForm", {}, {
    "./team-actions": { leaveWorkspace: async () => { writes++; return { error: "Controlled failure" }; } },
  });
  assert.equal(await form.submit(), true);
  form.click("Leave workspace"); form.click("Cancel");
  assert.equal(await form.submit(), true);
  assert.equal(writes, 0);
  form.click("Leave workspace");
  assert.equal(await form.submit(), false);
  assert.equal(writes, 1);
});

test("requiring AI review preserves denied actions, disabled access and business guidance", async () => {
  const original = policy.defaultAiPolicy();
  original.enabled = false; original.features.email = false; original.data.billing = false;
  original.actions.destructive = "deny"; original.actions.sending = "auto";
  original.businessContext = "Approved company facts"; original.instructions = "Ask about missing facts";
  const writes: Array<{ policy: policy.AiPolicy; revision: number }> = [];
  let finish!: (value: unknown) => void;
  const form = harness("app/settings/ai-settings-form.tsx", "AiSettingsForm", { initial: { policy: original, revision: 7, updatedAt: null }, canManage: true }, {
    "./ai-settings-actions": { updateAiSettings: async (input: { policy: policy.AiPolicy; revision: number }) => { writes.push(input); return new Promise(resolve => { finish = resolve; }); } },
  });
  assert.equal(find(form.render(), element => element.type === "toast"), undefined, "opening a page must not emit a success toast");
  assert.equal(form.guarded(), false);
  form.click("Require approval for allowed actions");
  assert.equal(form.guarded(), true);
  const submit = form.control(element => element.type === "form").props.onSubmit as (event: unknown) => void;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.equal(writes.length, 1, "duplicate submissions cannot reuse a revision");
  assert.equal(writes[0].revision, 7);
  assert.equal(writes[0].policy.actions.sending, "ask");
  assert.equal(writes[0].policy.actions.destructive, "deny");
  assert.equal(writes[0].policy.enabled, false);
  assert.equal(writes[0].policy.features.email, false);
  assert.equal(writes[0].policy.data.billing, false);
  assert.equal(writes[0].policy.businessContext, original.businessContext);
  assert.equal(writes[0].policy.instructions, original.instructions);
  finish({ saved: { policy: writes[0].policy, revision: 8, updatedAt: null } });
  await form.done();
  assert.equal(form.guarded(), false);
});

test("read-only AI policies cannot save even if a submit event is invoked directly", async () => {
  const form = harness("app/settings/ai-settings-form.tsx", "AiSettingsForm", { initial: { policy: policy.defaultAiPolicy(), revision: 1, updatedAt: null }, canManage: false }, {
    "./ai-settings-actions": { updateAiSettings: async () => assert.fail("Read-only policy must not write") },
  });
  assert.equal(form.control(element => element.type === "fieldset").props.disabled, true);
  await form.submit(); await form.done();
});

test("app library opens the right account list and keeps administrator-only apps out of member navigation", () => {
  const form = harness("app/settings/apps-connections.tsx", "AppsConnections", {
    isAdmin: false, connections: { gmail: { status: "connected", personalCount: 0, teamCount: 1 } },
  });
  const gmail = form.control(element => element.type === "button" && element.props["aria-label"] === "View details: Gmail");
  assert.equal((gmail.props.render as Element).props.href, "/settings/apps?view=team");
  assert.equal(find(form.render(), element => element.props?.["aria-label"] === "View details: Lingxing ERP"), undefined);
  const shopify = form.control(element => element.type === "button" && element.props["aria-label"] === "View details: Shopify");
  assert.equal((shopify.props.render as Element).props.href, "/settings/apps/shopify");
});

test("settings descriptions and new confirmation copy have Chinese translations", () => {
  for (const text of ["Choose your language and list preferences.", "Manage your password, sign-in options, and other sessions.", "Manage workspace details and ownership.", "Require approval for allowed actions", "Confirm leave", "Confirm transfer", "AI usage unavailable", "Lead assignment unavailable"]) {
    assert.notEqual(translateUiText(text, "zh-CN"), text, text);
  }
});

test("connection drafts stay protected after a failed save and become clean only after success", async () => {
  for (const [file, component, action] of [
    ["app/settings/settings-forms.tsx", "PersonalMailboxForm", "savePersonalMailbox"],
    ["app/settings/settings-forms.tsx", "WorkspaceMailboxForm", "saveWorkspaceMailbox"],
    ["app/settings/apps/gmail-connection-form.tsx", "GmailConnectionForm", "saveGmailConnection"],
    ["app/settings/apps/netease-connection-form.tsx", "NeteaseConnectionForm", "saveNeteaseConnection"],
  ]) {
    let succeeds = false, writes = 0;
    const actionModule = file.includes("gmail-") ? "./gmail-actions" : file.includes("netease-") ? "./netease-actions" : "./actions";
    const form = harness(file, component, {}, {
      "../use-unsaved-settings": { useUnsavedSettings: (dirty: boolean) => { guarded = dirty; } },
      "@/lib/mail-import": { newMailImportPreferences: {} },
      "@/lib/netease-mail": { neteaseServerProfiles: { standard: { label: "Standard", smtpHost: "smtp.example.test", imapHost: "imap.example.test" } } },
      "@/components/ui/select": {},
      "@/components/email-import-fields": {},
      sonner: {},
      [actionModule]: { [action]: async () => { writes++; return succeeds ? { success: "Saved" } : { error: "Failed" }; } },
    });
    let guarded = false;
    const connectionForm = () => form.control(element => element.type === "form");
    const guard = () => file.includes("settings-forms") ? form.guarded() : (form.render(), guarded);
    assert.equal(guard(), false, component);
    (connectionForm().props.onChangeCapture as () => void)();
    assert.equal(guard(), true, component);
    await (connectionForm().props.action as (form: FormData) => Promise<void>)(new FormData());
    assert.equal(guard(), true, "failure must preserve the dirty draft");
    succeeds = true;
    await (connectionForm().props.action as (form: FormData) => Promise<void>)(new FormData());
    assert.equal(guard(), false, "success clears the guard");
    assert.equal(writes, 2);
  }
});
