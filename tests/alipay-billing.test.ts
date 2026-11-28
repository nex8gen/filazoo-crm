import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { AlipaySdk } from "alipay-sdk";
import * as plans from "../lib/billing/plans.ts";
import { loginDestination } from "../lib/login-destination.ts";
import { signupDestination } from "../lib/signup.ts";
import { isStandaloneRoute } from "../lib/standalone-routes.ts";

const app = generateKeyPairSync("rsa", { modulusLength: 2048 });
const provider = generateKeyPairSync("rsa", { modulusLength: 2048 });
const environment = {
  NODE_ENV: "production", ALIPAY_PAYMENTS_ENABLED: "true", ALIPAY_APP_ID: "2021007121675450", ALIPAY_SELLER_ID: "2088000000000000",
  ALIPAY_PRIVATE_KEY: app.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ALIPAY_PUBLIC_KEY: provider.publicKey.export({ type: "spki", format: "pem" }).toString(),
};

test("custom recharge cashier signs the frozen total and rejects mismatched order prices", () => {
  const api = load();
  const order = { id: "fixture", workspace_id: "fixture", out_trade_no: `FZ${"a".repeat(32)}`, status: "pending", expires_at: "2099-01-01", catalog_version: 5, plan_id: "credits_custom", kind: "credits", seats: 1, period_months: 1, credit_quantity: 12345, credit_rate_micros: 6630000, amount_fen: 8185, currency: "CNY" };
  const url = String(api.checkoutUrl(order));
  const biz = JSON.parse(new URL(url).searchParams.get("biz_content")!);
  assert.equal(biz.total_amount, "81.85");
  assert.match(biz.subject, /12,345 AI credits/);
  assert.throws(() => api.checkoutUrl({ ...order, amount_fen: 1 }), /Invalid order/);
});
function load(overrides = {}) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:fs": { readFileSync }, "alipay-sdk": { AlipaySdk },
    "../env.ts": { env: { NEXT_PUBLIC_APP_URL: "https://crm.example.test" } }, "./plans.ts": plans,
  };
  const code = ts.transpileModule(readFileSync(new URL("../lib/billing/alipay.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, process: { env: { ...environment, ...overrides } }, URL, URLSearchParams, Date, Object });
  return exports;
}
function notification(changes: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    app_id: environment.ALIPAY_APP_ID, seller_id: environment.ALIPAY_SELLER_ID,
    out_trade_no: `FZ${"a".repeat(32)}`, total_amount: "99.00", trade_no: "202611200000000001", trade_status: "TRADE_SUCCESS", ...changes,
  };
  const canonical = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join("&");
  return { ...fields, sign_type: "RSA2", sign: sign("RSA-SHA256", Buffer.from(canonical), provider.privateKey).toString("base64") };
}

test("signup and auth callbacks retain billing destinations while invitations retain team access", () => {
  assert.equal(signupDestination(undefined), "/subscribe");
  assert.equal(loginDestination("/subscribe?workspace=abc"), "/subscribe?workspace=abc");
  assert.equal(loginDestination("//attacker.test"), "/");
  assert.equal(signupDestination("/join/team"), "/join/team");
  for (const path of ["/subscribe", "/subscribe/orders/id"]) assert.equal(isStandaloneRoute(path), true);
});
test("RMB parsing rejects rounding tricks, negative values, exponents and malformed amounts", () => {
  for (const bad of [undefined, 99, "-99", "+99", "99e0", "99.001", "099", " 99.00", "99.00x", "NaN", "Infinity"]) assert.equal(plans.amountFen(bad), null);
  assert.equal(plans.amountFen("99.00"), 9900); assert.equal(plans.amountFen("299"), 29900); assert.equal(plans.amountFen("0.1"), 10);
});
test("payment cannot start without merchant activation or a verified recipient", () => {
  for (const options of [{ ALIPAY_PAYMENTS_ENABLED: "false" }, { ALIPAY_SELLER_ID: "" }, { ALIPAY_APP_ID: "bad" }, { ALIPAY_PRIVATE_KEY: "" }]) {
    const api = load(options);
    assert.equal(api.alipayReady(), false);
    assert.throws(() => api.checkoutUrl({}), /merchant activation/);
  }
});
test("real RSA2 verification rejects tampering, wrong app or recipient, wrong currency, and duplicate fields", () => {
  const api = load();
  const valid = notification();
  assert.deepEqual(JSON.parse(JSON.stringify(api.validateNotification(valid))), { outTradeNo: valid.out_trade_no, tradeNo: valid.trade_no, amount: 9900, status: "TRADE_SUCCESS" });
  assert.throws(() => api.validateNotification({ ...valid, total_amount: "0.01" }), /signature/);
  for (const changes of [{ app_id: "other" }, { seller_id: "2088000000000001" }, { currency: "USD" }]) assert.throws(() => api.validateNotification(notification(changes)), /recipient|currency/);
  assert.throws(() => api.parseNotification("total_amount=99&total_amount=1"), /Duplicate/);
  const encoded = new URLSearchParams(valid).toString();
  assert.equal((api.validateNotification(api.parseNotification(encoded)) as { amount: number }).amount, 9900);
});
test("pausing new checkout still allows signed payment and refund notifications", () => {
  const api = load({ ALIPAY_PAYMENTS_ENABLED: "false" });
  assert.equal(api.alipayReady(),false);
  assert.equal((api.validateNotification(notification({trade_status:"TRADE_CLOSED"})) as {status:string}).status,"TRADE_CLOSED");
  assert.throws(()=>api.checkoutUrl({}),/merchant activation/);
});
test("checkout signs the server price, exact expiry, merchant, webhook, and embedded Alipay QR mode", () => {
  const api = load();
  const order = { id: "order-id", status: "pending", plan_id: "starter", currency: "CNY", amount_fen: 9900, out_trade_no: `FZ${"a".repeat(32)}`, expires_at: new Date(Date.now() + 600000).toISOString() };
  const url = new URL(api.checkoutUrl(order) as string);
  assert.equal(url.origin, "https://openapi.alipay.com");
  assert.equal(url.searchParams.get("notify_url"), "https://crm.example.test/api/alipay/notify");
  assert.equal(url.searchParams.get("return_url"), "https://crm.example.test/subscribe/orders/order-id");
  assert.ok(url.searchParams.get("sign"));
  const biz = JSON.parse(url.searchParams.get("biz_content")!);
  assert.equal(biz.total_amount, "99.00"); assert.equal(biz.qr_pay_mode, 4); assert.equal(biz.seller_id, environment.ALIPAY_SELLER_ID);
  assert.equal(biz.product_code, "FAST_INSTANT_TRADE_PAY");
  assert.throws(() => api.checkoutUrl({ ...order, amount_fen: 1 }), /Invalid order/);
  assert.throws(() => api.checkoutUrl({ ...order, expires_at: "2000-01-01" }), /expired/);
  assert.throws(() => api.checkoutUrl({ ...order, status: "paid" }), /expired/);
});

test("commercial checkout validates seat totals and credit packs against their own versioned price", () => {
  const api = load();
  const base = { id: "order-id", status: "pending", currency: "CNY", catalog_version: 2, out_trade_no: `FZ${"b".repeat(32)}`, expires_at: new Date(Date.now() + 600000).toISOString() };
  const seatOrder = { ...base, kind: "subscription", plan_id: "pro", seats: 3, amount_fen: 83700 };
  assert.equal(JSON.parse(new URL(api.checkoutUrl(seatOrder) as string).searchParams.get("biz_content")!).total_amount, "837.00");
  assert.throws(() => api.checkoutUrl({ ...seatOrder, amount_fen: 27900 }), /Invalid order/);
  const packOrder = { ...base, kind: "credits", plan_id: "credits_3000", seats: 1, amount_fen: 6900 };
  assert.equal(JSON.parse(new URL(api.checkoutUrl(packOrder) as string).searchParams.get("biz_content")!).total_amount, "69.00");
  assert.throws(() => api.checkoutUrl({ ...packOrder, amount_fen: 100 }), /Invalid order/);
  const annual = { ...seatOrder, catalog_version: 3, period_months: 12, amount_fen: 1004400 };
  const annualBiz = JSON.parse(new URL(api.checkoutUrl(annual) as string).searchParams.get("biz_content")!);
  assert.equal(annualBiz.total_amount, "10044.00");
  assert.match(annualBiz.subject, /12 months/);
  assert.throws(() => api.checkoutUrl({ ...annual, amount_fen: 100440 }), /Invalid order/);
  const fixed = { ...base, catalog_version: 4, kind: "subscription", plan_id: "business", seats: 5, period_months: 1, amount_fen: 92900 };
  assert.equal(JSON.parse(new URL(api.checkoutUrl(fixed) as string).searchParams.get("biz_content")!).total_amount, "929.00");
  assert.throws(() => api.checkoutUrl({ ...fixed, seats: 1 }), /Invalid order/);
  assert.throws(() => api.checkoutUrl({ ...fixed, amount_fen: 92900 * 5 }), /Invalid order/);
  const fixedAnnual = { ...fixed, period_months: 12, amount_fen: 934800 };
  assert.equal(JSON.parse(new URL(api.checkoutUrl(fixedAnnual) as string).searchParams.get("biz_content")!).total_amount, "9348.00");
});
