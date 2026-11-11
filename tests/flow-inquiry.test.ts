import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as errors from "../lib/flow-execution-errors.ts";
import * as mailboxes from "../lib/mailbox-utils.ts";

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
function fixture(file: string, tables: Record<string, Row[]>, deps: Record<string, unknown> = {}) {
  const admin = { from(table: string) {
    let data = [...(tables[table] ?? [])], single = false;
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { data = data.filter(row => row[key] === value); return query; },
      in(key: string, values: unknown[]) { data = data.filter(row => values.includes(row[key])); return query; },
      neq(key: string, value: unknown) { data = data.filter(row => row[key] !== value); return query; },
      not(key: string) { data = data.filter(row => row[key] != null); return query; },
      lte(key: string, value: string) { data = data.filter(row => row[key] <= value); return query; },
      order(key: string, options?: { ascending: boolean }) { data.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options?.ascending === false ? -1 : 1)); return query; },
      limit(n: number) { data = data.slice(0, n); return query; }, maybeSingle() { single = true; return query; },
      update(value: Row) { data.forEach(row => Object.assign(row, value)); return query; }, throwOnError() { return query; },
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: single ? data[0] ?? null : data }).then(resolve); },
    };
    return query;
  } };
  const exports: Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>> = {};
  const dependencies: Row = { "server-only": {}, "../supabase/admin.ts": { createSupabaseAdmin: () => admin }, "../flow-execution-errors.ts": errors, "../mailbox-utils.ts": mailboxes, ...deps };
  const code = ts.transpileModule(readFileSync(new URL(`../lib/data/${file}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => dependencies[id] ?? require(id), Date, setTimeout, clearTimeout });
  return exports;
}

test("form context is bound to the originating submission and excludes newer requirements", async () => {
  const fields = { "contact[Materials]": "PLA, PETG", "contact[Monthly quantity]": "500–999 kg/month", unrelated: "ignore" };
  const app = fixture("flow-inquiry", { shopify_leads: [
    { webhook_id: "original", contact_id: "contact", status: "processed", created_at: "2026-11-10T06:00:00Z", form_content: fields },
    { webhook_id: "future", contact_id: "contact", status: "processed", created_at: "2026-11-12T06:00:00Z", form_content: { "contact[Materials]": "ABS" } },
  ] });
  const inquiry = await app.loadFlowInquiry("contact", "2026-11-11T00:00:00Z");
  assert.equal(inquiry.id, "original");
  const fieldsRead = inquiry.fields as Record<string, unknown>;
  assert.equal(fieldsRead["contact[Materials]"], "PLA, PETG");
  assert.equal(fieldsRead["contact[Monthly quantity]"], "500–999 kg/month");
  assert.equal(fieldsRead.unrelated, undefined);
  assert.equal(await app.loadFlowInquiry("contact", "2026-11-11T00:00:00Z", { source: "shopify", id: "future" }), null);
});

test("assigned sending refuses inactive, unauthorized and changed salespeople", async () => {
  const tables: Record<string, Row[]> = { pipeline: [{ company_id: "company", owner_id: "sales" }], workspace_members: [
    { user_id: "admin", role: "admin", activated_at: "2026-01-01" }, { user_id: "sales", role: "bd_manager", activated_at: "2026-01-01" },
    { user_id: "other", role: "bd_manager", activated_at: "2026-01-01" },
  ] };
  const app = fixture("flow-sender", tables);
  assert.equal(await app.assignedFlowActor("admin", "company"), "sales");
  await assert.rejects(app.assignedFlowActor("other", "company"), /not authorized/);
  await assert.rejects(app.assignedFlowActor("admin", "company", "previous"), /changed/);
  tables.workspace_members[1].activated_at = null;
  await assert.rejects(app.assignedFlowActor("admin", "company"), /not authorized/);
});

test("header receipts hydrate only from their authorized mailbox and stale caches cannot permit a send", async () => {
  let reads = 0;
  let syncedAt = new Date().toISOString();
  const mailbox = { id: "box", type: "personal", user_id: "sales", email: "sales@example.com", is_active: true };
  const tables = { workspace_mailboxes: [mailbox], emails: [{ id: "receipt", body_loaded: false }] };
  const app = fixture("flow-mail-context", tables, { "./mailbox-sync.ts": {
    loadSyncedMailbox: async () => ({ syncedAt, error: null }),
    loadMailboxMessageContent: async () => { reads++; return { body: "250 pieces of black PLA matte" }; },
  } });
  const message = { id: "receipt", direction: "received", body_loaded: false, body: null, mailbox_id: "box", mailbox_uid: 1, mailbox_uid_validity: 2 };
  await assert.rejects(app.hydrateFlowMessages([message], "other"), /authorized/);
  assert.equal(reads, 0);
  assert.equal((await app.hydrateFlowMessages([message], "sales"))[0].body, "250 pieces of black PLA matte");
  assert.equal(tables.emails[0].body_loaded, true);
  await app.requireFreshFlowMailbox("box", "sales");
  syncedAt = "invalid-date";
  await assert.rejects(app.requireFreshFlowMailbox("box", "sales"), /Receiving is behind/);
});
