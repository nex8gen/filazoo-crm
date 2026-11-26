import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { customerConversationRows, conversationMessagesSchema, conversationRequestSchema } from "../lib/ai/customer-conversations.ts";
import { parseResponsePresentation } from "../lib/ai/response-presentation.ts";
import * as threading from "../lib/email-threading.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

const companyId = "988658d7-90ee-4d2d-a93b-b7ccf57b4af7";
const email = (id: string, extra: Partial<InboxEmailItem> = {}): InboxEmailItem => ({ id, threadId: "thread-a", contact: "buyer@test.com", company: "Print Studio", direction: "inbound", subject: "Filament enquiry", timestamp: "2026-11-25T16:03:00Z", body: "Please quote PLA.", preview: "", status: "Received", ...extra });

test("conversation rows use the profile's grouping, retain the latest reply and omit unrelated record fields", () => {
  const rows = customerConversationRows(companyId, "Print Studio", [email("received"), email("sent", { direction: "outbound", from: "enphany@test.com", timestamp: "2026-11-26T01:39:00Z" }), email("second", { threadId: "thread-b" })]);
  assert.equal(rows.threads.length, 2);
  assert.equal(rows.threads[0].sender, "enphany@test.com");
  assert.equal(rows.threads[0].direction, "outbound");
  assert.equal(rows.threads[0].timestamp, "2026-11-26T01:39:00.000Z");
  assert.doesNotMatch(JSON.stringify(rows), /Please quote PLA|body|password|fitScore/);
  assert.ok(parseResponsePresentation({ version: 1, capturedAt: new Date().toISOString(), sections: [], conversations: [rows] }));
  assert.equal(parseResponsePresentation({ version: 1, capturedAt: new Date().toISOString(), sections: [] }), undefined);
  const bounded = customerConversationRows(companyId, "Print Studio", Array.from({ length: 30 }, (_, i) => email(String(i), { threadId: `thread-${i}` })));
  assert.equal(bounded.threads.length, 20); assert.equal(bounded.more, true);
});

function endpoint({ signedIn = true, disabled = false, denied = false } = {}) {
  let reads = 0, bodies = 0;
  const dependencies: Record<string, unknown> = {
    "@/lib/auth": { getWorkspaceViewer: async () => signedIn ? { id: "viewer" } : null },
    "@/lib/workspace-context": { withWorkspaceViewer: (_viewer: unknown, run: () => unknown) => run() },
    "@/lib/data/ai-settings": { requireAiFeature: async () => { if (disabled) throw new Error("PRIVATE POLICY DETAIL"); } },
    "@/lib/ai/customer-conversations": { conversationMessagesSchema, conversationRequestSchema },
    "@/lib/email-threading": threading,
    "@/lib/ai/customer-email-history": {
      isCustomerHistoryMessage: (message: InboxEmailItem) => message.status !== "Draft",
      loadCustomerEmailHistories: async () => { reads++; return new Map([[companyId, denied ? null : { emails: [email("one"), email("two", { direction: "outbound", from: "enphany@test.com" }), email("private", { threadId: "private-thread", body: "PRIVATE OTHER THREAD" }), email("draft", { status: "Draft" })] }]]); },
      loadCustomerEmailBody: async (_viewer: unknown, _companyId: string, message: InboxEmailItem) => { bodies++; return message; },
    },
  };
  const exports = {} as typeof import("../app/api/ai/assistant/conversations/route.ts");
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/ai/assistant/conversations/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => dependencies[name], Response, URL, Date });
  return { get: (id = companyId, threadId = "thread-a", origin = "https://crm.test") => exports.GET(new Request(`https://crm.test/api/ai/assistant/conversations?${new URLSearchParams({ companyId: id, threadId })}`, { headers: { origin } })), reads: () => reads, bodies: () => bodies };
}

test("expanding a conversation reads only that authorized thread and returns dated plain text", async () => {
  const api = endpoint(), response = await api.get();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.messages.length, 2);
  assert.equal(result.messages[1].sender, "enphany@test.com");
  assert.equal(api.bodies(), 2);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE OTHER THREAD|draft/);
});

test("conversation expansion enforces sign-in, feature settings, company access, origin and thread ownership", async () => {
  for (const [options, expected] of [[{ signedIn: false }, 401], [{ disabled: true }, 403], [{ denied: true }, 404]] as const) {
    const api = endpoint(options), response = await api.get();
    assert.equal(response.status, expected); assert.equal(api.bodies(), 0);
    assert.doesNotMatch(await response.text(), /PRIVATE POLICY/);
  }
  const api = endpoint();
  assert.equal((await api.get("invalid-id")).status, 400);
  assert.equal((await api.get(companyId, "thread-a", "https://other.test")).status, 403);
  assert.equal(api.reads(), 0);
  assert.equal((await api.get(companyId, "not-saved")).status, 404);
  assert.equal(api.bodies(), 0);
});
