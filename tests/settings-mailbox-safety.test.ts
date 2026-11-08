import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";

const id = "00000000-0000-4000-8000-000000000001";
function fixture(options: { scope?: string; owner?: string; role?: string; duplicate?: boolean; verifyFails?: boolean; disappeared?: boolean } = {}) {
  const writes: { operation: string; record: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const checks: Record<string, unknown>[] = [];
  const dependencies: Record<string, unknown> = {
    zod: { z }, "next/cache": { revalidatePath: () => {} }, "./team-actions": {},
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => {
      const role = options.role ?? "admin";
      if (!roles.includes(role)) throw new Error("Access denied");
      return { id: "me", role };
    } },
    "@/lib/mailbox-connection": { verifyMailboxConnections: async (input: Record<string, unknown>) => {
      checks.push(input); if (options.verifyFails) throw new Error("Provider unavailable");
    } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => {
      let operation = "read";
      let record: Record<string, unknown> = {};
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        update: (value: Record<string, unknown>) => { operation = "update"; record = value; return query; },
        insert: (value: Record<string, unknown>) => { operation = "insert"; record = value; return query; },
        maybeSingle: async () => {
          const allowed = filters.id === id && filters.type === (options.scope ?? "personal") && (filters.type === "workspace" || filters.user_id === (options.owner ?? "me"));
          if (operation === "read") return { data: allowed ? { id, email: "sales@example.test", smtp_password: "saved-smtp", imap_password: "saved-imap" } : null, error: null };
          if (operation === "update" && (!allowed || options.disappeared)) return { data: null, error: null };
          if (options.duplicate) return { data: null, error: { code: "23505" } };
          writes.push({ operation, record, filters });
          return { data: { id }, error: null };
        },
      };
      return query;
    } }) },
  };
  const exports: Record<string, (state: undefined, form: FormData) => Promise<{ error?: string; success?: string }>> = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/settings/actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? {} });
  return { actions: exports, writes, checks };
}

function form(changes: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ mailboxId: "", email: "sales@example.test", displayName: "Sales", provider: "smtp", notes: "Saved note", smtpHost: "smtp.example.test", smtpPort: "587", smtpUsername: "sales@example.test", smtpPassword: "new-smtp", imapHost: "imap.example.test", imapPort: "993", imapUsername: "sales@example.test", imapPassword: "new-imap", ...changes })) data.set(key, value);
  return data;
}

test("manual connections insert separately and never replace an existing address", async () => {
  for (const scope of ["personal", "workspace"]) {
    const name = scope === "personal" ? "savePersonalMailbox" : "saveWorkspaceMailbox";
    const fresh = fixture({ scope });
    assert.ok((await fresh.actions[name](undefined, form())).success);
    assert.equal(fresh.writes[0].operation, "insert");
    assert.equal(fresh.writes[0].record.is_default, false);
    const duplicate = fixture({ scope, duplicate: true });
    assert.match((await duplicate.actions[name](undefined, form())).error ?? "", /already connected/);
    assert.equal(duplicate.writes.length, 0);
  }
});

test("manual edits cannot claim a foreign or differently scoped connection", async () => {
  for (const options of [{ owner: "another-user" }, { scope: "workspace" }]) {
    const f = fixture(options);
    assert.match((await f.actions.savePersonalMailbox(undefined, form({ mailboxId: id }))).error ?? "", /access denied/);
    assert.equal(f.checks.length + f.writes.length, 0);
  }
  const f = fixture();
  assert.match((await f.actions.saveWorkspaceMailbox(undefined, form({ mailboxId: id }))).error ?? "", /access denied/);
  assert.equal(f.checks.length + f.writes.length, 0);
});

test("manual edits retain saved passwords and scope the actual update", async () => {
  for (const scope of ["personal", "workspace"]) {
    const f = fixture({ scope });
    const name = scope === "personal" ? "savePersonalMailbox" : "saveWorkspaceMailbox";
    const result = await f.actions[name](undefined, form({ mailboxId: id, smtpPassword: "", imapPassword: "" }));
    assert.ok(result.success, result.error);
    assert.equal(f.checks[0].smtpPassword, "saved-smtp");
    assert.equal(f.checks[0].imapPassword, "saved-imap");
    assert.equal(f.writes[0].operation, "update");
    assert.equal(f.writes[0].filters.id, id);
    assert.equal(f.writes[0].filters.type, scope);
    if (scope === "personal") assert.equal(f.writes[0].filters.user_id, "me");
    assert.equal("is_active" in f.writes[0].record, false);
    assert.equal(JSON.stringify(result).includes("saved-smtp"), false);
  }
});

test("address changes, failed checks, deleted targets and non-admin team edits never report success", async () => {
  const changed = fixture();
  assert.match((await changed.actions.savePersonalMailbox(undefined, form({ mailboxId: id, email: "other@example.test" }))).error ?? "", /separate connection/);
  assert.equal(changed.checks.length + changed.writes.length, 0);
  for (const options of [{ verifyFails: true }, { disappeared: true }]) {
    const f = fixture(options);
    assert.ok((await f.actions.savePersonalMailbox(undefined, form({ mailboxId: id }))).error);
    assert.equal(f.writes.length, 0);
  }
  for (const role of ["operator", "bd_manager", "viewer"]) {
    const f = fixture({ role });
    await assert.rejects(f.actions.saveWorkspaceMailbox(undefined, form()), /Access denied/);
    assert.equal(f.writes.length + f.checks.length, 0);
  }
});
