import assert from "node:assert/strict";
import test from "node:test";
import { createDecipheriv, createHash } from "node:crypto";
import { fetchLingxingInventory, lingxingConfig, lingxingSign } from "../lib/lingxing.ts";
import { applyProductInventory, stockLabel } from "../lib/product-inventory.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const config = lingxingConfig({ LINGXING_APP_ID: "1234567890123456", LINGXING_APP_SECRET: "private-secret", LINGXING_WAREHOUSE_IDS: "2,1,2" })!;
const row = (sku: string, wid: number, available: unknown = 8) => ({ sku, wid, seller_id: "0", fnsku: "", product_valid_num: available, product_total: 10, product_lock_num: 2 });
const json = (body: unknown) => Response.json(body);

test("configuration isolates account/warehouse snapshots and validates aliases", () => {
  assert.equal(lingxingConfig({}), null);
  assert.equal(config.warehouseIds, "1,2");
  assert.equal(config.scope, lingxingConfig({ LINGXING_APP_ID: config.appId, LINGXING_APP_SECRET: "rotated", LINGXING_WAREHOUSE_IDS: "1,2" })!.scope);
  assert.notEqual(config.scope, lingxingConfig({ LINGXING_APP_ID: config.appId, LINGXING_APP_SECRET: "secret", LINGXING_WAREHOUSE_IDS: "1" })!.scope);
  for (const value of ['[]', 'null', '{"A": 2}', '{"A":" "}']) assert.throws(() => lingxingConfig({ LINGXING_APP_ID: config.appId, LINGXING_APP_SECRET: "secret", LINGXING_SKU_MAP: value }));
});

test("signs using sorted parameters, uppercase MD5, and the App ID AES key", () => {
  const params = { offset: 0, length: 800, wid: "", access_token: "token", timestamp: 123, app_key: config.appId };
  const sign = lingxingSign(params, config.appId);
  const decipher = createDecipheriv("aes-128-ecb", Buffer.from(config.appId), null);
  const md5 = Buffer.concat([decipher.update(Buffer.from(sign, "base64")), decipher.final()]).toString("utf8");
  assert.equal(md5, createHash("md5").update(`access_token=token&app_key=${config.appId}&length=800&offset=0&timestamp=123`).digest("hex").toUpperCase());
});

test("authenticates with multipart credentials, signs Bearer requests, and aggregates paginated stock", async () => {
  let calls = 0;
  const result = await fetchLingxingInventory(config, (async (input, init) => {
    const url = new URL(String(input));
    calls++;
    if (calls === 1) {
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("appSecret"), "private-secret");
      return json({ code: "200", data: { access_token: "private-token" } });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-token");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(url.href.includes("private-secret"), false);
    const body = JSON.parse(String(init?.body));
    assert.equal(url.searchParams.get("sign"), lingxingSign({ ...body, app_key: config.appId, access_token: "private-token", timestamp: Number(url.searchParams.get("timestamp")) }, config.appId));
    const data = calls === 2 ? [row("SKU",1), row("OTHER",1,0)] : [row("SKU",2,3)];
    assert.equal(body.offset, calls === 2 ? 0 : 2);
    return json({ code: 0, data, total: 3 });
  }) as typeof fetch);
  assert.equal(calls, 3);
  assert.deepEqual(result.find(x => x.sku === "SKU"), { sku: "SKU", available: 11, on_hand: 20, locked: 4, warehouse_ids: ["1", "2"] });
  assert.equal(result.find(x => x.sku === "OTHER")?.available, 0);
});

test("incomplete, duplicate, changing, malformed and unauthorized inventory never yields a snapshot", async () => {
  for (const pages of [
    [{ code: 0, data: [], total: 1 }],
    [{ code: 0, data: [row("A",1),row("A",1)], total: 2 }],
    [{ code: 0, data: [row("A",1,"invalid")], total: 1 }],
    [{ code: 0, data: [row("A",1,null)], total: 1 }],
    [{ code: 0, data: [row("A",99)], total: 1 }],
    [{ code: 0, data: [row("A",1)], total: 2 },{ code: 0, data: [row("B",2)], total: 3 }],
    [{ code: 3001008, message: "private-token private-secret", data: [] }],
  ]) {
    let calls = 0;
    await assert.rejects(fetchLingxingInventory(config, (async () => calls++ === 0 ? json({ code: 200, data: { access_token: "private-token" } }) : json(pages.shift())) as typeof fetch), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /private-token|private-secret/);
      return true;
    });
  }
});

test("authentication and network errors do not expose credentials", async () => {
  await assert.rejects(fetchLingxingInventory(config, (async () => json({ code: 2001001, msg: "private-secret" })) as typeof fetch), /code 2001001/);
  await assert.rejects(fetchLingxingInventory(config, (async () => { throw new Error("https://private-secret"); }) as typeof fetch), /Could not reach Lingxing/);
});

test("zero stock is known, missing SKUs are unknown, and family totals require every variant", () => {
  const product = { ...b2bProducts[0], variants: b2bProducts[0].variants.slice(0,2) };
  const synced_at = "2026-10-28T01:00:00Z";
  const a = { sku: "ERP-A", available: 0, on_hand: 1, locked: 1, warehouse_ids: ["1"], synced_at };
  let output = applyProductInventory([product], [a], { [product.variants[0].sku]: "ERP-A" })[0];
  assert.equal(output.stock, null);
  assert.equal(output.variants[0].stock?.available, 0);
  assert.equal(output.variants[1].stock, null);
  assert.equal(output.stockStatus, "Stock unknown");
  const b = { ...a, sku: "ERP-B", available: 8 };
  output = applyProductInventory([product], [a,b], { [product.variants[0].sku]: "ERP-A", [product.variants[1].sku]: "ERP-B" })[0];
  assert.equal(output.stock?.available, 8);
  assert.equal(output.stock?.locked, 2);
  assert.equal(product.stock, undefined);
  output = applyProductInventory([product], [b], { [product.variants[0].sku]: "ERP-B", [product.variants[1].sku]: "ERP-B" })[0];
  assert.equal(output.stock?.available, 8);
  assert.match(stockLabel(b && { available: 0, onHand: 1, locked: 1, warehouseIds: ["1"], syncedAt: synced_at }, new Date(synced_at).getTime()), /^0 available$/);
  assert.match(stockLabel(output.stock, new Date(synced_at).getTime() + 31 * 60_000), /stale/);
});
