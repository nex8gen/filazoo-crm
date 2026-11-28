import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import sharp from "sharp";
import * as schemas from "../lib/workspace-settings.ts";
import * as workspaces from "../lib/workspaces.ts";

const require = createRequire(import.meta.url);
type Action = (state: undefined, data: FormData) => Promise<{ error?: string; success?: string }>;
function actions(role = "admin", failed = false) {
  const writes: { updates: Record<string, unknown>; filters: unknown[][]; actor: string | undefined }[] = [];
  const invalidated: unknown[][] = [];
  const api: { saveWorkspaceDetails: Action; saveWorkspaceSchedule: Action } = {} as never;
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: (...args: unknown[]) => invalidated.push(args) },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!roles.includes(role)) throw new Error("Denied"); return { id: "admin-user", workspaceId: "current-workspace" }; } },
    "@/lib/workspaces": workspaces, "@/lib/workspace-settings": schemas,
    "@/lib/supabase/control": { createSupabaseControl: (actor?: string) => ({ from: (table: string) => {
      assert.equal(table, "workspaces");
      return { update: (updates: Record<string, unknown>) => {
        const entry = { updates, filters: [] as unknown[][], actor }; writes.push(entry);
        const query = { eq: (...args: unknown[]) => { entry.filters.push(args); return query; }, select: () => query,
          single: async () => failed ? { data: null, error: { message: "Offline" } } : { data: { id: "current-workspace" }, error: null } };
        return query;
      } };
    } }) },
  };
  const code = ts.transpileModule(readFileSync(new URL("../app/settings/workspace/actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports: api, require: (id: string) => dependencies[id] ?? require(id), Buffer, File, Date });
  return { api, writes, invalidated };
}
const details = () => { const form = new FormData(); form.set("name", "My workspace"); form.set("website", "example.com"); form.set("workspaceId", "foreign-workspace"); return form; };
const schedule = () => { const form = new FormData(); form.set("timezone", "America/New_York"); form.append("days", "1"); form.append("days", "5"); form.set("start", "08:30"); form.set("end", "17:30"); return form; };

test("only administrators can update workspace details or schedules", async () => {
  for (const role of ["viewer", "operator", "bd_manager"]) {
    const { api, writes } = actions(role);
    await assert.rejects(api.saveWorkspaceDetails(undefined, details()), /Denied/);
    await assert.rejects(api.saveWorkspaceSchedule(undefined, schedule()), /Denied/);
    assert.equal(writes.length, 0);
  }
});
test("saves use the current workspace and actor, normalize websites and invalidate retained views", async () => {
  const { api, writes, invalidated } = actions();
  assert.ok((await api.saveWorkspaceDetails(undefined, details())).success);
  assert.equal(writes[0].updates.website, "https://example.com");
  assert.deepEqual(writes[0].filters[0], ["id", "current-workspace"]);
  assert.equal(writes[0].actor, "admin-user");
  assert.equal("logo_data_url" in writes[0].updates, false, "saving text preserves the existing logo");
  assert.deepEqual(invalidated[0], ["/", "layout"]);
  const failed = actions("admin", true);
  assert.ok((await failed.api.saveWorkspaceDetails(undefined, details())).error);
  assert.equal(failed.invalidated.length, 0);
});
test("logo uploads are decoded, resized and re-encoded; spoofed or oversized files never save", async () => {
  const png = await sharp({ create: { width: 600, height: 300, channels: 4, background: "#124782" } }).png().toBuffer();
  const { api, writes } = actions(); const form = details(); form.set("logo", new File([new Uint8Array(png)], "logo.png", { type: "image/png" }));
  assert.ok((await api.saveWorkspaceDetails(undefined, form)).success);
  const encoded = String(writes[0].updates.logo_data_url);
  assert.ok(encoded.startsWith("data:image/webp;base64,"));
  const image = await sharp(Buffer.from(encoded.split(",")[1], "base64")).metadata();
  assert.equal(image.format, "webp"); assert.equal(image.width, 256); assert.equal(image.height, 128);
  for (const file of [new File([new Uint8Array(schemas.workspaceLogoMaxBytes + 1)], "big.png", { type: "image/png" }), new File(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'], "spoof.png", { type: "image/png" })]) {
    const testCase = actions(); const input = details(); input.set("logo", file);
    assert.ok((await testCase.api.saveWorkspaceDetails(undefined, input)).error);
    assert.equal(testCase.writes.length, 0);
  }
  const removal = details(); removal.set("removeLogo", "true");
  await api.saveWorkspaceDetails(undefined, removal);
  assert.equal(writes[1].updates.logo_data_url, null);
});
test("invalid schedules never write; valid schedules preserve workspace details", async () => {
  const { api, writes } = actions();
  for (const change of [(f: FormData) => f.delete("days"), (f: FormData) => f.set("timezone", "Invalid/Timezone"), (f: FormData) => f.set("end", "08:00")]) {
    const form = schedule(); change(form);
    assert.ok((await api.saveWorkspaceSchedule(undefined, form)).error);
  }
  assert.equal(writes.length, 0);
  assert.ok((await api.saveWorkspaceSchedule(undefined, schedule())).success);
  assert.equal(writes[0].updates.timezone, "America/New_York");
  assert.equal("name" in writes[0].updates, false);
  assert.equal("website" in writes[0].updates, false);
  assert.deepEqual(writes[0].filters[0], ["id", "current-workspace"]);
});
