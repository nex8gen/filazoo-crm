import assert from "node:assert/strict";
import test from "node:test";
import { emailAddresses, replyRecipients, emailSubject } from "../lib/email-addresses.ts";
import { emailSendSchema, hasEmailDraft } from "../lib/email-workbench.ts";
import { splitQuotedEmailHtml, emailDocument } from "../lib/email-content.ts";
import { providerFolderKind } from "../lib/email-provider.ts";
import { buildMailboxMime } from "../lib/mailer.ts";
import { simpleParser } from "mailparser";

test("reply-all respects Reply-To, preserves other participants, and excludes all of our accounts", () => {
  const message = { direction: "inbound", from: "sender@example.test", contact: "sender@example.test", replyTo: "service@example.test", to: [{ address: "me@example.test" }, { address: "colleague@example.test" }], cc: [{ address: "TEAM@example.test" }, { address: "other@example.test" }, { address: "service@example.test" }] };
  assert.deepEqual(replyRecipients(message, ["me@example.test", "team@example.test"], true), { to: ["service@example.test"], cc: ["colleague@example.test", "other@example.test"] });
  assert.deepEqual(replyRecipients(message, ["me@example.test"], false), { to: ["service@example.test"], cc: [] });
  assert.deepEqual(emailAddresses(" ONE@example.test; two@example.test, one@example.test"), ["one@example.test", "two@example.test"]);
  assert.equal(emailSubject("Re: RE: Fwd: Original subject", "reply"), "Re: Original subject");
});

test("multiple recipients and Cc/Bcc are validated before delivery, including blank subject support", () => {
  const message = emailSendSchema.parse({ to: "a@example.test;b@example.test", cc: "c@example.test", bcc: ["d@example.test"], text: "Hello" });
  assert.deepEqual(message.to, ["a@example.test", "b@example.test"]);
  assert.equal(message.subject, "");
  assert.equal(emailSendSchema.safeParse({ ...message, cc: "bad address" }).success, false);
  assert.equal(emailSendSchema.safeParse({ ...message, to: "a@example.test\r\nBcc: stolen@example.test" }).success, false);
  assert.equal(emailSendSchema.safeParse({ ...message, to: [] }).success, false);
  assert.equal(emailSendSchema.safeParse({ ...message, text: "" }).success, false);
});

test("HTML quote collapsing retains current formatting, links and CID images without discarding quote-only mail", () => {
  const html = '<html><head><style>p{color:red}</style></head><body><p>Latest <strong>answer</strong><img src="cid:logo"></p><div class="gmail_quote"><div>Old message</div></div></body></html>';
  const result = splitQuotedEmailHtml(html);
  assert.equal(result.quoted, true); assert.match(result.current, /<strong>answer<\/strong>/); assert.match(result.current, /cid:logo/); assert.doesNotMatch(result.current, /Old message/);
  const quoteOnly = '<blockquote type="cite">The whole message</blockquote>';
  assert.deepEqual(splitQuotedEmailHtml(quoteOnly), { current: quoteOnly, quoted: false });
  const outlook = splitQuotedEmailHtml('<div>My answer</div><div id="divRplyFwdMsg">From: old@example.test</div><div>Old body</div>');
  assert.doesNotMatch(outlook.current, /Old body|From:/);
  assert.match(emailDocument(html, false), /img-src 'self' data: blob:;/);
});

test("footer-only replies do not become drafts but image-only and attachment drafts are retained", () => {
  const draft = { text: "Signature", bodyText: "", html: '<section data-email-footer="true"><img src="data:image/png;base64,AAAA"></section>', attachments: [], kind: "reply" as const, to: "buyer@example.test", cc: "", bcc: "", subject: "Subject" };
  assert.equal(hasEmailDraft(draft), false);
  assert.equal(hasEmailDraft({ ...draft, html: '<img src="data:image/png;base64,AAAA">' }), true);
  assert.equal(hasEmailDraft({ ...draft, kind: "compose" }), true);
});

test("provider folder discovery uses special-use flags and recognizes localized mailboxes", () => {
  assert.equal(providerFolderKind("[Gmail]/Sent Mail", ["\\Sent"]), "sent");
  assert.equal(providerFolderKind("已发送", []), "sent");
  assert.equal(providerFolderKind("垃圾邮件", []), "spam");
  assert.equal(providerFolderKind("Customers", []), "custom");
});

test("the provider Sent copy preserves all recipient headers and the exact MIME attachment", async () => {
  const raw = await buildMailboxMime("me@example.test", { to: ["one@example.test", "two@example.test"], cc: ["cc@example.test"], bcc: ["bcc@example.test"], subject: "Hello", text: "Body", messageId: "<stable@example.test>", attachments: [{ filename: "document.pdf", content: Buffer.from("%PDF-test"), contentType: "application/pdf" }] });
  const parsed = await simpleParser(raw);
  assert.equal(parsed.messageId, "<stable@example.test>");
  assert.equal((Array.isArray(parsed.to) ? parsed.to[0] : parsed.to)?.value.length, 2);
  assert.equal((Array.isArray(parsed.bcc) ? parsed.bcc[0] : parsed.bcc)?.value[0].address, "bcc@example.test");
  assert.equal(parsed.attachments[0].content.toString(), "%PDF-test");
});
