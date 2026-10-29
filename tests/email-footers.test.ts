import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import { appendEmailFooter, withoutComposerFooter, type EmailFooter } from "../lib/email-footer.ts";
import { cleanEmailFooter, footerImageSources } from "../lib/email-footer-html.ts";
import { escapeEmailHtml } from "../lib/email-markup.ts";
import { publicImageAddress, publicImageUrl } from "../lib/remote-email-image.ts";
import { prepareComposerMessage } from "../lib/email-composer.ts";
import { crmClipboardAttachment, imageFileDataUrl } from "../lib/email-paste.ts";

const require = createRequire(import.meta.url);
const gif = Buffer.from("47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b", "hex");
const imageHtml = `<img src="data:image/gif;base64,${gif.toString("base64")}" width="160" alt="Animated logo">`;
const signature = `<div><b>Asher Xu</b><br>Sales Manager</div>${imageHtml}<div>🌐 <a href="https://filazoo.com/">filazoo.com</a></div>`;

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Response, Request, Buffer, Blob, crypto, console, URL });
  return exports as T;
}

function setup() {
  const rows = new Map<string, EmailFooter>();
  const objects = new Map<string, Blob>();
  const removals: string[] = [];
  const imports: string[] = [];
  let failSave = false;
  const db = {
    from: () => ({
      select: () => ({ eq: (_key: string, userId: string) => ({ maybeSingle: async () => ({ data: rows.get(userId) || null, error: null }) }) }),
      upsert: async (row: EmailFooter & { user_id: string }) => { if (!failSave) rows.set(row.user_id, { text: row.text, html: row.html }); return { error: failSave ? { message: "Failed" } : null }; },
    }),
    storage: { from: () => ({
      upload: async (path: string, bytes: Buffer, options: { contentType: string }) => { objects.set(path, new Blob([bytes], { type: options.contentType })); return { error: null }; },
      download: async (path: string) => ({ data: objects.get(path) || null, error: null }),
      remove: async (paths: string[]) => { paths.forEach((path) => { removals.push(path); objects.delete(path); }); return { error: null }; },
    }) },
  };
  const service = load<typeof import("../lib/data/email-footers.ts")>("../lib/data/email-footers.ts", {
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
    "../email-footer.ts": { appendEmailFooter, footerAssetPattern: /^\/api\/email\/footer\/assets\/([a-f0-9-]{36})$/i },
    "../email-footer-html.ts": { cleanEmailFooter, footerImageSources },
    "../email-markup.ts": { escapeEmailHtml },
    "../remote-email-image.ts": { importRemoteEmailImage: async (url: string) => { imports.push(url); return `data:image/gif;base64,${gif.toString("base64")}`; } }, sharp,
  });
  return { service, rows, objects, removals, imports, failSave: () => { failSave = true; } };
}

test("pasted footers retain text, links, icons, layout and images while removing active markup", () => {
  const clean = cleanEmailFooter(`<script>alert(1)</script><svg onload="bad()"><script>bad()</script></svg><table style="width:500px;position:fixed;background-image:url(javascript:bad)"><tr><td style="color:#004455;padding:4px"><b>Asher Xu</b><br>🌐 <a href="https://filazoo.com" onclick="bad()">Website</a><a href="jav&#x61;script:bad()">unsafe</a>${imageHtml}<img src="file:///C:/private.png"></td></tr></table>`);
  assert.match(clean.html, /<table style="width:500px">/);
  assert.match(clean.html, /color:#004455;padding:4px/);
  assert.match(clean.html, /<a href="https:\/\/filazoo.com">Website<\/a>/);
  assert.match(clean.html, /width="160"/);
  assert.match(clean.text, /Asher Xu/);
  assert.match(clean.text, /🌐 Website/);
  assert.doesNotMatch(clean.html, /script|onload|onclick|position|background-image|file:/i);
});

test("saving a footer keeps image bytes private, and each user's send uses only their own footer", async () => {
  const f = setup();
  const footer = await f.service.saveUserEmailFooter("alice", signature);
  await f.service.saveUserEmailFooter("bob", "<div>Bob Footer</div>");
  assert.ok(!footer.html.includes("base64"));
  const path = [...f.objects.keys()][0];
  assert.ok(path.startsWith("alice/footers/"));
  const blob = f.objects.get(path)!;
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), gif);
  assert.equal((await sharp(Buffer.from(await blob.arrayBuffer()), { animated: true }).metadata()).pages, 2);
  const alice = await f.service.prepareUserEmail("alice", { text: "Hello\n\nBest regards,\nDefault manager\nFilazoo" });
  assert.match(alice.text, /Asher Xu/);
  assert.doesNotMatch(alice.text, /Default manager|Bob Footer/);
  assert.match(alice.html!, /cid:footer-/);
  assert.equal(alice.attachments.length, 1);
  assert.deepEqual(alice.attachments[0].content, gif);
  const bob = await f.service.prepareUserEmail("bob", { text: "Hello" });
  assert.match(bob.text, /Bob Footer/);
  assert.equal(bob.attachments.length, 0);
  await assert.rejects(f.service.loadFooterImage("bob", path.split("/").at(-1)!), /not found/);
});

test("copied webmail image URLs are imported on save and HTML indentation does not become blank lines", async () => {
  const f = setup();
  const footer = await f.service.saveUserEmailFooter("alice", '<table>\n<tbody>\n<tr><td colspan="2">Name<img src="https://mail.example.com/image.gif?part=1&amp;key=2" width="80"></td></tr>\n</tbody>\n</table>');
  assert.deepEqual(f.imports, ["https://mail.example.com/image.gif?part=1&key=2"]);
  assert.match(footer.html, /colspan="2"/);
  assert.doesNotMatch(footer.html, /mail.example.com|<br>/);
  assert.equal(f.objects.size, 1);
  assert.deepEqual(Buffer.from(await [...f.objects.values()][0].arrayBuffer()), gif);
});

test("inbox drafts show the footer once and keep its edited version when AI rewrites the body", () => {
  const footer = cleanEmailFooter(signature);
  const first = appendEmailFooter("Hello", undefined, footer);
  assert.equal((appendEmailFooter(first.text, first.html, footer).html!.match(/data-email-footer/g) || []).length, 1);
  assert.doesNotMatch(withoutComposerFooter(first.html!), /<img/);
  const edited = { text: "My edited title", html: "<b>My edited title</b>" };
  const ai = prepareComposerMessage("AI body\n\nBest regards,\nDefault name", "", "Old text footer", edited);
  assert.match(ai.html, /My edited title/);
  assert.doesNotMatch(ai.html, /Old text footer|Default name/);
});

test("removed or empty footers stay empty, failed saves clean new uploads, and drafts retain earlier images", async () => {
  const f = setup();
  await f.service.saveUserEmailFooter("alice", signature);
  const saved = [...f.objects.keys()][0];
  f.failSave();
  await assert.rejects(f.service.saveUserEmailFooter("alice", signature), /Unable to save/);
  assert.equal(f.removals.length, 1);
  assert.ok(f.objects.has(saved));
  assert.equal(f.objects.size, 1);
  const clean = setup();
  await clean.service.saveUserEmailFooter("alice", "<div><br></div>");
  assert.equal((await clean.service.prepareUserEmail("alice", { text: "Hello" })).html, undefined);
  const draft = await f.service.prepareUserEmail("alice", { text: "Footer removed", html: "<div>Footer removed</div>" }, true);
  assert.equal(draft.text, "Footer removed");
  assert.equal(draft.attachments.length, 0);
});

test("remote image imports block private addresses, alternate protocols, credentials and internal hosts", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.1.1", "192.168.2.2", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1", "fe80::1", "fd00::1", "2001:db8::1"]) assert.equal(publicImageAddress(address), false, address);
  assert.equal(publicImageAddress("8.8.8.8"), true);
  assert.equal(publicImageAddress("2606:4700:4700::1111"), true);
  for (const url of ["file:///tmp/a.png", "http://127.0.0.1/a", "http://2130706433/a", "https://user:password@example.com/a", "http://metadata.internal/a", "http://localhost/a", "http://[::1]/a", "https://example.com:3000/a"]) assert.throws(() => publicImageUrl(url));
});

test("CRM reader copies use authenticated local attachment routes, including hosted-to-local pastes", async () => {
  const path = "/api/email/received-attachment?mailbox=opaque&uid=123&validity=1&part=4";
  const base = "http://localhost:3000/settings/email";
  assert.equal(crmClipboardAttachment(path, base), path);
  assert.equal(crmClipboardAttachment(`https://crm.filazoosupply.com${path}`, base), path);
  assert.equal(crmClipboardAttachment(`about:srcdoc${path}`, base), path);
  assert.equal(crmClipboardAttachment(`https://untrusted.example${path}`, base), null);
  assert.equal(crmClipboardAttachment("http://localhost:3000/api/settings/secrets", base), null);
  const copied = await imageFileDataUrl(new File([gif], "signature.gif", { type: "image/gif" }));
  assert.equal(copied, `data:image/gif;base64,${gif.toString("base64")}`);
  assert.equal((await sharp(Buffer.from(copied.split(",")[1], "base64"), { animated: true }).metadata()).pages, 2);
});

test("footer HTTP writes reject a forged owner and always use the authenticated account", async () => {
  const users: string[] = [];
  const { GET, PUT } = load<{ GET: () => Promise<Response>; PUT: (request: Request) => Promise<Response> }>("../app/api/email/footer/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "alice" }) },
    "@/lib/data/email-footers": { getUserEmailFooter: async (id: string) => { users.push(id); return null; }, saveUserEmailFooter: async (id: string) => { users.push(id); return { text: "Alice", html: "<b>Alice</b>" }; } },
  });
  assert.equal((await GET()).status, 200);
  const write = (body: object) => PUT(new Request("http://localhost/api/email/footer", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await write({ userId: "bob", html: "<b>Alice</b>" })).status, 400);
  assert.equal((await write({ html: "<b>Alice</b>" })).status, 200);
  assert.deepEqual(users, ["alice", "alice"]);
});
