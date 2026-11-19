import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as provider from "../lib/email-provider.ts";
import * as content from "../lib/email-content.ts";
import * as mime from "../lib/email-mime.ts";

test("Inbox takes precedence over Important and All Mail copies regardless of snapshot order or stale folder labels", async () => {
  const require = createRequire(import.meta.url);
  const api = {} as typeof import("../lib/data/mailbox-sync.ts");
  const mailbox = { id: "account", email: "me@example.test", imapHost: "imap.example.test", imapPort: 993, imapUsername: "me" } as Parameters<typeof api.loadMailboxWorkspace>[0];
  const deps: Record<string, unknown> = {
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ from() { const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { folders: [{ path: "INBOX", name: "Inbox", kind: "custom" }, { path: "Important", name: "Important", kind: "custom" }, { path: "All Mail", name: "All Mail", kind: "archive" }] }, error: null }) }; return query; } }) },
    "../mailbox-sync.ts": {}, "../email-provider.ts": provider, "../email-content.ts": content, "../email-mime.ts": mime,
    "../mailbox-snapshot-reader.ts": { readMailboxSnapshots: async (_db: unknown, keys: string[]) => {
      assert.equal(keys.length, 3);
      return ["Important", "All Mail", "INBOX"].map(folder => ({ mailbox_key: api.mailboxSyncKey(mailbox, folder), messages: [{ id: "message", folder: folder === "All Mail" ? "archive" : "inbox", providerKind: "custom" }], synced_at: "2026-11-18T07:00:00Z" }));
    } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../lib/data/mailbox-sync.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: api, require: (name: string) => deps[name] ?? require(name), URLSearchParams });
  const result = await api.loadMailboxWorkspace(mailbox, { sync: false });
  assert.equal(result.messages[0].providerKind, "inbox");
  assert.equal(result.messages[0].providerFolder, "INBOX");
  assert.equal(result.folders[0].kind, "inbox");
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].providerLocations?.length, 3);
});
