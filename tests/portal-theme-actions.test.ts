import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as designTools from "../lib/portal-design.ts";
import * as themeTools from "../lib/portal-themes.ts";
import { translateUiText } from "../lib/i18n.ts";

function actions(role = "admin") {
  const writes: unknown[][] = [];
  const invalidated: unknown[][] = [];
  let scoped = false;
  const view: designTools.PortalDesignView = { draft: designTools.defaultPortalDesign(), published: null, revision: 2, updatedAt: null, publishedAt: null };
  const record = async (...args: unknown[]) => { assert.equal(scoped, true, "Writes must use the authenticated workspace"); writes.push(args); return view; };
  const deps: Record<string, unknown> = {
    zod: { z },
    "next/cache": { revalidatePath: (...args: unknown[]) => invalidated.push(args) },
    "@/lib/auth": { requireWorkspaceMember: async (allowed: string[]) => { assert.deepEqual([...allowed], ["admin"]); if (role !== "admin") throw new Error("Forbidden"); return { id: "admin-id", workspaceId: "workspace-a", workspaceName: "Test business" }; } },
    "@/lib/workspace-context": { withWorkspaceViewer: async (viewer: { workspaceId: string }, work: () => unknown) => { assert.equal(viewer.workspaceId, "workspace-a"); scoped = true; try { return await work(); } finally { scoped = false; } } },
    "@/lib/portal-design": designTools,
    "@/lib/portal-themes": themeTools,
    "@/lib/data/portal-design": { getPortalDesign: async () => view, savePortalDesign: record, managePortalTheme: record, addPortalTheme: async (...args: unknown[]) => ({ saved: await record(...args), themeId: "new-theme" }) },
  };
  const exports = {} as typeof import("../app/customer-portal/actions.ts");
  const require = createRequire(import.meta.url);
  const code = ts.transpileModule(readFileSync("app/customer-portal/actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => deps[name] ?? require(name) });
  return { api: exports, writes, invalidated };
}

test("all theme mutations require an admin, including direct server action requests", async () => {
  const { api, writes } = actions("viewer");
  await assert.rejects(api.changePortalTheme({ themeId: "current", revision: 2, action: "remove" }), /Forbidden/);
  await assert.rejects(api.createPortalTheme({ templateId: "studio", revision: 2 }), /Forbidden/);
  await assert.rejects(api.publishPortalTheme({ themeId: "current", revision: 2 }), /Forbidden/);
  await assert.rejects(api.updatePortalDesign({ design: designTools.defaultPortalDesign(), revision: 2, publish: true }), /Forbidden/);
  assert.equal(writes.length, 0);
});

test("library actions validate input and bind mutations to the authenticated workspace before revalidation", async () => {
  const { api, writes, invalidated } = actions();
  for (const input of [
    { action: "rename", themeId: "current", revision: 2, name: " " },
    { action: "rename", themeId: "current", revision: 2, name: "x".repeat(81) },
    { action: "remove", themeId: "../another-tenant", revision: 2 },
    { action: "restore", themeId: "current", revision: -1 },
    { action: "remove", themeId: "current", revision: 2, workspaceId: "other-workspace" },
  ]) assert.ok((await api.changePortalTheme(input)).error);
  assert.equal(writes.length, 0);
  const result = await api.changePortalTheme({ action: "rename", themeId: "current", revision: 2, name: "  New name  " });
  assert.ok(result.saved);
  assert.equal(writes.length, 1);
  assert.equal((writes[0][2] as { name: string }).name, "New name");
  assert.deepEqual(invalidated[0], ["/customer-portal", "layout"]);
  await api.createPortalTheme({ templateId: "studio", revision: 2 });
  assert.equal(writes[1][3], "Test business");
});

test("portal controls and dynamic status messages translate while preserving custom theme names", () => {
  assert.equal(translateUiText("More actions for Acme Autumn", "zh-CN"), "Acme Autumn 的更多操作");
  assert.equal(translateUiText("Publish Acme Autumn?", "zh-CN"), "发布 Acme Autumn？");
  assert.equal(translateUiText("Acme Autumn is now published.", "zh-CN"), "Acme Autumn 已发布。");
  assert.equal(translateUiText("Preview published version", "zh-CN"), "预览已发布版本");
  assert.equal(translateUiText("Restore published version", "en"), "Restore published version");
});
