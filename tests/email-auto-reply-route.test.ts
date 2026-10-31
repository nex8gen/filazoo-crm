import { policyTestDependency } from "./helpers/ai-policy.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { isAutoReplySchemaMissing } from "../lib/email-auto-reply.ts";

const id = "059639e7-d5ad-4ffd-a89c-e9fb85acba49";
function route() {
  let role = "admin";
  const calls: string[] = [];
  const background: Array<() => Promise<void>> = [];
  const dependencies: Record<string, unknown> = {
    zod: { z }, "next/server": { after: (action: () => Promise<void>) => background.push(action) },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Denied"); return { id, role }; } },
    "@/lib/email-auto-reply": { isAutoReplySchemaMissing },
    "@/lib/data/email-auto-reply-worker": { processEmailAutoReply: async () => { calls.push("process"); } },
    "@/lib/data/email-auto-reply": {
      enableAutoReply: async () => { calls.push("enable"); return { id, enabled: true }; },
      stopAutoReply: async () => { calls.push("stop"); return { id, enabled: false }; },
      approveAutoReplyShipping: async () => { calls.push("approve"); return { id, enabled: true }; },
      presentAutoReply: (value: unknown) => value,
      readAutoReplySetting: async () => null, getAutoReply: async () => ({ id }),
    },
  };
  const exports: { GET?: (request: Request) => Promise<Response>; POST?: (request: Request) => Promise<Response> } = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/email/auto-reply/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (name: string) => policyTestDependency(name) ?? (dependencies[name]), Response, URL });
  const post = (body: unknown, origin = "http://localhost") => exports.POST!(new Request("http://localhost/api/email/auto-reply", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { get: exports.GET!, post, calls, background, setRole: (value: string) => { role = value; } };
}

test("reading a conversation does not enable automation", async () => {
  const app = route();
  const response = await app.get(new Request(`http://localhost/api/email/auto-reply?mailboxId=${id}&messageId=%3Ctest%40example.com%3E`));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).automation, null);
  assert.equal(app.calls.length, 0);
});

test("enable records the opt-in but never processes previous customer mail", async () => {
  const app = route();
  assert.equal((await app.post({ action: "enable", mailboxId: id, senderId: id, messageId: "<test@example.com>", revision: 0 })).status, 200);
  assert.deepEqual(app.calls, ["enable"]);
  assert.equal(app.background.length, 0);
});

test("viewers and cross-origin requests cannot change automation", async () => {
  const app = route();
  assert.equal((await app.post({ action: "stop", id }, "https://attacker.example")).status, 403);
  app.setRole("viewer");
  await assert.rejects(app.post({ action: "stop", id }), /Denied/);
  assert.equal(app.calls.length, 0);
});

test("shipping validates money and schedules delivery only after successful approval", async () => {
  const app = route();
  for (const shippingMinor of [-1, 1.5, 100_000_001]) assert.equal((await app.post({ action: "shipping", id, revision: 1, shippingMinor })).status, 400);
  assert.equal(app.calls.length, 0);
  assert.equal((await app.post({ action: "shipping", id, revision: 1, shippingMinor: 0 })).status, 200);
  assert.deepEqual(app.calls, ["approve"]);
  assert.equal(app.background.length, 1);
  await app.background[0]();
  assert.deepEqual(app.calls, ["approve", "process"]);
});
