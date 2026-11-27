// Read-only check against the configured database and local app.
// Two-way sends, retries, and role boundaries are covered by website-messenger
// and messenger-inbox-ui tests, without creating orders or contacting customers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { websiteMessageThreads } from "../lib/messenger.ts";
import { defaultPortalDesign, portalDesignSchema, portalSectionEnabled } from "../lib/portal-design.ts";

const require = createRequire(import.meta.url);
const origin = process.env.PORTAL_TEST_ORIGIN || "http://localhost:3000";
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const control = createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-crm-control": "1" } } });
const workspace = await control.from("workspaces").select("id").eq("is_legacy", true).single();
if (workspace.error) throw workspace.error;
const db = createClient(url, key, { auth: { persistSession: false }, global: { headers: { "x-crm-workspace-id": workspace.data.id } } });
const exports: Record<string, unknown> = {};
const source = ts.transpileModule(readFileSync(new URL("../lib/data/messenger.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const dependencies: Record<string, unknown> = {
  "../supabase/admin": { createSupabaseAdmin: () => db }, "../meta-messenger": {}, "../auth": {}, "../invoice-permissions": {},
  "../portal-design": { defaultPortalDesign, portalDesignSchema, portalSectionEnabled }, "../messenger": { websiteMessageThreads },
};
vm.runInNewContext(source, { exports, Response, console, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name) });
const read = exports.getWebsiteInboxData as () => Promise<{ connected: boolean; threads: ReturnType<typeof websiteMessageThreads> }>;
const snapshot = await read();
for (const thread of snapshot.threads) {
  assert.equal(thread.id, "web:" + thread.invoiceId);
  assert.equal(thread.channel, "web");
  assert.equal(thread.replyWindowEndsAt, null);
  assert.equal(thread.replyWindowOpen, true);
}
const customer = await fetch(origin + "/api/customer/invoices/" + randomUUID(), { redirect: "manual" });
assert.equal(customer.status, 401);
const staff = await fetch(origin + "/api/messenger/website", { redirect: "manual" });
assert.ok([401, 307].includes(staff.status), "Anonymous users must not read the website inbox.");
console.log(JSON.stringify({ workspaceScopedWebsiteReader: "passed", websiteConnected: snapshot.connected, conversations: snapshot.threads.length, anonymousCustomerBlocked: true, anonymousStaffBlocked: true, writes: 0 }));
