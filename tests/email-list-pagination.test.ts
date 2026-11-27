import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as pagination from "../lib/email-pagination.ts";
import * as leads from "../lib/lead-inquiries.ts";
import * as mailboxes from "../lib/mailbox-utils.ts";
import * as model from "../lib/crm-model.ts";
import * as avatars from "../lib/member-avatar-url.ts";

const require = createRequire(import.meta.url);
function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? (id === "../crm-model.ts" ? model : id === "../member-avatar-url.ts" ? avatars : require(id)), Map, URL, Response, process: { env: {} } });
  return exports;
}
const viewer = { id: "actor", role: "bd_manager" };
const box = mailboxes.normalizeMailboxRow({ id: "team", type: "workspace", email: "team@example.test", is_default: true })!;

test("email backend pages in PostgreSQL and enriches only returned correspondents", async () => {
  let contextComplete = false;
  const calls: Array<[string, Record<string, unknown>]> = [], enriched: unknown[][] = [];
  const items = [{ id: "sent-order", direction: "outbound", subject: "Order", contact: "buyer@example.test", company: "Buyer", companyId: "owned-company", body: "Order body", timestamp: "2026-11-27T00:00:00Z", attachments: [{ filename: "quote.pdf", contentType: "application/pdf", size: 10, content: "PRIVATE_ATTACHMENT_CONTENT" }] }];
  const api = load("../lib/data/email-pagination.ts", {
    "../ai/provider-credentials.ts": { hasAiProvider: () => false }, "../mailbox-utils.ts": mailboxes,
    "../email-pagination.ts": pagination, "../lead-inquiries.ts": leads,
    "../supabase/admin.ts": { createSupabaseAdmin: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return { data: { emails: items, revision: "revision", contextComplete, page: 2, total: 61, pageSize: 30, folderCounts: { inbox: 61 }, followupCounts: { all: 0, ai: 0, manual: 0, completed: 0, nurture: 0 } }, error: null };
    } }) },
    "./mailboxes.ts": { mailboxHasImap: () => true, mailboxHasSmtp: () => true },
    "./mailbox-sync.ts": { mailboxSyncKey: () => "key", savedProviderFolders: async () => [], presentMailboxMessage: (item: unknown) => item },
    "./inbox-companies.ts": { listInboxCompanies: async (emails: unknown[], assigned: Map<string, string>) => { enriched.push(emails); assert.equal(assigned.get("buyer@example.test"), "owned-company"); return { companies: [] }; } },
    "./email-followup-status": { listFollowupActions: async () => [] },
    "./email-state.ts": { getEmailAutomationSettings: async () => ({ enabled: true, steps: [], queueCount: 61 }) },
    "../email-content.ts": { resolveEmailContentIds: (html: string) => html },
  });
  const result = await api.getEmailInboxPageData({ viewer, mailboxes: [box], mailboxId: "team", request: { page: 2, query: "buyer", tag: "New Inquiries" } }) as { emails: unknown[]; pagination: pagination.EmailPageInfo; automation: { enabled: boolean } };
  const [, args] = calls.find(([name]) => name === "crm_email_list_page_snapshot")!;
  assert.equal(args.p_owner, "actor"); assert.equal(args.p_personal, false); assert.equal(args.p_page, 2); assert.equal(args.p_query, "buyer");
  assert.equal(result.pagination.total, 61); assert.equal(result.pagination.request.page, 2);
  assert.equal(enriched[0].length, 1); assert.equal(result.automation.enabled, true);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_ATTACHMENT_CONTENT"));
  assert.match(JSON.stringify(result.emails), /\/api\/email\/attachments\/order\/0/);
  await assert.rejects(api.getEmailInboxPageData({ viewer, mailboxes: [box], mailboxId: "someone-else" }), /Mailbox unavailable/);
  assert.equal(calls.length, 1, "An unauthorized mailbox must never reach the RPC");
  contextComplete = true;
  await api.getEmailInboxPageData({ viewer, mailboxes: [box], mailboxId: "team" });
  assert.equal(enriched.length, 1, "Current databases must not make extra company or avatar requests");
});

test("page API rechecks mailbox access and skips all message reads when the revision is unchanged", async () => {
  let reads = 0;
  const make = (denied = false) => load("../app/api/email/page/route.ts", {
    "next/server": { after() {} }, "@/lib/auth": { requireWorkspaceMember: async () => { if (denied) throw new Error("Unauthorized"); return viewer; } },
    "@/lib/workspace-context": { withWorkspaceViewer: (_viewer: unknown, work: () => unknown) => work() },
    "@/lib/email-pagination": pagination,
    "@/lib/data/email-pagination": { emailPageRevision: async () => "same", getEmailInboxPageData: async (args: { request: pagination.EmailPageRequest }) => { reads++; return { emails: [], pagination: { request: args.request } }; } },
    "@/lib/data/mailboxes": { getViewerMailboxes: async () => [box], mailboxHasImap: () => false },
    "@/lib/data/mailbox-sync": { mailboxSyncKey: () => "key", savedProviderFolders: async () => [] },
    "@/lib/data/mail-sync-worker": {},
  });
  const get = (api: ReturnType<typeof make>, params: string) => api.GET(new Request(`http://localhost/api/email/page?${params}`)) as Promise<Response>;
  assert.equal((await get(make(), "mailboxId=other")).status, 404);
  const unchanged = await get(make(), "mailboxId=team&revision=same");
  assert.equal((await unchanged.json()).unchanged, true); assert.equal(reads, 0);
  const page = await get(make(), "mailboxId=team&page=3&q=buyer");
  assert.equal((await page.json()).pagination.request.page, 3); assert.equal(reads, 1);
  assert.equal(page.headers.get("Cache-Control"), "private, no-store");
  await assert.rejects(get(make(true), "mailboxId=team"), /Unauthorized/);
  assert.equal(reads, 1);
});
