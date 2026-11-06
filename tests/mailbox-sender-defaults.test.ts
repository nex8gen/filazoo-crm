import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as mailboxUtils from "../lib/mailbox-utils.ts";

function fixture() {
  const rows: mailboxUtils.MailboxRecordInput[] = [
    { id: "team", type: "workspace", email: "team@example.com", is_default: true },
    { id: "mine", type: "personal", user_id: "owner", email: "mine@example.com", is_default: false },
    { id: "private", type: "personal", user_id: "other", email: "private@example.com", is_default: true },
  ];
  let fail = false;
  const db = { from: () => {
    const filters: Array<(row: mailboxUtils.MailboxRecordInput) => boolean> = [];
    const query = {
      select: () => query,
      eq: (key: keyof mailboxUtils.MailboxRecordInput, value: unknown) => { filters.push(row => row[key] === value); return query; },
      or: () => query,
      order: async () => ({ data: rows.filter(row => filters.every(filter => filter(row))), error: fail ? { message: "Unavailable" } : null }),
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "../auth.ts": {}, "../mailbox-utils.ts": mailboxUtils,
    "../supabase/admin.ts": { createSupabaseAdmin: () => db },
  };
  const exports = {} as typeof import("../lib/data/mailboxes.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/mailboxes.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => dependencies[name], console: { warn() {} } });
  return { api: exports, rows, fail: () => { fail = true; } };
}

test("personal settings and AI default senders agree with the composer without a flagged default", async () => {
  const { api, rows } = fixture();
  assert.equal((await api.getUserMailbox("owner"))?.id, "mine");
  assert.equal((await api.getEffectiveMailbox("owner"))?.id, "mine");
  assert.equal((await api.getViewerMailbox("owner"))?.id, "mine");
  rows[1].email = "changed@example.com";
  assert.equal((await api.getEffectiveMailbox("owner"))?.email, "changed@example.com");
  assert.equal((await api.getViewerMailbox("owner", "team"))?.id, "team");
});

test("stopped personal defaults and lookup failures cannot silently select team SMTP", async () => {
  const { api, rows, fail } = fixture();
  Object.assign(rows[1], { is_default: true, is_active: false });
  rows.push({ id: "second", type: "personal", user_id: "owner", email: "second@example.com", is_default: false });
  assert.equal((await api.getUserMailbox("owner"))?.id, "mine");
  assert.equal((await api.getEffectiveMailbox("owner"))?.id, "mine");
  assert.equal(api.mailboxHasSmtp(await api.getEffectiveMailbox("owner")), false);
  fail();
  await assert.rejects(api.getUserMailbox("owner"), /Unable to load/);
  await assert.rejects(api.getEffectiveMailbox("owner"), /Unable to load/);
});

test("users without personal accounts retain the team default and cannot use another user's account", async () => {
  const { api } = fixture();
  assert.equal(await api.getUserMailbox("no-personal"), null);
  assert.equal((await api.getEffectiveMailbox("no-personal"))?.id, "team");
  assert.equal(await api.getViewerMailbox("owner", "private"), null);
});
