import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup() {
  const viewer = { id: "actor", role: "bd_manager" };
  const mailboxes = [{ id: "mine", type: "personal", userId: "actor" }, { id: "team", type: "workspace" }];
  const counts = { auth: 0, mailboxes: 0, inbox: 0, sync: 0 };
  const companyReads: string[] = [];
  const background: Array<() => Promise<void>> = [];
  let denied = false;
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => { counts.auth++; if (denied) throw new Error("Unauthorized"); return viewer; } },
    "@/lib/data/mailboxes": { getViewerMailboxes: async () => { counts.mailboxes++; return mailboxes; }, mailboxHasImap: () => true },
    "@/lib/email-inbox": { getEmailInboxBackendData: async (options: { mailboxId?: string; syncMailbox: boolean; context: unknown }) => {
      counts.inbox++;
      assert.equal(options.syncMailbox, false);
      assert.equal((options.context as { viewer: unknown }).viewer, viewer);
      assert.equal((options.context as { mailboxes: unknown }).mailboxes, mailboxes);
      return { selectedMailboxId: options.mailboxId ?? "mine", emails: [] };
    } },
    "@/lib/data/mailbox-sync": { loadSyncedMailbox: async () => { counts.sync++; } },
    "@/lib/data/crm": { getCompanyDetails: async (id: string) => ({ details: id === "customer" ? { company: { id, name: "Customer", email: "buyer@example.test" }, contacts: [{ email: "accounts@example.test" }] } : null }) },
    "@/lib/data/company-emails": { getCompanyEmailBackendData: async (company: { id: string; emails: string[] }, context: { viewer: unknown; mailboxes: unknown }) => {
      assert.equal(context.viewer, viewer);
      assert.equal(context.mailboxes, mailboxes);
      assert.deepEqual(company.emails.join(","), "buyer@example.test,accounts@example.test");
      companyReads.push(company.id);
      return { selectedMailboxId: null, emails: [{ id: "workspace-message", contact: "buyer@example.test" }] };
    } },
    "@/lib/data/email-auto-reply-worker": { processEmailAutoReplies: async () => undefined },
    "next/server": { after: (fn: () => Promise<void>) => background.push(fn) },
  };
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/inbox/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => dependencies[name], Response, Request, URL, performance, console,
  });
  return { ...exports, counts, background, companyReads, deny: () => { denied = true; } };
}

test("preloading authorizes once, reads mailbox settings once and starts no provider sync", async () => {
  const { GET, counts, background } = setup();
  const response = await GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=false"));
  assert.equal(response.status, 200);
  assert.deepEqual(counts, { auth: 1, mailboxes: 1, inbox: 1, sync: 0 });
  assert.equal(background.length, 0);
  assert.match(response.headers.get("Server-Timing")!, /auth;dur=.*inbox;dur=/);
});

test("active inbox refresh reuses authorized mailbox settings for background provider sync", async () => {
  const { GET, counts, background } = setup();
  assert.equal((await GET(new Request("http://localhost/api/email/inbox?mailboxId=team"))).status, 200);
  assert.equal(background.length, 1);
  await background[0]();
  assert.deepEqual(counts, { auth: 1, mailboxes: 1, inbox: 1, sync: 1 });
});

test("preloading cannot access another user's personal mailbox or bypass authentication", async () => {
  const deniedMailbox = setup();
  assert.equal((await deniedMailbox.GET(new Request("http://localhost/api/email/inbox?mailboxId=someone-else&refresh=false"))).status, 404);
  assert.equal(deniedMailbox.counts.inbox, 0);
  const anonymous = setup();
  anonymous.deny();
  await assert.rejects(anonymous.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=false")), /Unauthorized/);
  assert.equal(anonymous.counts.mailboxes, 0);
});

test("company refresh reads combined history and refreshes every authorized account", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?companyId=customer"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).emails[0].id, "workspace-message");
  assert.deepEqual(backend.companyReads, ["customer"]);
  assert.equal(backend.counts.inbox, 0, "Company history must not fall back to the default personal inbox");
  await backend.background[0]();
  assert.equal(backend.counts.sync, 2);
});

test("missing company cannot read or sync any mailbox", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?companyId=missing"));
  assert.equal(response.status, 404);
  assert.equal(backend.counts.inbox, 0);
  assert.equal(backend.companyReads.length, 0);
  assert.equal(backend.background.length, 0);
});
