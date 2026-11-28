import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as security from "../lib/account-security.ts";

type Props = Record<string, unknown>;
type Element = { type: string; props: Props };

function elements(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== "object") return [];
  const element = tree as Element;
  if (element.type === "Dialog" && !element.props.open) return [];
  return [element, ...elements(element.props?.actions), ...elements(element.props?.children)];
}

function label(tree: unknown): string {
  if (Array.isArray(tree)) return tree.map(label).join("");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (!tree || typeof tree !== "object") return "";
  return label((tree as Element).props?.children);
}

function harness(file: string, name: string, props: Props, overrides: Props) {
  const slots: unknown[] = [];
  let cursor = 0, pending = false;
  let work = Promise.resolve();
  const element = (type: string, props: Props) => ({ type, props });
  const named = new Proxy({}, { get: (_, key) => String(key) });
  const dependencies: Props = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
      useTransition: () => [pending, (callback: () => Promise<void>) => { pending = true; work = callback().finally(() => { pending = false; }); }],
    },
    "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "lucide-react": named,
    "./security-setting": named,
    "@/components/ui/button": { Button: "button" },
    "@/components/ui/input": named,
    "@/components/ui/label": named,
    "@/components/ui/dialog": named,
    "@/components/ui/dropdown-menu": named,
    "@/components/ui/notification-toast": named,
    "@/lib/account-security": security,
    "@/lib/passkey-config": {},
    ...overrides,
  };
  const exports: Record<string, (props: Props) => unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL(`../app/settings/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  const render = () => { cursor = 0; return exports[name](props); };
  return {
    elements: () => elements(render()),
    click(text: string, type = "button", index = 0) {
      const matches = elements(render()).filter(element => element.type === type && label(element.props.children) === text);
      assert.ok(matches[index], `Missing ${type}: ${text}`);
      (matches[index].props.onClick as () => void)();
    },
    async submit() {
      const form = elements(render()).find(element => element.type === "form");
      assert.ok(form);
      (form.props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
      await work;
    },
    done: () => work,
  };
}

const sessions: security.DeviceSession[] = Array.from({ length: 5 }, (_, index) => ({
  id: `session-${index}`, user_agent: "Chrome/1 Windows", ip: `192.0.2.${index}`,
  created_at: "2026-11-20T10:00:00Z", last_active_at: "2026-11-28T10:00:00Z", current: index === 4,
}));

test("device menus preserve confirmation, cancellation and the selected revocation scope", async () => {
  const writes: unknown[] = [];
  const view = harness("device-sessions.tsx", "DeviceSessions", { initialSessions: sessions }, {
    "./security-actions": {
      loadDeviceSessions: async () => ({ sessions }),
      revokeDeviceSessions: async (selection: unknown) => { writes.push(selection); return { success: "Done" }; },
    },
  });
  const rows = () => view.elements().filter(element => element.type === "li");
  assert.equal(rows().length, 3);
  assert.equal(view.elements().find(element => element.props?.id === "device-session-4")?.props.children, "Chrome on Windows");
  view.click("Show all devices5");
  assert.equal(rows().length, 5);
  view.click("Sign out", "DropdownMenuItem");
  assert.equal(writes.length, 0);
  view.click("Cancel");
  assert.equal(view.elements().some(element => element.type === "Dialog"), false);
  view.click("Sign out", "DropdownMenuItem");
  view.click("End session"); await view.done();
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ scope: "one", id: "session-4" }]);
  view.click("Sign out other devices", "DropdownMenuItem");
  view.click("End sessions"); await view.done();
  view.click("End all sessions", "DropdownMenuItem");
  view.click("End sessions"); await view.done();
  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{ scope: "one", id: "session-4" }, { scope: "others" }, { scope: "all" }]);
});

test("passkey removal from the new menu waits for confirmation and supports cancellation", async () => {
  const deleted: string[] = [];
  const view = harness("passkeys.tsx", "Passkeys", { enabled: true, initialPasskeys: [{ id: "key-1", friendly_name: "Laptop", created_at: "2026-11-20T10:00:00Z" }] }, {
    "@/lib/supabase/client": { createClient: () => ({ auth: { passkey: {
      delete: async ({ passkeyId }: { passkeyId: string }) => { deleted.push(passkeyId); return {}; },
      list: async () => ({ data: [] }),
    } } }) },
  });
  view.click("Remove", "DropdownMenuItem");
  assert.deepEqual(deleted, []);
  view.click("Cancel");
  assert.equal(view.elements().some(element => element.type === "Dialog"), false);
  view.click("Remove", "DropdownMenuItem");
  await view.submit();
  assert.deepEqual(deleted, ["key-1"]);
  assert.equal(view.elements().some(element => element.type === "Dialog"), false);
});
