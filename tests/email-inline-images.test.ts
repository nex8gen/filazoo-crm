import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import sharp from "sharp";
import { initialComposerHtml, prepareComposerMessage } from "../lib/email-composer.ts";
import * as emailContent from "../lib/email-content.ts";
import * as threading from "../lib/email-threading.ts";
import * as workbench from "../lib/email-workbench.ts";

const require = createRequire(import.meta.url);
// Two frames, 100 ms each, with a repeat loop: animation must survive MIME encoding.
const gif = Buffer.from("47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b", "hex");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=", "base64");
const gifHtml = `<img src="data:image/gif;base64,${gif.toString("base64")}" alt="Signature animation">`;

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  dependencies["../email-workbench"] = workbench;
  if (path === "../app/api/email/send/route.ts") dependencies["@/lib/data/manual-email-send"] = load("../lib/data/manual-email-send.ts", dependencies);
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Response, Request, Buffer, crypto, console });
  return exports as T;
}

test("inline images keep their position and original bytes in the actual MIME message", async () => {
  const html = `<div>Hi customer</div><img src="data:image/png;base64,${png.toString("base64")}"><div>Best regards,<br>Asher Xu</div>${gifHtml}<div>Phone: +86 123456789</div>`;
  const message = prepareComposerMessage("Hi customer\nBest regards,\nAsher Xu\nPhone: +86 123456789", html, "Saved signature");
  assert.equal(message.attachments.length, 2);
  assert.ok(message.html.indexOf("Hi customer") < message.html.indexOf("cid:"));
  assert.ok(message.html.indexOf("Asher Xu") < message.html.lastIndexOf("cid:"));
  assert.ok(message.html.lastIndexOf("cid:") < message.html.indexOf("Phone:"));
  assert.ok(!message.text.includes("Saved signature"), "An edited signature is not appended a second time");
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const sent = await transport.sendMail({ from: "sender@example.test", to: "recipient@example.test", subject: "Inline MIME test", text: message.text, html: message.html, attachments: message.attachments.map((attachment) => ({ ...attachment, content: Buffer.from(attachment.content, "base64") })) });
  const parsed = await simpleParser(sent.message, { skipImageLinks: true });
  assert.equal(parsed.attachments.length, 2);
  assert.deepEqual(parsed.attachments[0].content, png);
  assert.deepEqual(parsed.attachments[1].content, gif);
  const animation = await sharp(parsed.attachments[1].content, { animated: true }).metadata();
  assert.equal(animation.pages, 2);
  assert.deepEqual(animation.delay, [100, 100]);
  assert.equal(parsed.attachments[1].contentType, "image/gif");
  assert.equal(parsed.attachments[1].contentDisposition, "inline");
  assert.match(String(parsed.html), /Asher Xu<\/div><img src="cid:/);
});

test("image-only messages and repeated images have a valid HTML alternative", () => {
  const message = prepareComposerMessage("", `${gifHtml}${gifHtml}`, "");
  assert.equal(message.text, "");
  assert.equal(message.attachments.length, 1);
  assert.equal((message.html.match(/cid:/g) || []).length, 2);
  assert.ok(!message.html.includes("base64"));
  assert.equal(initialComposerHtml("<Hello>", "Sales"), "<div>&lt;Hello&gt;<br><br>Sales</div>");
  assert.throws(() => prepareComposerMessage("", `<img src="data:image/gif;base64,${"A".repeat(10_000_004)}">`, ""), /7.5 MB/);
});

test("sending and reloading Sent mail retain HTML, CID metadata and private image URLs", async () => {
  let row: Record<string, unknown> = {};
  let delivered: Record<string, unknown> = {};
  const uploads: Buffer[] = [];
  const query = {
    select: () => query, eq: () => query, order: () => query,
    limit: async () => ({ data: [row], error: null }),
    insert: (record: Record<string, unknown>) => { row = record; return { select: () => ({ single: async () => ({ data: { id: record.id }, error: null }) }) }; },
  };
  const admin = { from: () => query, storage: { from: () => ({ upload: async (_path: string, bytes: Buffer) => { uploads.push(bytes); return { error: null }; } }) } };
  const { POST } = load<{ POST: (request: Request) => Promise<Response> }>("../app/api/email/send/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "operator" }) },
    "@/lib/data/mailboxes": { getViewerMailbox: async () => ({ id: "mailbox", smtpHost: "smtp.test", email: "sender@example.test" }), mailboxHasSmtp: () => true },
    "@/lib/mailer": { sendMailboxEmail: async (_mailbox: unknown, mail: Record<string, unknown>) => { delivered = mail; return { messageId: "<inline@example.test>" }; } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => admin },
    "@/lib/email-threading": threading,
    "@/lib/email-content": emailContent,
    "@/lib/data/email-footers": { prepareUserEmail: async (_id: string, mail: unknown) => mail },
  });
  const message = prepareComposerMessage("Asher Xu", `<div>Asher Xu</div>${gifHtml}`, "");
  const response = await POST(new Request("http://localhost/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: "customer@example.test", subject: "Signature", ...message }) }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(uploads[0], gif);
  assert.equal(delivered.html, message.html);
  assert.equal(row.body_html, message.html);
  assert.equal((row.attachments as { cid: string }[])[0].cid, message.attachments[0].cid);
  assert.match(result.email.html, /src="\/api\/email\/attachments\/[^/]+\/0"/);
  const { listSentMailboxMessages } = load<{ listSentMailboxMessages: (id: string) => Promise<{ body: string; html: string }[]> }>("../lib/data/email-state.ts", {
    "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "../email-content.ts": emailContent,
  });
  const reloaded = await listSentMailboxMessages("actor");
  assert.equal(reloaded[0].body, "Asher Xu");
  assert.equal(reloaded[0].html, result.email.html);
});
