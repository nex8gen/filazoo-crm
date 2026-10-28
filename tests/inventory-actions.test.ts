import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { LingxingError } from "../lib/lingxing.ts";

function fixture(role: string | null, failure?: Error) {
  let calls = 0;
  const paths: string[] = [];
  const exports: Record<string, unknown> = {};
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "@/lib/auth": { requireWorkspaceMember: async (roles: string[]) => { if (!role || !roles.includes(role)) throw new Error("Access denied"); } },
    "@/lib/data/inventory": { syncErpInventory: async () => { calls++; if (failure) throw failure; return { skipped: false, count: 3 }; } },
    "@/lib/lingxing": { LingxingError },
  };
  const source = ts.transpileModule(readFileSync(new URL("../app/inventory-actions.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; } });
  return { sync: exports.syncInventory as () => Promise<{ ok: boolean; error?: string; count?: number }>, calls: () => calls, paths };
}

test("only administrators and operators can request ERP synchronization", async () => {
  for (const role of [null, "viewer", "bd_manager"]) {
    const action = fixture(role);
    await assert.rejects(action.sync, /Access denied/);
    assert.equal(action.calls(), 0);
  }
  for (const role of ["admin", "operator"]) {
    const action = fixture(role);
    const result = await action.sync();
    assert.equal(result.ok, true);
    assert.equal(result.count, 3);
    assert.deepEqual(action.paths, ["/catalogs"]);
  }
});

test("failed stock syncs do not report success or expose internal failures", async () => {
  const action = fixture("admin", new Error("secret database details"));
  const result = await action.sync();
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error ?? "", /secret database details/);
  assert.deepEqual(action.paths, []);
  const upstream = fixture("operator", new LingxingError("Lingxing rejected the request (code 3001008)."));
  assert.match((await upstream.sync()).error ?? "", /3001008/);
});

test("cron worker rejects missing or wrong bearer secrets before touching inventory", async () => {
  const source = ts.transpileModule(readFileSync(new URL("../app/api/cron/inventory/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [secret, authorization] of [[undefined, "Bearer undefined"], ["correct", "Bearer wrong"]]) {
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(source, { exports, Buffer, Response, process: { env: { CRON_SECRET: secret } }, require: (name: string) => {
      if (name === "node:crypto") return { timingSafeEqual: () => false };
      if (name === "@/lib/data/inventory") return { syncErpInventory: () => { throw new Error("Must not run"); } };
      if (name === "@/lib/data/erp-settings") return { erpWorkerAuthorized: async () => false, configuredErp: () => { throw new Error("Must not read config"); } };
      if (name === "@/lib/lingxing") return { lingxingConfig: () => { throw new Error("Must not read config"); }, LingxingError };
      throw new Error(`Unexpected dependency ${name}`);
    } });
    const response = await (exports.GET as (request: Request) => Promise<Response>)(new Request("https://crm.example/api/cron/inventory", { headers: { authorization: authorization! } }));
    assert.equal(response.status, 401);
  }
});
