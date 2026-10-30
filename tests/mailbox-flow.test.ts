import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { simpleParser } from "mailparser";
import vm from "node:vm";
import ts from "typescript";
import * as legacy from "../lib/mailbox-imap.ts";
import * as sync from "../lib/mailbox-sync.ts";
import * as folders from "../lib/email-provider.ts";

function setup(stall = false, omitRootMime = false) {
  const clients: FakeFlow[] = [];
  const queries: Array<Record<string, unknown>> = [];
  class FakeFlow extends EventEmitter {
    usable = false;
    mailbox = { uidValidity: 42n, exists: 2 };
    closes = 0;
    constructor(options: { logger: unknown; tls: { rejectUnauthorized: boolean } }) { super(); clients.push(this); assert.equal(options.logger, false); assert.equal(options.tls.rejectUnauthorized, true); }
    async connect() { this.usable = true; }
    close() { this.usable = false; this.closes++; this.emit("close"); }
    async getMailboxLock(_folder: string, options: { readOnly: boolean }) { assert.equal(options.readOnly, true); return { release() {} }; }
    async search() { return [1, 3]; }
    async list() { return [{ path: "Sent", name: "Sent", flags: new Set(["\\Sent"]), specialUse: "\\Sent" }]; }
    async fetchAll(ids: number[], query: Record<string, unknown>) {
      queries.push(query);
      if (stall) return new Promise<never>(() => {});
      return ids.map(uid => query.bodyParts ? { uid, bodyParts: new Map(omitRootMime ? [["1", Buffer.from("Hello preview")]] : [["1", Buffer.from("Hello preview")], ["1.MIME", Buffer.from("Content-Type: text/plain; charset=utf-8\r\n")]]) } : {
        uid, flags: new Set(uid === 1 ? ["\\Seen", "\\Flagged"] : []), headers: Buffer.from(`Message-ID: <${uid}@test>\r\nFrom: buyer@example.test\r\nTo: me@example.test\r\nSubject: Message ${uid}\r\n\r\n`),
        bodyStructure: { part: "1", type: "text/plain", size: 100_000 },
      });
    }
  }
  const dependencies: Record<string, unknown> = { imapflow: { ImapFlow: FakeFlow }, "node:crypto": { createHash }, mailparser: { simpleParser }, "./mailbox-imap.ts": legacy, "./mailbox-sync.ts": sync, "./email-provider.ts": folders };
  const exports = {} as typeof import("../lib/mailbox-flow.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/mailbox-flow.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Buffer, Map, Set, Date, setTimeout, clearTimeout });
  return { api: exports, clients, queries, mailbox: { email: "me@example.test", imapHost: "imap.test", imapUsername: "me", imapPassword: "fixture", imapPort: 993 }, scope: { prefix: "test:", timeoutMs: stall ? 30 : 1000 } };
}
test("background headers never fetch file bodies and safely accept unsolicited flag events", async () => {
  const { api, clients, queries, mailbox, scope } = setup();
  try {
    const emails = await api.receiveMailboxFlow(mailbox, { includePreview: false }, scope);
    assert.equal(emails.length, 2);
    assert.equal(queries.some(query => query.bodyParts), false);
    clients[0].emit("flags", { uid: 1, flags: new Set(["\\Seen"]) });
    const repeat = await api.receiveMailboxFlow(mailbox, { includePreview: false }, scope);
    assert.equal(repeat.length, 2); assert.equal(clients.length, 1);
  } finally { api.closeMailboxFlowScope(scope.prefix); }
  assert.equal(clients[0].usable, false);
});
test("large text previews use a bounded partial FETCH and never download the full part", async () => {
  const { api, queries, mailbox, scope } = setup();
  try {
    const emails = await api.receiveMailboxFlow(mailbox, {}, scope);
    assert.equal(emails[0].preview, "Hello preview");
    const query = queries.find(query => query.bodyParts)!;
    assert.match(JSON.stringify(query.bodyParts), /"maxLength":16384/);
  } finally { api.closeMailboxFlowScope(scope.prefix); }
});
test("timed-out background commands close their session and reject without crashing other accounts", async () => {
  const { api, clients, mailbox, scope } = setup(true);
  await assert.rejects(api.receiveMailboxFlow(mailbox, { includePreview: false }, scope), /timed out/);
  assert.equal(clients[0].usable, false);
  api.closeMailboxFlowScope(scope.prefix);
});
test("single-part providers that omit 1.MIME use the original MIME headers", async () => {
  const { api, mailbox, scope } = setup(false, true);
  try {
    const messages = await api.receiveMailboxFlow(mailbox, {}, scope);
    assert.equal(messages[0].preview, "Hello preview");
  } finally { api.closeMailboxFlowScope(scope.prefix); }
});
test("modern flag reconciliation tombstones missing UIDs and preserves exact UID read/star flags", async () => {
  const { api, mailbox, scope } = setup();
  try {
    const messages = [1, 2].map(uid => ({ uid, uidValidity: 42, read: false, starred: false })) as Parameters<typeof api.reconcileMailboxFlow>[1];
    const result = await api.reconcileMailboxFlow(mailbox, messages, "INBOX", scope);
    assert.equal(result[0].read, true); assert.equal(result[0].starred, true); assert.equal(result[1].providerRemoved, true);
  } finally { api.closeMailboxFlowScope(scope.prefix); }
});
