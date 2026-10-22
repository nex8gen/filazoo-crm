// Capture MIME locally with Nodemailer's stream transport; no mail is sent.
import assert from "node:assert/strict";
import test from "node:test";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { sendMailboxEmail } from "../lib/mailer.ts";

test("normal email preserves plain-text characters and has no reply headers", async () => {
  const createTransport = nodemailer.createTransport;
  const transport = createTransport({ streamTransport: true, buffer: true });
  nodemailer.createTransport = (() => transport) as typeof createTransport;
  try {
    const result = await sendMailboxEmail({ host: "smtp.example.test", user: "sales@example.test", pass: "test-only" }, {
      to: "buyer@example.test", subject: "Normal enquiry", text: "2 < 3 & 5 > 4\nPlease quote <sample> packaging.",
    });
    const parsed = await simpleParser(result.message);
    assert.equal(parsed.text?.trim(), "2 < 3 & 5 > 4\nPlease quote <sample> packaging.");
    assert.equal(parsed.html, false);
    assert.equal(parsed.inReplyTo, undefined);
    assert.equal(parsed.references, undefined);
  } finally { nodemailer.createTransport = createTransport; }
});

test("reply MIME preserves exact parent IDs, recipients, and catalog attachments", async () => {
  const createTransport = nodemailer.createTransport;
  const transport = createTransport({ streamTransport: true, buffer: true });
  nodemailer.createTransport = (() => transport) as typeof createTransport;
  try {
    const result = await sendMailboxEmail({ host: "smtp.example.test", user: "sales@example.test", pass: "test-only" }, {
      to: "shipping@example.test", subject: "Re: Catalog", text: "Here is the catalog.", inReplyTo: "<ParentABC@example.test>", references: ["<RootABC@example.test>", "<ParentABC@example.test>"],
      attachments: [{ filename: "catalog.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-test") }],
    });
    const parsed = await simpleParser(result.message);
    assert.equal(parsed.inReplyTo, "<ParentABC@example.test>");
    assert.deepEqual(parsed.references, ["<RootABC@example.test>", "<ParentABC@example.test>"]);
    assert.equal(Array.isArray(parsed.to) ? parsed.to[0].value[0].address : parsed.to?.value[0].address, "shipping@example.test");
    assert.equal(parsed.attachments[0].filename, "catalog.pdf");
    assert.equal(parsed.attachments[0].content.toString(), "%PDF-test");
  } finally { nodemailer.createTransport = createTransport; }
});
