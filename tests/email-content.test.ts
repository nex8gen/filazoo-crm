import assert from "node:assert/strict";
import test from "node:test";
import { emailContentSandbox, emailDocument, resolveEmailContentIds, splitQuotedEmail } from "../lib/email-content.ts";

test("inline signature images and GIFs resolve whole and URI-encoded Content-IDs", () => {
  const html = '<img src="cid:logo-long"><img src="CID:logo"><img src="cid:animation%40mail"><div style="background:url(cid:logo)"></div><img src="cid:missing">';
  const resolved = resolveEmailContentIds(html, [
    { cid: "logo", url: "/api/email/received-attachment?uid=1&part=2" },
    { cid: "logo-long", url: "/api/email/received-attachment?uid=1&part=3" },
    { cid: "<animation@mail>", url: "/api/email/received-attachment?uid=1&part=4" },
  ]);
  assert.equal(resolved, '<img src="/api/email/received-attachment?uid=1&amp;part=3"><img src="/api/email/received-attachment?uid=1&amp;part=2"><img src="/api/email/received-attachment?uid=1&amp;part=4"><div style="background:url(/api/email/received-attachment?uid=1&amp;part=2)"></div><img src="cid:missing">');
  assert.equal(resolveEmailContentIds('<img src="cid:broken%ZZ">', []), '<img src="cid:broken%ZZ">');
});

test("email sandbox allows attachment cookies while keeping scripts and navigation blocked", () => {
  const permissions = emailContentSandbox.split(" ");
  assert.ok(permissions.includes("allow-same-origin"));
  assert.ok(!permissions.includes("allow-scripts"));
  assert.ok(!permissions.includes("allow-forms"));
  assert.ok(!permissions.includes("allow-top-navigation"));
});

test("email documents preserve image URLs and strip active embedded content", () => {
  const html = '<html><head><meta http-equiv="refresh" content="0;url=/settings"></head><body><script>alert(1)</script><iframe src="/settings"></iframe><object data="/settings"></object><embed src="/settings"><img src="/api/email/received-attachment?uid=1&amp;part=2"><img src="https://example.test/banner.gif"><img src="data:image/png;base64,AAAA"></body></html>';
  const document = emailDocument(html);
  assert.doesNotMatch(document, /<(script|iframe|object|embed)\b|http-equiv="refresh"/i);
  assert.match(document, /src="\/api\/email\/received-attachment\?uid=1&amp;part=2"/);
  assert.match(document, /src="https:\/\/example.test\/banner.gif"/);
  assert.match(document, /src="data:image\/png;base64,AAAA"/);
  assert.match(document, /<head><base target="_blank">/);
});

test("keeps a customer's new text above Gmail quoted history", () => {
  const body = "What is the shipping cost?\r\nPlease let me know\r\n\r\nOn Thu, 22 Oct 2026 at 10:05, <sales@test.com> wrote:\r\n\r\nHi, here is our catalog.";
  const split = splitQuotedEmail(body);
  assert.equal(split.current, "What is the shipping cost?\nPlease let me know");
  assert.match(split.quoted!, /here is our catalog/);
});

test("retains ordinary rich email text and quote-only messages", () => {
  const body = "Hello,\nPlease quote 50 spools.\nThanks!";
  assert.deepEqual(splitQuotedEmail(body), { current: body, quoted: null });
  assert.deepEqual(splitQuotedEmail("> Quoted only"), { current: "> Quoted only", quoted: null });
});

test("supports Outlook original-message separators", () => {
  assert.equal(splitQuotedEmail("Thanks\n\n-----Original Message-----\nFrom: buyer@test.com").current, "Thanks");
});
