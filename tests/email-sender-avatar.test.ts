import assert from "node:assert/strict";
import test from "node:test";
import { companyPortrait } from "../lib/company-avatar.ts";
import { emailSenderAvatar } from "../lib/email-sender-avatar.ts";

test("linked customers keep their company portrait instead of receiving a sender-domain logo", () => {
  const avatar = emailSenderAvatar({ companyId: "company-123", email: "buyer@gmail.com", name: "Gabriel de Camargo" });
  assert.equal(avatar.kind, "company"); assert.equal(avatar.src, companyPortrait("company-123")); assert.equal(avatar.initials, "GD");
});

test("business sender subdomains resolve to the organization's public domain", () => {
  for (const [email, domain] of [
    ["OpenAI <noreply@tm.openai.com>", "openai.com"], ["service@intl.paypal.com", "paypal.com"],
    ["mailer@shopify.com", "shopify.com"], ["news@mail.bbc.co.uk", "bbc.co.uk"],
    ["notice@qiye.163.com", "163.com"], ["notice@tenant.github.io", "tenant.github.io"],
  ]) {
    const avatar = emailSenderAvatar({ email });
    assert.equal(avatar.kind, "brand", email);
    const url = new URL(avatar.src!);
    assert.equal(url.hostname, "www.google.com"); assert.equal(url.searchParams.get("domain"), domain);
    assert.equal(avatar.src!.includes("@"), false, "Never send the personal email address to the image service");
  }
});

test("personal and unidentified senders use initials, never invented portraits or their mailbox provider's logo", () => {
  for (const email of ["someone@gmail.com", "person@hotmail.com", "person@qq.com", "person@163.com", "person@proton.me"]) {
    const avatar = emailSenderAvatar({ email, name: "Jane Doe" });
    assert.equal(avatar.kind, "initials"); assert.equal(avatar.src, undefined); assert.equal(avatar.initials, "JD");
  }
  assert.equal(emailSenderAvatar({ email: "jane.doe@gmail.com" }).initials, "JD");
  assert.equal(emailSenderAvatar({ email: "noreply@example.com", name: "OpenAI" }).initials, "OP");
});

test("invalid, local and IP addresses never trigger a brand lookup", () => {
  for (const email of ["", "broken", "a@localhost", "a@127.0.0.1", "a@[::1]", "a@brand.invalid", "a@co.uk", "a@brand.com/path", "a@brand.com?email=private", "a@brand.com:443", "a@brand.com\nprivate"]) {
    const avatar = emailSenderAvatar({ email });
    assert.equal(avatar.src, undefined, email);
  }
  const spoof = new URL(emailSenderAvatar({ email: "noreply@openai.com.attacker.org", name: "OpenAI" }).src!);
  assert.equal(spoof.searchParams.get("domain"), "attacker.org", "A display name or embedded brand name cannot select an unrelated logo");
});
