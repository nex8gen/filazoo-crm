import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://crm.test/workspaces/setup" });
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "FormData", "Event"] as const) Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync("app/workspaces/setup/setup-wizard.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
type Result = { error?: string; success?: string; invitationUrl?: string };
type Action = (previous: unknown, form: FormData) => Promise<Result>;
async function mount(props = { canInvite: true, canAddCustomer: true }, overrides: Partial<Record<string, Action>> = {}) {
  const calls: { operation: string; values: Record<string, FormDataEntryValue> }[] = [];
  const stub = (operation: string): Action => async (previous, form) => {
    calls.push({ operation, values: Object.fromEntries(form) });
    return overrides[operation]?.(previous, form) ?? { success: "Saved", ...(operation === "invite" ? { invitationUrl: "https://crm.test/join/private-token" } : {}) };
  };
  const dependencies: Record<string, unknown> = {
    "next/link": { default: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement("a", rest, children) },
    "./setup-wizard.module.css": { default: {} },
    "@/app/settings/team-actions": { createTeamInvitation: stub("invite") },
    "@/app/settings/apps/gmail-actions": { saveGmailConnection: stub("gmail") },
    "@/app/settings/apps/netease-actions": { saveNeteaseConnection: stub("netease") },
    "@/app/settings/actions": { savePersonalMailbox: stub("smtp") },
    "@/app/crm-actions": { createCompany: stub("customer") },
  };
  const exports: { SetupWizard?: React.ComponentType<typeof props & { workspaceName: string }> } = {};
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name] ?? require(name), navigator });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await React.act(async () => root.render(React.createElement(exports.SetupWizard!, { ...props, workspaceName: "Test workspace" })));
  return {
    host, calls,
    async rerender(nextProps: typeof props) { await React.act(async () => root.render(React.createElement(exports.SetupWizard!, { ...nextProps, workspaceName: "Test workspace" }))); },
    title: () => host.querySelector("h1")!.textContent,
    async edit(name: string, value: string) {
      await React.act(async () => {
        const input = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
        const prototype = input.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new dom.window.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
      });
    },
    async click(text: string) {
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === text);
      assert.ok(button, text);
      await React.act(async () => button.click());
    },
    async submit() { await React.act(async () => host.querySelector("form")!.requestSubmit()); },
    async dispose() { await React.act(async () => root.unmount()); host.remove(); },
  };
}

test("setup starts with the first permitted form and skipping never saves data", async () => {
  const ui = await mount({ canInvite: false, canAddCustomer: false });
  try {
    assert.equal(ui.title(), "Connect your email");
    assert.equal(ui.host.querySelector('[role="tab"]'), null);
    assert.equal(ui.host.querySelector('a[href="/settings/apps"]'), null);
    await ui.edit("email", "draft@example.com");
    await ui.click("Skip for now");
    assert.equal(ui.title(), "You're ready to go");
    assert.equal(ui.host.querySelector('a[href="/analytics"]')?.textContent, "Open your CRM");
    await ui.click("Back");
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="email"]')!.value, "draft@example.com");
    assert.equal(ui.calls.length, 0);
  } finally { await ui.dispose(); }
});

test("inline setup creates an invitation, connects email, creates a customer and preserves completed steps on Back", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.title(), "Invite your team");
    await ui.edit("displayName", "Alex Morgan");
    await ui.edit("email", "alex@example.com");
    await ui.submit();
    assert.equal(ui.title(), "Invite your team");
    assert.equal(ui.host.querySelector<HTMLInputElement>('input[readonly]')!.value, "https://crm.test/join/private-token");
    await ui.rerender({ canInvite: false, canAddCustomer: true });
    assert.equal(ui.title(), "Invite your team", "capacity revalidation must not change the active step");
    await ui.click("Next");
    assert.equal(ui.title(), "Connect your email");
    await ui.edit("email", "sales@gmail.com");
    await ui.edit("password", "abcdefghijklmnop");
    await ui.submit();
    assert.equal(ui.title(), "Add your first customer");
    await ui.click("Back");
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="email"]')!.value, "sales@gmail.com");
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="password"]')!.value, "");
    assert.equal(ui.host.querySelector('fieldset')!.disabled, true);
    await ui.click("Next");
    await ui.edit("name", "Acme Industries");
    await ui.edit("country", "China");
    await ui.edit("segment", "Wholesale");
    await ui.submit();
    assert.equal(ui.title(), "You're ready to go");
    assert.deepEqual(ui.calls.map(call => call.operation), ["invite", "gmail", "customer"]);
    assert.equal(ui.calls[1].values.appPassword, "abcdefghijklmnop");
    assert.equal(ui.calls[1].values.mailboxScope, "personal");
    assert.deepEqual(JSON.parse(String(ui.calls[1].values.syncPreferences)), { historyLimit: 500, historyFolders: "inbox_sent", historyPaused: false });
    assert.equal(ui.calls[2].values.name, "Acme Industries");
    assert.equal(ui.calls[2].values.contactRole, "");
    await ui.click("Back");
    await ui.click("Next");
    assert.equal(ui.calls.length, 3);
  } finally { await ui.dispose(); }
});

test("failed saves remain on the current form with their inputs and server error", async () => {
  const ui = await mount(undefined, { invite: async () => ({ error: "Every included user place is in use." }) });
  try {
    await ui.edit("displayName", "Alex Morgan");
    await ui.edit("email", "alex@example.com");
    await ui.submit();
    assert.equal(ui.title(), "Invite your team");
    assert.match(ui.host.querySelector('[role="alert"]')!.textContent!, /user place/);
    assert.equal(ui.host.querySelector<HTMLInputElement>('[name="email"]')!.value, "alex@example.com");
    await ui.click("Skip for now");
    await ui.click("Back");
    assert.equal(ui.title(), "Invite your team");
    assert.equal(ui.calls.length, 1);
  } finally { await ui.dispose(); }
});

test("NetEase and custom email submit the selected transport settings to existing actions", async () => {
  for (const provider of ["netease", "smtp"]) {
    const ui = await mount({ canInvite: false, canAddCustomer: true });
    try {
      await ui.edit("provider", provider);
      await ui.edit("email", "sales@example.com");
      await ui.edit("password", "client-password");
      if (provider === "smtp") {
        await ui.edit("smtpHost", "smtp.example.com");
        await ui.edit("imapHost", "imap.example.com");
      }
      await ui.submit();
      assert.equal(ui.title(), "Add your first customer");
      assert.equal(ui.calls[0].operation, provider);
      const values = ui.calls[0].values;
      if (provider === "netease") {
        assert.equal(values.clientPassword, "client-password");
        assert.equal(values.serverProfile, "standard");
        assert.equal(values.smtpPort, "994");
      } else {
        assert.equal(values.smtpPassword, "client-password");
        assert.equal(values.imapPassword, "client-password");
        assert.equal(values.smtpUsername, "sales@example.com");
        assert.equal(values.imapUsername, "sales@example.com");
      }
    } finally { await ui.dispose(); }
  }
});

test("the setup page checks invitation capacity only for administrators and excludes customer creation for viewers", async () => {
  const pageSource = ts.transpileModule(readFileSync("app/workspaces/setup/page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const [role, canInvite, capacityFails] of [["admin", true, false], ["admin", false, false], ["admin", false, true], ["viewer", false, false], ["operator", false, false]] as const) {
    let checks = 0;
    const dependencies: Record<string, unknown> = {
      "@/lib/auth": { requireWorkspaceMember: async () => ({ role, workspaceId: "workspace", workspaceName: "Test workspace" }) },
      "@/lib/data/team-capacity": { readTeamCapacity: async () => { checks++; if (capacityFails) throw Error("unavailable"); return { canInvite }; } },
      "@/components/onboarding-shell": { OnboardingShell: () => null },
      "./setup-wizard": { SetupWizard: () => null },
    };
    const exports: { default?: () => Promise<React.ReactElement<{ children: React.ReactElement<{ canInvite: boolean; canAddCustomer: boolean }> }>> } = {};
    vm.runInNewContext(pageSource, { exports, require: (name: string) => dependencies[name] ?? require(name) });
    const result = await exports.default!();
    assert.equal(checks, role === "admin" ? 1 : 0);
    assert.equal(result.props.children.props.canInvite, canInvite);
    assert.equal(result.props.children.props.canAddCustomer, role !== "viewer");
    assert.equal(result.props.children.key, "workspace");
  }
});
