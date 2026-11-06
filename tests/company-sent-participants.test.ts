import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as companyEmail from "../lib/company-email.ts";

test("company CRM sent history finds secondary recipients without returning unrelated, failed, or other-mailbox sends", async () => {
  const rows = [
    { id: "cc", mailbox_id: "staff", to_email: "first@test", cc_recipients: [{ address: "buyer@test" }], status: "sent", body: "Customer copy", sent_at: "2026-11-06T00:00:00Z" },
    { id: "secondary-to", mailbox_id: "staff", to_email: "first@test", to_recipients: [{ address: "first@test" }, { address: "buyer@test" }], status: "sent", body: "Second To", sent_at: "2026-11-06T00:01:00Z" },
    { id: "private", mailbox_id: "staff", to_email: "private@test", status: "sent", body: "buyer@test only in quoted body" },
    { id: "failed", mailbox_id: "staff", to_email: "buyer@test", status: "failed", body: "Not delivered" },
    { id: "other-mailbox", mailbox_id: "another", to_email: "buyer@test", status: "sent", body: "Different mailbox" },
  ];
  const filters: Array<[string, unknown]> = [];
  const query = { select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, order() { return query; }, range() { return query; },
    then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: rows.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value)), error: null }).then(resolve); } };
  const deps: Record<string, unknown> = { "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from: () => query }) }, "../company-email.ts": companyEmail };
  const exports = {} as typeof import("../lib/data/email-state.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/email-state.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => deps[name] });
  const messages = await exports.listSentMailboxMessages("admin", "staff", new Set(["buyer@test"]));
  assert.equal(messages.map(message => message.id).join(","), "sent-cc,sent-secondary-to");
  assert.ok(messages.every(message => message.contact === "buyer@test"));
  assert.ok(!filters.some(([key]) => key === "user_id"), "Company history can read the actual colleague's successful customer sends");
});
