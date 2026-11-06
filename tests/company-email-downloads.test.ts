import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as files from "../lib/email-files.ts";
import * as provider from "../lib/email-provider.ts";
import * as companyEmail from "../lib/company-email.ts";

function load(path: string, dependencies: Record<string, unknown>) {
  const exports = {} as { GET: (request: Request, context?: unknown) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Response, URL, Uint8Array, ReadableStream });
  return exports;
}

test("company message/original/attachment routes require exact authorization and never fall back to a colleague's mailbox", async () => {
  const downloads: string[] = [];
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "admin" }) },
    "@/lib/data/company-email-access": { readCompanyMailboxEmail: async (_viewer: unknown, company: string, source: { uid: number }) => company === "allowed" && source.uid === 42
      ? { mailbox: { id: "colleague" }, email: { body: "Customer message", attachments: [{ partId: "2" }] } } : null },
    "@/lib/data/mailboxes": { mailboxHasImap: () => true, getViewerMailboxes: async () => { throw new Error("Company reads must not fall back to general mailbox access"); } },
    "@/lib/data/mailbox-sync": {}, "@/lib/data/email-access": {}, "@/lib/email-access": {},
    "@/lib/email-provider": provider, "@/lib/email-files": files,
    "@/lib/mailbox-imap": {
      downloadMailboxOriginal: async () => { downloads.push("original"); return Buffer.from("From: customer@test\r\n\r\nCustomer message"); },
      downloadMailboxAttachment: async () => { downloads.push("attachment"); return { filename: "file.txt", contentType: "text/plain", content: Buffer.from("Customer attachment") }; },
    },
  };
  for (const name of ["message", "original", "received-attachment"]) {
    const route = load(`../app/api/email/${name}/route.ts`, dependencies);
    const request = (company: string, part = "2", uid = 42) => new Request(`http://crm/api/email/${name}?companyId=${company}&mailbox=key&uid=${uid}&validity=7&part=${part}`);
    assert.equal((await route.GET(request("allowed"))).status, 200);
    assert.equal((await route.GET(request("denied"))).status, 404);
    assert.equal((await route.GET(request("allowed", "2", 99))).status, 404);
    if (name === "received-attachment") assert.equal((await route.GET(request("allowed", "99"))).status, 404);
  }
  assert.deepEqual(downloads, ["original", "attachment"]);
});

test("company sent attachments use the actual sender's private storage prefix and reject unrelated/unsent mail", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const row = { user_id: "colleague", mailbox_id: "personal", to_email: "buyer@test", cc_recipients: [] as { address: string }[], status: "sent", attachments: [{ path: `colleague/${id}/0`, filename: "file.txt", contentType: "text/plain" }] };
  let downloads = 0;
  const query = { select() { return query; }, eq() { return query; }, maybeSingle: async () => ({ data: row, error: null }) };
  const route = load("../app/api/email/attachments/[id]/[index]/route.ts", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "actor", role: "admin" }) },
    "@/lib/data/company-email-access": { getCompanyEmailScope: async (_viewer: unknown, company: string) => company === "allowed" ? { emails: ["buyer@test"] } : null },
    "@/lib/company-email": companyEmail, "@/lib/email-files": files,
    "@/lib/data/email-access": { getAssignedEmailContacts: async () => null }, "@/lib/email-access": {},
    "@/lib/data/mailboxes": { getViewerMailbox: async () => { throw new Error("Reading does not grant the colleague's mailbox"); } },
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ from: () => query, storage: { from: () => ({ download: async () => { downloads++; return { data: new Blob(["Customer attachment"]), error: null }; } }) } }) },
  });
  const download = (company = "allowed") => route.GET(new Request(`http://crm/api/email/attachments/${id}/0?companyId=${company}`), { params: Promise.resolve({ id, index: "0" }) });
  assert.equal((await download()).status, 200);
  assert.equal((await download("denied")).status, 404);
  row.to_email = "private@test";
  assert.equal((await download()).status, 404);
  row.cc_recipients = [{ address: "buyer@test" }];
  assert.equal((await download()).status, 200, "An exact saved CC customer can download this sent message's attachment");
  row.cc_recipients = [];
  row.to_email = "buyer@test"; row.status = "failed";
  assert.equal((await download()).status, 404);
  row.status = "sent"; row.attachments[0].path = `another-person/${id}/0`;
  assert.equal((await download()).status, 404);
  assert.equal(downloads, 2);
});
