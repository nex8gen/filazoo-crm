import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { leadAssignmentSettingsSchema } from "../lib/lead-assignment-settings.ts";

function fixture(role = "admin", failure = false) {
  const writes: unknown[][] = [];
  const paths: string[] = [];
  const exports: Record<string, (input: unknown) => Promise<{ error?: string; saved?: unknown }>> = {};
  const viewer = { id: "admin-id", workspaceId: "tenant-id", role };
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Access denied"); return viewer; } },
    "@/lib/workspace-context": { withWorkspaceViewer: (actor: unknown, work: () => unknown) => { assert.equal(actor, viewer); return work(); } },
    "@/lib/lead-assignment-settings": { leadAssignmentSettingsSchema },
    "@/lib/data/lead-assignment-settings": { saveLeadAssignmentSettings: async (...args: unknown[]) => { writes.push(args); if (failure) throw new Error("Conflicting settings; reload."); return { revision: 1 }; } },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/settings/lead-assignment-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Error, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { action: exports.updateLeadAssignmentSettings, writes, paths };
}
const input = () => ({ revision: 0, enabled: false, strategy: "round_robin", workload: "open", members: [{ userId: "aaaaaaaa-1111-4111-8111-111111111111", enabled: false, capacity: 10 }] });

test("assignment settings save validated false toggles in the authenticated workspace and refresh both controls", async () => {
  const { action, writes, paths } = fixture();
  assert.equal((await action(input())).error, undefined);
  assert.deepEqual(writes, [[input(), "admin-id"]]);
  assert.deepEqual(paths, ["/settings/advanced", "/settings/team"]);
});

test("assignment settings reject read-only roles and forged invalid capacities before database writes", async () => {
  for (const role of ["operator", "bd_manager", "viewer"]) {
    const { action, writes, paths } = fixture(role);
    await assert.rejects(action(input()), /Access denied/);
    assert.deepEqual(writes, []); assert.deepEqual(paths, []);
  }
  const { action, writes } = fixture();
  assert.ok((await action({ ...input(), members: [{ ...input().members[0], capacity: -1 }] })).error);
  assert.deepEqual(writes, []);
});

test("database conflicts return an actionable error and never claim a save succeeded", async () => {
  const { action, paths } = fixture("admin", true);
  const result = await action(input());
  assert.match(result.error || "", /reload/);
  assert.equal(result.saved, undefined);
  assert.deepEqual(paths, []);
});
