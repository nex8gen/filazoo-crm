import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as files from "../lib/email-files.ts";

function setup(allowed = true) {
  const downloads: unknown[][] = [];
  const source = { mailbox: { id: "server-owner-mailbox" }, uid: 42, validity: 1, folder: "INBOX" };
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "viewer", role: "bd_manager" }) },
    "@/lib/data/crm-email-content": { readCrmReceivedEmail: async (_viewer: unknown, _id: string, options: { includeContent: boolean }) => {
      assert.equal(options.includeContent, false);
      return allowed ? { source, email: { attachments: [{ partId: "7" }] } } : null;
    } },
    "@/lib/mailbox-imap": { downloadMailboxAttachment: async (...args: unknown[]) => { downloads.push(args); return { filename: "icon.bin", contentType: "application/octet-stream", content: Buffer.from("424d5a0d000000000000360000002800000001000000010000000100", "hex") }; } },
    "@/lib/email-files": files,
  };
  const exports = {} as { GET: (request: Request) => Promise<Response> };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/crm-attachment/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Response, URL, Uint8Array, console });
  return { ...exports, downloads, source };
}
const base = "https://crm.test/api/email/crm-attachment?id=00000000-0000-4000-8000-000000000001";
test("CRM attachment downloads use only the server-resolved source and verify the MIME part", async () => {
  const app = setup();
  const response = await app.GET(new Request(base + "&part=7&mailbox=someone-else&uid=999&folder=Private"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/bmp");
  assert.match(response.headers.get("Content-Disposition")!, /^inline;/);
  assert.deepEqual(app.downloads[0], [app.source.mailbox, 42, 1, "7", "INBOX"]);
  assert.equal((await app.GET(new Request(base + "&part=8"))).status, 404);
  assert.equal(app.downloads.length, 1);
});
test("revoked CRM access and malformed identifiers never reach the personal provider", async () => {
  const app = setup(false);
  assert.equal((await app.GET(new Request(base + "&part=7"))).status, 404);
  assert.equal((await app.GET(new Request(base + "&part=../../7"))).status, 400);
  assert.equal(app.downloads.length, 0);
});
