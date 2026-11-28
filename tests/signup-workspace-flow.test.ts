import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loginDestination } from "../lib/login-destination.ts";
import { passwordSchema, passwordRequirementsError } from "../lib/password.ts";
import { signupDestination } from "../lib/signup.ts";

const require = createRequire(import.meta.url);
const email = "existing@example.test";
const password = "SafePassword123!";

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, unknown> = {};
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => dependencies[name] ?? require(name), URL, URLSearchParams, Object });
  return exports;
}

function recoveryFixture({ session = true, mfa = false, resetError = null as { status: number } | null, updateError = null as { message: string } | null } = {}) {
  let callback = "", signOuts = 0, updates = 0;
  const client = { auth: {
    resetPasswordForEmail: async (address: string, options: { redirectTo: string }) => { assert.equal(address, email); callback = options.redirectTo; return { error: resetError }; },
    exchangeCodeForSession: async (code: string) => { assert.equal(code, "recovery-code"); return { data: { user: { id: "existing", email, email_confirmed_at: "2026-01-01" } }, error: null }; },
    getClaims: async () => ({ data: { claims: session ? { sub: "existing" } : null } }),
    updateUser: async (input: { password: string }) => { assert.equal(input.password, password); updates++; return { error: updateError }; },
    signOut: async () => { signOuts++; },
    signInWithPassword: async (input: { email: string; password: string }) => { assert.equal(input.email, email); assert.equal(input.password, password); return { data: { user: { id: "existing" } }, error: null }; },
  } };
  const dependencies = {
    zod: { z },
    "@/lib/login-destination": { loginDestination },
    "@/lib/password": { passwordSchema, passwordRequirementsError },
    "@/lib/env": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test" } },
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/account-security-server": { readAccountSecurity: async () => ({ requiresMfa: mfa }) },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "next/server": { NextResponse: { redirect: (url: URL) => url } },
  };
  const reset = load("app/forgot-password/actions.ts", dependencies).requestPasswordReset as (state: undefined, form: FormData) => Promise<{ error?: string; success?: string }>;
  const update = load("app/update-password/actions.ts", dependencies).updatePassword as (state: undefined, form: FormData) => Promise<{ error?: string }>;
  const signIn = load("app/login/actions.ts", dependencies).login as (state: undefined, form: FormData) => Promise<unknown>;
  const callbackRoute = load("app/auth/callback/route.ts", dependencies).GET as (request: { nextUrl: URL; url: string }) => Promise<URL>;
  const form = new FormData();
  form.set("email", email); form.set("password", password); form.set("confirmation", password);
  return { form, reset: () => reset(undefined, form), update: () => update(undefined, form), signIn: () => signIn(undefined, form), callback: () => callback, callbackRoute, signOuts: () => signOuts, updates: () => updates };
}

test("password recovery preserves workspace creation and invitation destinations through callback, update, and sign-in", async () => {
  for (const next of ["/workspaces/new", "/join/team-token", "/subscribe?new=1&plan=team"]) {
    const f = recoveryFixture(); f.form.set("next", next);
    assert.ok((await f.reset()).success);
    const callback = new URL(f.callback()); callback.searchParams.set("code", "recovery-code");
    assert.equal(callback.origin, "https://crm.example.test");
    const updatePage = await f.callbackRoute({ nextUrl: callback, url: callback.toString() });
    assert.equal(updatePage.pathname, "/update-password");
    assert.equal(updatePage.searchParams.get("next"), next);
    f.form.set("next", updatePage.searchParams.get("next")!);
    let signInPage: URL | undefined;
    await assert.rejects(f.update(), error => {
      signInPage = new URL((error as Error).message.replace(/^redirect:/, ""), callback.origin);
      return signInPage.pathname === "/login";
    });
    assert.equal(signInPage!.searchParams.get("next"), next);
    assert.match(signInPage!.searchParams.get("message")!, /Password updated/);
    assert.equal(f.signOuts(), 1);
    f.form.set("next", signInPage!.searchParams.get("next")!);
    await assert.rejects(f.signIn(), error => (error as Error).message === `redirect:${next}`);
  }
});

test("recovery sanitizes external destinations at both server actions", async () => {
  for (const next of ["https://attacker.test", "//attacker.test", "/\\attacker.test", "/login?next=/signup"]) {
    const f = recoveryFixture(); f.form.set("next", next);
    await f.reset();
    const updatePath = new URL(new URL(f.callback()).searchParams.get("next")!, "https://crm.example.test");
    assert.equal(updatePath.searchParams.get("next"), "/");
    await assert.rejects(f.update(), error => new URL((error as Error).message.replace(/^redirect:/, ""), "https://crm.example.test").searchParams.get("next") === "/");
  }
});

test("password changes still require a recovery session and successful provider update", async () => {
  const unsigned = recoveryFixture({ session: false });
  assert.match((await unsigned.update()).error!, /valid recovery link/);
  assert.equal(unsigned.updates(), 0); assert.equal(unsigned.signOuts(), 0);
  const failed = recoveryFixture({ updateError: { message: "Password cannot be reused." } });
  assert.match((await failed.update()).error!, /cannot be reused/);
  assert.equal(failed.signOuts(), 0);
  const limited = recoveryFixture({ resetError: { status: 429 } });
  assert.match((await limited.reset()).error!, /wait a minute/);
});

test("password recovery cannot bypass an enrolled authenticator", async () => {
  const f = recoveryFixture({ mfa: true });
  await assert.rejects(f.update(), /redirect:\/auth\/mfa\?next=%2Fupdate-password/);
  assert.equal(f.updates(), 0); assert.equal(f.signOuts(), 0);
});

type Props = Record<string, unknown> & { children?: React.ReactNode };
function renderForm(file: string, name: string, props: Record<string, unknown>, state?: unknown) {
  const h = React.createElement;
  const dependencies: Record<string, unknown> = {
    react: { ...React, useActionState: () => [state, "/test-action", false] },
    "next/link": { default: ({ children, ...props }: Props) => h("a", props, children) },
    "@/components/auth-fields": {
      AuthHeading: ({ children }: Props) => h("h1", {}, children),
      AuthField: ({ label, ...props }: Props) => h("label", {}, String(label), h("input", props)),
      authButtonClass: "auth-button",
    },
    "@/components/ui/notification-toast": { NotificationToast: ({ children }: Props) => h("div", { role: "alert" }, children) },
    "@/components/auth-social-buttons": { AuthSocialButtons: () => null },
    "./passkey-sign-in": { PasskeySignIn: () => null },
    "@/components/ui/button": { Button: ({ render, children }: Props) => React.cloneElement(render as React.ReactElement<Props>, {}, children) },
    "@/components/ui/input": { Input: (props: Props) => h("input", props) },
    "@/components/ui/label": { Label: ({ children, ...props }: Props) => h("label", props, children) },
    "./actions": { signup: () => {}, login: () => {}, requestPasswordReset: () => {}, updatePassword: () => {} },
    "@/lib/supabase/client": { createClient: () => { throw new Error("No live auth calls in form rendering"); } },
  };
  const Component = load(file, dependencies)[name] as React.ComponentType<Record<string, unknown>>;
  return new JSDOM(renderToStaticMarkup(h(Component, props))).window.document;
}

test("existing-account notice presents sign-in and reset links with the account and new workspace destination", () => {
  const document = renderForm("app/signup/signup-form.tsx", "SignupForm", {}, {
    existingAccount: true, email, next: "/workspaces/new", error: "You already have an account. Sign in to create a new workspace.",
  });
  const notice = document.querySelector('[role="alert"]')!;
  assert.match(notice.textContent!, /Sign in to create a new workspace/);
  const links = [...notice.querySelectorAll("a")].map(link => new URL(link.href, "https://crm.example.test"));
  assert.deepEqual(links.map(url => url.pathname), ["/login", "/forgot-password"]);
  for (const url of links) { assert.equal(url.searchParams.get("email"), email); assert.equal(url.searchParams.get("next"), "/workspaces/new"); }
});

test("signup's existing-account link starts a new workspace before a duplicate signup is submitted", () => {
  const document = renderForm("app/signup/signup-form.tsx", "SignupForm", {});
  const link = document.querySelector<HTMLAnchorElement>('a[href^="/login"]')!;
  assert.equal(new URL(link.href, "https://crm.example.test").searchParams.get("next"), "/workspaces/new");
});

test("the account form collects and preserves the company name", () => {
  const document = renderForm("app/signup/signup-form.tsx", "SignupForm", {}, { companyName: "Acme Studio" });
  const company = document.querySelector<HTMLInputElement>('[name="companyName"]')!;
  assert.equal(company.value, "Acme Studio");
  assert.equal(company.autocomplete, "organization");
  assert.equal(company.required, true);
  assert.equal(company.maxLength, 80);
  assert.equal(document.querySelector('[name="workspaceName"]'), null);
});

test("the shared setup progress consistently has Account, Plan and Get started", () => {
  const { AccountSetupProgress } = load("components/account-setup-progress.tsx", { "./account-setup-progress.module.css": { default: {} } });
  for (const current of [1, 2, 3]) {
    const document = new JSDOM(renderToStaticMarkup(React.createElement(AccountSetupProgress as React.ComponentType<{ current: number }>, { current }))).window.document;
    const steps = [...document.querySelectorAll('li')];
    assert.equal(steps.length, 3);
    assert.deepEqual(steps.map(step => step.textContent!.replace(/^\d/, '').trim()), ['Account', 'Plan', 'Get started']);
    assert.equal(steps.findIndex(step => step.getAttribute('aria-current') === 'step'), current - 1);
  }
});

test("already signed-in accounts go directly from signup to a new workspace while preserving invitations", async () => {
  const page = load("app/signup/page.tsx", {
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "@/components/auth-shell": { AuthShell: () => null },
    "@/lib/auth": { getViewer: async () => ({ id: "existing" }) },
    "./signup-form": { SignupForm: () => null },
    "@/lib/signup": { signupDestination },
    "@/lib/auth-providers": { getAuthProviders: async () => [] },
  }).default as (props: { searchParams: Promise<{ next?: string }> }) => Promise<unknown>;
  for (const [next, destination] of [[undefined, "/workspaces/new"], ["/workspaces/new", "/workspaces/new"], ["/join/team-token", "/join/team-token"]]) {
    await assert.rejects(page({ searchParams: Promise.resolve({ next }) }), error => (error as Error).message === `redirect:${destination}`);
  }
});

test("sign-in and recovery forms prefill the account and retain the workspace destination", () => {
  const props = { next: "/workspaces/new", email };
  for (const [file, name] of [["app/login/login-form.tsx", "LoginForm"], ["app/forgot-password/forgot-password-form.tsx", "ForgotPasswordForm"], ["app/update-password/update-password-form.tsx", "UpdatePasswordForm"]]) {
    const document = renderForm(file, name, props);
    assert.equal(document.querySelector<HTMLInputElement>('input[name="next"]')?.value, props.next);
    if (name !== "UpdatePasswordForm") assert.equal(document.querySelector<HTMLInputElement>('input[name="email"]')?.value, email);
    const link = document.querySelector<HTMLAnchorElement>(name === "LoginForm" ? 'a[href^="/forgot-password"]' : 'a[href^="/login"]')!;
    assert.equal(new URL(link.href, "https://crm.example.test").searchParams.get("next"), props.next);
  }
});
