import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);

test("read-only viewers cannot send email, even by calling the HTTP handler directly", async () => {
  let role = "viewer";
  let mailboxReads = 0;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => {
      if (!roles.includes(role)) throw new Error("Access denied");
      return { id: "actor", role };
    } },
    "@/lib/data/mailboxes": { getEffectiveMailbox: () => { mailboxReads++; throw new Error("No mailbox should be contacted"); } },
    "@/lib/mailer": { sendMailboxEmail: () => { throw new Error("Tests must not send emails"); } },
    "@/lib/supabase/admin": {},
    "@/lib/email-threading": {},
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/email/send/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name), Response, Request, Buffer, crypto, console });
  const request = () => new Request("http://localhost:3000/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await assert.rejects(exports.POST!(request()), /Access denied/);
  for (role of ["admin", "operator", "bd_manager"]) assert.equal((await exports.POST!(request())).status, 400);
  assert.equal(mailboxReads, 0);
});
