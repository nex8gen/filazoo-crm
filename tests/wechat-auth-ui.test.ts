import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";

function render(providers: string[], signup: boolean, pending = false) {
  const exports: { AuthSocialButtons?: React.ComponentType<Record<string, unknown>> } = {};
  const dependencies: Record<string, unknown> = {
    react: { useActionState: () => [undefined, () => {}, pending] }, "react/jsx-runtime": jsx,
    "next/link": { default: "a" }, "@/components/ui/notification-toast": { NotificationToast: "div" }, "@/app/auth/social-actions": { socialSignIn: () => {} },
  };
  const source = ts.transpileModule(readFileSync("components/auth-social-buttons.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return new JSDOM(renderToStaticMarkup(React.createElement(exports.AuthSocialButtons!, { providers, signup, next: "/join/invite", layout: signup ? "inline" : "tiles" }))).window.document;
}

test("both auth screens keep unavailable providers disabled without visible activation messages", () => {
  for (const signup of [false, true]) {
    const document = render([], signup);
    const button = document.querySelector<HTMLButtonElement>('button[value="wechat"]')!;
    assert.ok(button); assert.equal(button.disabled, true);
    assert.ok(button.querySelector("svg"));
    assert.equal(button.getAttribute("aria-description"), "WeChat sign-in is awaiting activation.");
    assert.doesNotMatch(document.body.textContent || "", /sign-in is awaiting activation/);
    assert.doesNotMatch(document.body.textContent || "", /By continuing, you agree/);
    const alipayButton = document.querySelector<HTMLButtonElement>('button[value="alipay"]');
    assert.ok(alipayButton);
    if (alipayButton) {
      assert.ok(alipayButton.querySelector("svg path"));
      assert.equal(alipayButton.disabled, true);
      assert.equal(alipayButton.getAttribute("aria-description"), "Alipay sign-in is awaiting activation.");
    }
    assert.equal(document.querySelector<HTMLInputElement>('input[name="next"]')?.value, "/join/invite");
  }
});

test("activated WeChat is available alongside existing providers without duplicate buttons or inactive messaging", () => {
  for (const signup of [false, true]) {
    const document = render(["google", "apple", "alipay", "wechat"], signup);
    assert.equal(document.querySelectorAll('button[value="wechat"]').length, 1);
    assert.equal(document.querySelector<HTMLButtonElement>('button[value="wechat"]')?.disabled, false);
    assert.equal(document.querySelectorAll('button[name="provider"]').length, 4);
    assert.equal(document.querySelector("#wechat-activation"), null);
    assert.ok(document.querySelector<HTMLButtonElement>('button[value="wechat"]')?.textContent?.includes("WeChat"));
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[name="provider"]')) assert.equal(button.type, "submit");
  }
});

test("pending OAuth submissions disable all providers to prevent duplicate sign-ins", () => {
  const document = render(["google", "wechat"], false, true);
  assert.equal(document.querySelector("form")?.getAttribute("aria-busy"), "true");
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[name="provider"]')) assert.equal(button.disabled, true);
});
