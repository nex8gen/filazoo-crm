import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { applySharedManualStock, manualStockTotal } from "../lib/shared-product-inventory.ts";
import * as inventory from "../lib/product-inventory.ts";
import * as productUtils from "../lib/product-utils.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";
import type { ManualStockLocation } from "../lib/types.ts";

const require = createRequire(import.meta.url);
const revision = "11111111-1111-4111-8111-111111111111";
const row = (location: string, quantity: number | null): ManualStockLocation => ({ location, quantity, revision, updated_at: "2026-11-18T10:00:00Z" });

test("team stock overrides different personal quantities without silently sharing legacy numbers", () => {
  const first = { ...b2bProducts[0], manualInventory: 55 };
  const second = { ...first, manualInventory: 999 };
  const rows = [{ sku: first.sku, ...row("Main", 0) }, { sku: first.sku, ...row("Second", 21) }];
  const a = applySharedManualStock([first], rows)[0];
  const b = applySharedManualStock([second], rows)[0];
  assert.equal(a.manualInventory, 21);
  assert.equal(b.manualInventory, 21);
  assert.equal(a.sharedInventory?.legacyQuantity, 55);
  assert.equal(first.manualInventory, 55);
  assert.equal(applySharedManualStock([first], [])[0].manualInventory, null);
  assert.equal(manualStockTotal({ locations: [] }), null);
  assert.equal(manualStockTotal({ locations: [row("Main", 0)] }), 0);
  assert.equal(manualStockTotal({ locations: [row("Main", 21), row("Second", null)] }), null);
});

test("connected ERP stock still takes priority over shared manual stock", () => {
  const product = b2bProducts[0];
  const shared = applySharedManualStock([product], [{ sku: product.sku, ...row("Manual", 21) }]);
  const [connected] = inventory.applyProductInventory(shared, [{ sku: product.sku, available: 407, on_hand: 410, locked: 3, warehouse_ids: ["1"], synced_at: new Date().toISOString() }]);
  assert.equal(inventory.inventoryLabel(connected), "407 available");
});

function actions(options: { denied?: boolean; connected?: boolean; conflict?: boolean } = {}) {
  let authorized = false;
  const writes: Record<string, unknown>[] = [];
  const authRoles: unknown[] = [];
  const baseline = { sku: "PLA", name: "PLA", price: 5, currency: "USD", color: "White", active: true, image_url: null, tags: [productUtils.variantTag([{ id: "white", name: "White", sku: "PLA-WHITE", price: "$5.00", stockStatus: "Unknown", imageUrl: null }])], sheet_updated_at: null, description: null, material: "PLA", diameter: null, weight: null, moq: 1, lead_time: null, stock_status: "Unknown" };
  const dependencies: Record<string, unknown> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { requireWorkspaceMember: async (roles: unknown) => { authRoles.push(roles); if (options.denied) throw new Error("Denied"); authorized = true; return { id: "user", workspaceId: "workspace" }; } },
    "@/lib/data/product-personalization": { userProductRows: async () => { assert.ok(authorized); return [baseline]; } },
    "@/lib/data/shared-product-inventory": {},
    "@/lib/data/inventory": { getInventoryState: async () => ({ status: {}, skuMap: {}, snapshots: options.connected ? [{ sku: "PLA-WHITE", available: 0, on_hand: 0, locked: 0, warehouse_ids: [], synced_at: new Date().toISOString() }] : [] }) },
    "@/lib/product-inventory": inventory, "@/lib/product-utils": productUtils,
    "@/lib/supabase/admin": { createSupabaseAdmin: () => ({ rpc: async (_: string, value: Record<string, unknown>) => { assert.ok(authorized); writes.push(value); return options.conflict ? { error: { code: "40001" } } : { data: revision, error: null }; } }) },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync("app/product-stock-actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => dependencies[name] ?? require(name) });
  return { api: exports as typeof import("../app/product-stock-actions.ts"), writes, authRoles };
}
const input = { productSku: "PLA", sku: "PLA-WHITE", location: "Main", quantity: 0, revision: null, reason: "Stock count" };

test("shared stock actions authorize writers, validate saved SKUs, and retain the revision guard", async () => {
  const f = actions();
  assert.equal((await f.api.adjustProductStock(input)).revision, revision);
  assert.deepEqual(Array.from(f.authRoles[0] as string[]), ["admin", "operator", "bd_manager"]);
  assert.equal(f.writes[0].p_actor_id, "user");
  assert.equal(f.writes[0].p_quantity, 0);
  assert.equal(f.writes[0].p_expected_revision, null);
  assert.ok((await f.api.adjustProductStock({ ...input, sku: "UNSAVED" })).error);
  for (const quantity of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.ok((await f.api.adjustProductStock({ ...input, quantity })).error);
  assert.equal(f.writes.length, 1);
  const denied = actions({ denied: true });
  await assert.rejects(denied.api.adjustProductStock(input), /Denied/);
  assert.equal(denied.writes.length, 0);
});

test("connected zero stock cannot be overwritten manually and teammate conflicts remain visible", async () => {
  const connected = actions({ connected: true });
  assert.match((await connected.api.adjustProductStock(input)).error!, /connected/);
  assert.equal(connected.writes.length, 0);
  const conflict = actions({ conflict: true });
  assert.match((await conflict.api.adjustProductStock({ ...input, revision })).error!, /teammate changed/);
});
