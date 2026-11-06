import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { aiUsageSettingsSchema } from "../lib/ai/usage-settings.ts";
import { budgetFailure } from "../lib/ai/budget.ts";

const userId = "a1111111-1111-4111-8111-111111111111";
const policy = { revision: 0, monthlyMicros: 30000000, dailyMicros: null, minimumShares: 5, members: [{ userId, enabled: true, dailyMicros: null }] };

test("usage controls validate currency bounds, zero caps, duplicate users and server-owned identity", () => {
  assert.equal(aiUsageSettingsSchema.safeParse(policy).success, true);
  assert.equal(aiUsageSettingsSchema.safeParse({ ...policy, dailyMicros: 0, members: [{ userId, enabled: false, dailyMicros: 0 }] }).success, true);
  for (const invalid of [
    { ...policy, monthlyMicros: -1 }, { ...policy, monthlyMicros: 1 }, { ...policy, dailyMicros: 1.5 },
    { ...policy, members: [...policy.members, ...policy.members] }, { ...policy, actorId: userId },
    { ...policy, members: [{ ...policy.members[0], dailyMicros: -1 }] },
  ]) assert.equal(aiUsageSettingsSchema.safeParse(invalid).success, false);
});

test("only an authenticated administrator saves usage settings with trusted workspace scope", async () => {
  let allowed = false, writes = 0, scoped = false;
  const exports: Record<string, (input: unknown) => Promise<unknown>> = {};
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: (path: string) => assert.equal(path, "/settings/ai") },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { assert.deepEqual(Array.from(roles), ["admin"]); if (!allowed) throw new Error("Access denied"); return { id: userId, workspaceId: "legacy" }; } },
    "@/lib/workspace-context": { withWorkspaceViewer: async (viewer: { id: string }, work: () => unknown) => { assert.equal(viewer.id, userId); scoped = true; return work(); } },
    "@/lib/ai/usage-settings": { aiUsageSettingsSchema },
    "@/lib/data/ai-usage-settings": { saveAiUsageSettings: async (input: unknown, actor: string) => { assert.equal(scoped, true); assert.equal(actor, userId); assert.deepEqual(JSON.parse(JSON.stringify(input)), policy); writes++; return policy; } },
  };
  const source = readFileSync(new URL("../app/settings/ai-usage-actions.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: (name: string) => dependencies[name], Error });
  await assert.rejects(exports.updateAiUsageSettings(policy), /Access denied/); assert.equal(writes, 0);
  allowed = true;
  const invalid = await exports.updateAiUsageSettings({ ...policy, monthlyMicros: -10 }) as { error: string };
  assert.match(invalid.error, /spending limits/); assert.equal(writes, 0);
  await exports.updateAiUsageSettings(policy); assert.equal(writes, 1);
});

test("a paused member receives an actionable access error instead of an exhausted-allowance error", () => {
  const failure = budgetFailure("user_disabled");
  assert.equal(failure.status, 403); assert.match(failure.message, /paused for your account/);
});
