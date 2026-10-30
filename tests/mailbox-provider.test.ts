import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";
import { simpleParser } from "mailparser";
import vm from "node:vm";
import ts from "typescript";
import * as provider from "../lib/email-provider.ts";
import * as sync from "../lib/mailbox-sync.ts";
import * as threading from "../lib/email-threading.ts";
import * as mime from "../lib/email-mime.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

function setup(safeMoves = true, fixture?: { structure?: unknown; bodies?: Record<string, Buffer> }) {
  const actions: Array<{ name: string; ids?: number[]; flags?: string[]; readOnly?: boolean; folder?: string }> = [];
  const background: string[] = [];
  class FakeImap extends EventEmitter {
    state = "authenticated";
    connect() { queueMicrotask(() => this.emit("ready")); }
    openBox(folder: string, readOnly: boolean, done: (error: null, box: unknown) => void) { actions.push({ name: "open", folder, readOnly }); done(null, { uidvalidity: 42 }); }
    destroy() { actions.push({ name: "destroy" }); this.emit("close"); }
    end() { this.emit("end"); }
    serverSupports(capability: string) { return capability === "MOVE" && safeMoves; }
    search(query: unknown[], done: (error: null, ids: number[]) => void) { done(null, query[0] === "ALL" ? [3, 1] : []); }
    addFlags(ids: number[], flags: string[], done: () => void) { actions.push({ name: "add", ids, flags }); done(); }
    delFlags(ids: number[], flags: string[], done: () => void) { actions.push({ name: "remove", ids, flags }); done(); }
    move(ids: number[], folder: string, done: () => void) { actions.push({ name: "move", ids, folder }); done(); }
    fetch(ids: number[], options: { bodies: string[] }) {
      const result = new EventEmitter();
      queueMicrotask(() => {
        for (const uid of ids) {
          const message = new EventEmitter(); result.emit("message", message);
          if (options.bodies.includes("HEADER")) message.emit("body", Readable.from([Buffer.from(`Message-ID: <message-${uid}@example.test>\r\nFrom: Sender <sender@example.test>\r\nTo: me@example.test\r\nSubject: Price request ${uid}\r\nDate: Fri, 30 Oct 2026 10:00:00 +0800\r\n\r\n`)]), { which: "HEADER" });
          for (const part of options.bodies.filter((part) => part !== "HEADER")) if (fixture?.bodies?.[part]) message.emit("body", Readable.from([fixture.bodies[part]]), { which: part });
          message.emit("attributes", { uid, struct: fixture?.structure, flags: uid === 1 ? ["\\Seen", "\\Flagged"] : ["\\Deleted"] });
          message.emit("end");
        }
        result.emit("end");
      });
      return result;
    }
  }
  const exports: Record<string, (...args: never[]) => Promise<unknown>> = {};
  const dependencies: Record<string, unknown> = { imap: { default: FakeImap }, mailparser: { simpleParser }, "node:crypto": { createHash }, "node:async_hooks": { AsyncLocalStorage }, "./mailbox-sync.ts": sync, "./email-threading.ts": threading, "./email-provider.ts": provider, "./email-mime.ts": mime };
  dependencies["./mailbox-flow.ts"] = { receiveMailboxFlow: async () => { background.push("receive"); return []; }, closeMailboxFlowScope: () => { background.push("close"); } };
  const code = ts.transpileModule(readFileSync(new URL("../lib/mailbox-imap.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; }, Buffer, setTimeout, clearTimeout, console });
  return { actions, background, api: exports as unknown as typeof import("../lib/mailbox-imap.ts"), mailbox: { email: "me@example.test", imapHost: "imap.example.test", imapPort: 993, imapUsername: "me", imapPassword: "test-only" } };
}

test("provider mutations target only the selected UID and use a writable folder session", async () => {
  const { api, mailbox, actions } = setup();
  try {
    await api.updateMailboxMessage(mailbox, 1, 42, "INBOX", { read: true, starred: false, destination: "Archive" });
    assert.equal(actions[0].readOnly, false);
    assert.deepEqual(JSON.parse(JSON.stringify(actions.slice(1))), [{ name: "add", ids: [1], flags: ["\\Seen"] }, { name: "remove", ids: [1], flags: ["\\Flagged"] }, { name: "move", ids: [1], folder: "Archive" }]);
  } finally { await api.closeMailboxSessions(); }
});

test("preview truncation preserves emoji at the JSON storage boundary", async () => {
  const { api, mailbox } = setup();
  const message = await api.parseMailboxHeader(mailbox, { headers: Buffer.from("From: sender@example.test\r\nSubject: Unicode boundary\r\n\r\n"), uid: 1, uidValidity: 42, flags: [], structure: [] },
    [{ text: "a".repeat(159) + "😀after" } as Awaited<ReturnType<typeof simpleParser>>]);
  assert.equal(Array.from(message.preview!).length, 160);
  assert.equal(message.preview!.endsWith("😀"), true);
  assert.doesNotMatch(message.preview!, /[\uD800-\uDFFF]/u);
});

test("serverless sync sessions reuse connections within a tick and close without interrupting foreground mail", async () => {
  const { api, mailbox, actions, background } = setup();
  try {
    await api.receiveMailboxMessages(mailbox, { uids: [1], includePreview: false });
    await api.withMailboxSyncSessions(async () => {
      await api.receiveMailboxMessages(mailbox, { uids: [1], includePreview: false });
      await api.receiveMailboxMessages(mailbox, { uids: [3], includePreview: false });
    });
    assert.equal(actions.filter((action) => action.name === "open").length, 1);
    assert.deepEqual(background, ["receive", "receive", "close"]);
    await api.receiveMailboxMessages(mailbox, { uids: [3], includePreview: false });
    assert.equal(actions.filter((action) => action.name === "open").length, 1, "foreground session must remain usable");
  } finally { await api.closeMailboxSessions(); }
});

test("providers with empty native searches fall back to parsed headers without downloading attachments", async () => {
  const { api, mailbox } = setup();
  try {
    const matches = await api.searchMailboxMessages(mailbox, "Price request 3");
    assert.equal(matches.fallback, true);
    assert.equal(matches.length, 1); assert.equal(matches[0].uid, 3);
    assert.equal(matches[0].bodyLoaded, false);
    const byCachedBody = await api.searchMailboxMessages(mailbox, "a phrase absent from headers", "INBOX", "inbox", new Set(["42:1"]));
    assert.equal(byCachedBody.length, 1); assert.equal(byCachedBody[0].uid, 1);
  } finally { await api.closeMailboxSessions(); }
});

test("unsafe legacy moves and changed UIDVALIDITY fail before moving any message", async () => {
  const { api, mailbox, actions } = setup(false);
  try {
    await assert.rejects(api.updateMailboxMessage(mailbox, 1, 42, "INBOX", { destination: "Trash" }), /cannot safely move/);
    await assert.rejects(api.updateMailboxMessage(mailbox, 1, 99, "INBOX", { read: true }), /identifiers changed/);
    assert.equal(actions.some((action) => action.name === "move" || action.name === "add"), false);
  } finally { await api.closeMailboxSessions(); }
});

test("reconciliation imports provider read/star flags and tombstones messages removed elsewhere", async () => {
  const { api, mailbox, actions } = setup();
  try {
    const messages = [1, 2].map((uid) => ({ id: `message-${uid}`, uid, uidValidity: 42, read: false, starred: false })) as InboxEmailItem[];
    const result = await api.reconcileMailboxMessages(mailbox, messages);
    assert.equal(result[0].read, true); assert.equal(result[0].starred, true); assert.equal(result[0].providerRemoved, false);
    assert.equal(result[1].providerRemoved, true);
    assert.equal(actions[0].readOnly, true);
    assert.equal(actions.some((action) => ["move", "add", "remove"].includes(action.name)), false);
  } finally { await api.closeMailboxSessions(); }
});

test("MIME metadata decodes international filenames and retains Content-Location for inline resources", async () => {
  const { api, mailbox } = setup(true, { structure: [{ type: "mixed" },
    [{ partID: "1", type: "text", subtype: "plain" }],
    [{ partID: "2", type: "image", subtype: "png", id: "<logo@mail>", location: "image001.png", disposition: { type: "inline", params: { filename: "=?utf-8?B?5oql5ZGKLnBuZw==?=" } } }],
    [{ partID: "3", type: "application", subtype: "zip", disposition: { type: "attachment", params: { "filename*": "utf-8''caf%C3%A9.zip" } } }],
  ] });
  try {
    const [message] = await api.receiveMailboxMessages(mailbox, { uids: [1], headersOnly: true, includePreview: false });
    assert.equal(message.attachments?.[0].filename, "报告.png");
    assert.equal(message.attachments?.[0].contentLocation, "image001.png");
    assert.equal(message.attachments?.[1].filename, "café.zip");
  } finally { await api.closeMailboxSessions(); }
});

test("forwarded message attachments download as original RFC822 bytes instead of disappearing into the body", async () => {
  const raw = Buffer.from("From: sender@example.test\r\nTo: me@example.test\r\nSubject: Forwarded\r\n\r\nOriginal body\r\n");
  const { api, mailbox } = setup(true, { bodies: { "2.MIME": Buffer.from('Content-Type: message/rfc822\r\nContent-Disposition: attachment; filename="forwarded.eml"\r\nContent-Transfer-Encoding: base64\r\n'), "2": Buffer.from(raw.toString("base64")) } });
  try {
    const attachment = await api.downloadMailboxAttachment(mailbox, 1, 42, "2");
    assert.equal(attachment.filename, "forwarded.eml");
    assert.equal(attachment.contentType, "message/rfc822");
    assert.deepEqual(attachment.content, raw);
  } finally { await api.closeMailboxSessions(); }
});
