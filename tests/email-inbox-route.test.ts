import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { currentWorkspaceContext } from "../lib/workspace-context.ts";
import { validProviderFolder } from "../lib/email-provider.ts";

function setup(queueFailure = false, mailboxReadFailed = false, inboxError: string | null = null, mailboxSnapshotPartial = false) {
  const viewer = { id: "actor", role: "bd_manager" };
  const mailboxes = [{ id: "mine", type: "personal", userId: "actor" }, { id: "team", type: "workspace" }];
  const counts = { auth: 0, mailboxes: 0, inbox: 0, sync: 0 };
  const worker = { health: 0, leases: 0, runs: 0 };
  const companyReads: string[] = [];
  const background: Array<() => Promise<void>> = [];
  const received: Array<{ id: string }> = [];
  let denied = false;
  const dependencies: Record<string, unknown> = {
    "@/lib/email-provider": { validProviderFolder },
    "@/lib/auth": { requireWorkspaceMember: async () => { counts.auth++; if (denied) throw new Error("Unauthorized"); return viewer; } },
    "@/lib/data/mailboxes": { getViewerMailboxes: async () => { counts.mailboxes++; return mailboxes; }, mailboxHasImap: () => true },
    "@/lib/data/company-email-access": { listCompanyEmailMailboxes: async () => [...mailboxes, { id: "other-staff", type: "personal" }] },
    "@/lib/email-inbox": { getEmailInboxBackendData: async (options: { mailboxId?: string; syncMailbox: boolean; context: unknown }) => {
      counts.inbox++;
      assert.equal(options.syncMailbox, false);
      assert.equal((options.context as { viewer: unknown }).viewer, viewer);
      assert.equal((options.context as { mailboxes: unknown }).mailboxes, mailboxes);
      assert.equal(currentWorkspaceContext()?.userId, viewer.id);
      return { selectedMailboxId: options.mailboxId ?? "mine", emails: [...received], mailboxReadFailed, inboxError, mailboxSnapshotPartial };
    } },
    "@/lib/data/mail-sync-worker": {
      enqueueMailboxSync: async () => { counts.sync++; if (queueFailure) throw new Error("Database unavailable"); },
      readMailboxSyncHealth: async () => { worker.health++; return { state: "waiting", history: "idle" }; },
      withMailSyncWorkerLease: async (run: () => Promise<unknown>) => { worker.leases++; return run(); },
      runMailSyncWorker: async (options: { seed: boolean; budgetMs: number; maxJobs: number }) => {
        assert.equal(options.seed, false, "Interactive refresh must not scan and seed all workspace accounts");
        assert.ok(options.budgetMs < 120_000);
        assert.equal(options.maxJobs, 8);
        assert.equal(currentWorkspaceContext()?.userId, viewer.id, "Deferred receiving must retain the authenticated workspace scope");
        worker.runs++;
        received.push({ id: "new-incoming-message" });
      },
    },
    "@/lib/data/crm": { getCompanyDetails: async (id: string) => ({ details: id === "customer" ? { company: { id, name: "Customer", email: "buyer@example.test" }, contacts: [{ email: "accounts@example.test" }] } : null }) },
    "@/lib/data/company-emails": { getCompanyEmailBackendData: async (company: { id: string; emails: string[] }, context: { viewer: unknown; mailboxes: unknown }) => {
      assert.equal(context.viewer, viewer);
      assert.equal(context.mailboxes, mailboxes);
      assert.deepEqual(company.emails.join(","), "buyer@example.test,accounts@example.test");
      companyReads.push(company.id);
      return { selectedMailboxId: null, emails: [{ id: "workspace-message", contact: "buyer@example.test" }], mailboxReadFailed, inboxError };
    } },
    "@/lib/data/email-auto-reply-worker": { processEmailAutoReplies: async () => undefined },
    "@/lib/data/conversation-tagging": { processAutomaticConversationTags: async () => ({ analyzed: 0 }) },
    "next/server": { after: (fn: () => Promise<void>) => background.push(fn) },
  };
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/inbox/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name]), Response, Request, URL, performance, console,
  });
  return { ...exports, counts, worker, background, companyReads, deny: () => { denied = true; } };
}

test("preloading authorizes once, reads mailbox settings once and starts no provider sync", async () => {
  const { GET, counts, worker, background } = setup();
  const response = await GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=false"));
  assert.equal(response.status, 200);
  assert.deepEqual(counts, { auth: 1, mailboxes: 1, inbox: 1, sync: 0 });
  assert.equal(background.length, 0);
  assert.equal(worker.health, 0, "Switching must not wait on worker-health queries");
  assert.equal(worker.runs, 0);
  assert.match(response.headers.get("Server-Timing")!, /auth;dur=.*inbox;dur=/);
});

test("active inbox refresh durably enqueues authorized work before returning", async () => {
  const { GET, counts, worker, background } = setup();
  assert.equal((await GET(new Request("http://localhost/api/email/inbox?mailboxId=team"))).status, 200);
  assert.equal(worker.runs, 0, "Returning saved messages never waits for IMAP");
  assert.equal(background.length, 2, "Receiving and tagging run after saved mail is returned");
  for (const run of background) await run();
  assert.equal(worker.leases, 1);
  assert.equal(worker.runs, 1, "The open inbox receives even without an external scheduler");
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

test("automatic refresh returns saved messages before queue, health or provider work", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=background"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).selectedMailboxId, "mine");
  assert.equal(backend.counts.sync, 0, "Automatic receiving cannot delay the saved snapshot");
  assert.equal(backend.worker.health, 0);
  assert.equal(backend.worker.runs, 0);
  for (const run of backend.background) await run();
  assert.equal(backend.counts.sync, 1);
  assert.equal(backend.worker.leases, 1);
  assert.equal(backend.worker.runs, 1);
  const nextPoll = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=false"));
  assert.equal((await nextPoll.json()).emails[0].id, "new-incoming-message", "The next saved-data poll displays mail imported after the first response");
  assert.equal(backend.counts.sync, 1, "A saved-data poll never duplicates receiving work");
});

test("a failed automatic queue does not start provider work and leaves saved messages usable", async () => {
  const backend = setup(true);
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=background"));
  assert.equal(response.status, 200);
  for (const run of backend.background) await run();
  assert.equal(backend.worker.runs, 0);
});

test("history progress can update without re-enqueuing a provider refresh", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=false&health=true"));
  assert.equal(response.status, 200);
  assert.equal(backend.worker.health, 1);
  assert.equal(backend.counts.sync, 0);
  assert.equal(backend.background.length, 0);
});

test("company refresh reads combined history and refreshes every authorized account", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?companyId=customer"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).emails[0].id, "workspace-message");
  assert.deepEqual(backend.companyReads, ["customer"]);
  assert.equal(backend.counts.inbox, 0, "Company history must not fall back to the default personal inbox");
  assert.equal(backend.counts.sync, 3);
});

test("automatic company polling does not rescan history for tags on every cache read", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?companyId=customer&refresh=false"));
  assert.equal(response.status, 200);
  assert.equal(backend.counts.sync, 0, "Saved history polling does not force an IMAP import");
  assert.equal(backend.background.length, 0, "The scheduled tag worker owns automatic history scans");
});

test("recent provider mail remains readable without adding more work to an overloaded cache", async () => {
  const backend = setup(false, false, null, true);
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=background&health=true"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mailboxSnapshotPartial, true);
  assert.equal(backend.counts.sync, 0);
  assert.equal(backend.worker.health, 0);
  assert.equal(backend.background.length, 0);
});

test("missing company cannot read or sync any mailbox", async () => {
  const backend = setup();
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?companyId=missing"));
  assert.equal(response.status, 404);
  assert.equal(backend.counts.inbox, 0);
  assert.equal(backend.companyReads.length, 0);
  assert.equal(backend.background.length, 0);
});

test("queue outages still return saved mail and an actionable refresh error", async () => {
  const backend = setup(true);
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=team"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.emails, []);
  assert.match(data.syncQueueError, /could not be queued/);
  assert.equal(data.selectedMailboxId, "team");
});

test("a failed saved-mail read cannot replace the client snapshot with an empty inbox", async () => {
  for (const params of ["mailboxId=mine", "companyId=customer"]) {
    const backend = setup(false, true, "canceling statement due to statement timeout");
    const response = await backend.GET(new Request(`http://localhost/api/email/inbox?${params}`));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const result = await response.json();
    assert.equal(result.emails, undefined, "A failed read must never advertise a replacement snapshot");
    assert.match(result.error, /messages are kept/);
    assert.ok(backend.counts.sync > 0, "Receiving can still recover independently");
  }
});

test("a provider error with a readable cache still returns an authoritative snapshot", async () => {
  const backend = setup(false, false, "Mailbox connection timed out");
  const response = await backend.GET(new Request("http://localhost/api/email/inbox?mailboxId=mine&refresh=false"));
  assert.equal(response.status, 200);
  assert.match((await response.json()).inboxError, /timed out/);
});
