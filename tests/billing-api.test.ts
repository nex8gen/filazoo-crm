import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as plans from "../lib/billing/plans.ts";
import * as recharge from "../lib/billing/recharge.ts";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema } from "../lib/workspaces.ts";

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Response, Request, Buffer, URL, Date });
  return exports;
}
const id = "aaaaaaaa-1111-4111-8111-111111111111";
const workspaceId = "bbbbbbbb-1111-4111-8111-111111111111";

test("recharge checkout uses the signed-in owner and a database quote, and rejects invalid or changed totals", async () => {
  let calls = 0;
  let failure: string | null = null;
  const api = load("../app/subscribe/recharge-actions.ts", {
    "node:crypto": { randomUUID: () => id, createHash },
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect: (path: string) => { throw Error(`redirect:${path}`); } },
    "next/headers": { cookies: async () => ({ set() {} }) },
    "@/lib/auth": { requireViewer: async () => ({ id }) },
    "@/lib/billing/alipay": { alipayReady: () => true },
    "@/lib/billing/recharge": recharge,
    "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions, workspaceIdSchema },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "create_credit_recharge_order"); assert.equal(args.p_user_id, id);
      assert.equal(args.p_workspace_id, workspaceId); assert.equal(args.p_credits, 12345);
      assert.equal(args.p_expected_amount_fen, 8185); assert.ok(!("p_rate_micros" in args));
      return { data: failure ? null : { id, workspace_id: workspaceId }, error: failure ? { message: failure } : null };
    } }) },
  });
  const form = new FormData(); form.set("workspaceId", workspaceId); form.set("pricingId", id);
  form.set("credits", "12345"); form.set("expectedAmountFen", "8185"); form.set("userId", "attacker"); form.set("rateMicros", "1");
  await assert.rejects(api.startCreditRecharge({}, form), /redirect:/);
  assert.equal(calls, 1);
  failure = "Recharge total changed. Refresh pricing and try again";
  assert.match(JSON.stringify(await api.startCreditRecharge({}, form)), /Recharge total changed/);
  for (const value of ["0", "1.5", "-1", "1e3"]) {
    form.set("credits", value);
    assert.match(JSON.stringify(await api.startCreditRecharge({}, form)), /valid credit amount/);
  }
  assert.equal(calls, 2);
});
test("account discounts recharge without Alipay or exchange rates and authenticate every redemption", async () => {
  const changes: string[] = [];
  let calls = 0;
  let failure = false;
  const api = load("../app/subscribe/recharge-actions.ts", {
    "node:crypto": { createHash, randomUUID: () => id },
    "next/cache": { revalidatePath: (path: string) => changes.push(path) },
    "next/navigation": { redirect: () => assert.fail("Free recharge must not enter Alipay checkout") },
    "next/headers": { cookies: () => assert.fail("No workspace change") },
    "@/lib/auth": { requireViewer: async () => ({ id }) },
    "@/lib/billing/alipay": { alipayReady: () => false },
    "@/lib/billing/recharge": recharge,
    "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions, workspaceIdSchema },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "redeem_credit_discount"); assert.equal(args.p_user_id, id);
      assert.equal(args.p_workspace_id, workspaceId); assert.equal(args.p_credits, 12345);
      assert.equal(args.p_request_id, id); assert.equal(args.p_code_hash, createHash("sha256").update("FIXTURE-FREE").digest("hex"));
      assert.ok(!("p_expected_amount_fen" in args));
      return { data: failure ? null : { credits: 12345, workspaceId }, error: failure ? { message: "private error" } : null };
    } }) },
  });
  const form = new FormData(); form.set("workspaceId", workspaceId); form.set("credits", "12345");
  form.set("discountCode", " fixture-free "); form.set("requestId", id); form.set("userId", "forged-user");
  const result = await api.startCreditRecharge({}, form);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, credits: 12345 });
  assert.deepEqual(changes, ["/settings/credits", "/settings/profile"]);
  failure = true;
  assert.match(JSON.stringify(await api.startCreditRecharge({}, form)), /Check your discount code/);
  assert.doesNotMatch(JSON.stringify(await api.startCreditRecharge({}, form)), /private error/);
  assert.equal(calls, 3);
  form.set("requestId", "bad");
  assert.match(JSON.stringify(await api.startCreditRecharge({}, form)), /valid credit amount/);
  assert.equal(calls, 3);
  form.delete("discountCode");
  assert.match(JSON.stringify(await api.startCreditRecharge({}, form)), /Alipay payment is not available/);
  assert.equal(calls, 3);
});

test("discount preview hashes the code and never trusts a client user ID", async () => {
  let calls = 0;
  const api = load("../app/subscribe/discount-actions.ts", {
    "node:crypto": { createHash }, "@/lib/auth": { requireViewer: async () => ({ id }) },
    "@/lib/workspaces": { workspaceIdSchema },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "check_credit_discount"); assert.equal(args.p_user_id, id);
      assert.equal(args.p_code_hash, createHash("sha256").update("FIXTURE-FREE").digest("hex"));
      return { data: { discountPercent: 100 }, error: null };
    } }) },
  });
  assert.match(JSON.stringify(await api.applyCreditDiscount(workspaceId, " fixture-free ")), /100/);
  assert.match(JSON.stringify(await api.applyCreditDiscount(workspaceId, "<invalid>")), /valid discount code/);
  assert.equal(calls, 1);
});

test("subscription discounts preview for the signed-in account before a workspace exists", async () => {
  let calls = 0;
  let failure = false;
  const api = load("../app/subscribe/discount-actions.ts", {
    "node:crypto": { createHash }, "@/lib/auth": { requireViewer: async () => ({ id }) },
    "@/lib/workspaces": { workspaceIdSchema },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "check_subscription_discount"); assert.equal(args.p_user_id, id);
      assert.equal(args.p_workspace_id, null);
      assert.equal(args.p_code_hash, createHash("sha256").update("FIXTURE-FREE").digest("hex"));
      return { data: failure ? null : { discountPercent: 100 }, error: failure ? { message: 'private database error' } : null };
    } }) },
  });
  assert.match(JSON.stringify(await api.applySubscriptionDiscount(undefined, " fixture-free ")), /100/);
  failure = true;
  const result = JSON.stringify(await api.applySubscriptionDiscount(undefined, "fixture-free"));
  assert.match(result, /invalid, expired, already used/);
  assert.doesNotMatch(result, /private database error/);
  assert.match(JSON.stringify(await api.applySubscriptionDiscount('invalid-workspace', 'fixture-free')), /valid discount code/);
  assert.equal(calls, 2);
});

test("subscription discount checkout works without Alipay, uses server identity and rejects unconfirmed zero totals", async () => {
  let calls = 0;
  let failure: string | null = null;
  let confirmed = true;
  const api = load("../app/subscribe/actions.ts", {
    "node:crypto": { randomUUID: () => id, createHash },
    "next/navigation": { redirect: (path: string) => { throw Error(`redirect:${path}`); } },
    "next/headers": { cookies: async () => ({ set() {} }) },
    "@/lib/auth": { requireViewer: async () => ({ id }) },
    "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema },
    "@/lib/billing/alipay": { alipayReady: () => false }, "@/lib/billing/plans": plans,
    "@/lib/billing/data": {},
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "redeem_subscription_discount"); assert.equal(args.p_user_id, id);
      assert.equal(args.p_plan_id, 'business'); assert.equal(args.p_period_months, 12);
      assert.equal(args.p_workspace_id, null);
      assert.equal(args.p_code_hash, createHash('sha256').update('FIXTURE-FREE').digest('hex'));
      assert.equal(args.p_amount_fen, undefined); assert.equal(args.p_discount_percent, undefined);
      return { data: failure ? null : { id, workspace_id: workspaceId, status: confirmed ? 'paid' : 'pending', amount_fen: 0, subscription_discount_id: id }, error: failure ? { message: failure } : null };
    } }) },
  });
  const form = new FormData();
  form.set('plan', 'business'); form.set('name', 'Test workspace'); form.set('billingPeriod', 'annual');
  form.set('discountCode', ' fixture-free '); form.set('userId', 'forged'); form.set('amount', '0'); form.set('discountPercent', '100');
  await assert.rejects(api.startCheckout({}, form), /redirect:\/subscribe\/orders\//);
  confirmed = false;
  assert.match(JSON.stringify(await api.startCheckout({}, form)), /Unable to confirm your discount/);
  failure = 'secret database failure';
  assert.doesNotMatch(JSON.stringify(await api.startCheckout({}, form)), /secret database failure/);
  form.set('discountCode', '<script>');
  assert.match(JSON.stringify(await api.startCheckout({}, form)), /valid discount code/);
  form.delete('discountCode');
  assert.match(JSON.stringify(await api.startCheckout({}, form)), /Alipay payments are being activated/);
  assert.equal(calls, 3);
});

test("notification rejects forged signatures and failed settlement without acknowledging payment", async () => {
  for (const fail of ["signature", "database", "none"]) {
    let writes = 0;
    const api = load("../app/api/alipay/notify/route.ts", {
      "@/lib/billing/alipay": { parseNotification: () => ({}), validateNotification: () => { if (fail === "signature") throw new Error("forged"); return { status: "TRADE_SUCCESS" }; } },
      "@/lib/billing/data": { settlePayment: async () => { writes++; if (fail === "database") throw new Error("uncommitted"); } },
    });
    const result = await api.POST(new Request("https://crm.example.test/api/alipay/notify", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "signed=payload" }));
    assert.equal(result.status, fail === "none" ? 200 : 400);
    assert.equal(await result.text(), fail === "none" ? "success" : "failure");
    assert.equal(writes, fail === "signature" ? 0 : 1);
  }
});
test("notification bounds the body stream and requires the provider form content type", async () => {
  let verified = false;
  const api = load("../app/api/alipay/notify/route.ts", {
    "@/lib/billing/alipay": { parseNotification: () => { verified = true; throw new Error(); }, validateNotification: () => ({}) },
    "@/lib/billing/data": { settlePayment: async () => {} },
  });
  const request = (body: string, type: string) => new Request("https://crm.example.test/api/alipay/notify", { method: "POST", headers: { "Content-Type": type, "Content-Length": "1" }, body });
  assert.equal((await api.POST(request("{}", "application/json"))).status, 415);
  assert.equal((await api.POST(request("a".repeat(65537), "application/x-www-form-urlencoded"))).status, 413);
  assert.equal(verified, false);
});
test("payment status requires login and ownership and never returns private provider data", async () => {
  for (const scenario of ["signed-out", "other-owner", "pending", "paid", "outage"]) {
    const api = load("../app/api/billing/orders/[id]/status/route.ts", {
      "@/lib/auth": { getViewer: async () => scenario === "signed-out" ? null : { id } },
      "@/lib/billing/alipay": { alipayReady: () => true },
      "@/lib/billing/data": {
        ownerOrder: async (user: string, order: string) => { assert.equal(user, id); assert.equal(order, id); return scenario === "other-owner" ? null : { status: "pending", expires_at: "2099-01-01", alipay_trade_no: "private" }; },
        refreshPayment: async (order: unknown) => { if (scenario === "outage") throw new Error("private secret"); return scenario === "paid" ? { status: "paid", period_end: "2099-02-01", alipay_trade_no: "private" } : order; },
      },
    });
    const response = await api.GET(new Request("https://crm.example.test"), { params: Promise.resolve({ id }) });
    assert.equal(response.status, scenario === "signed-out" ? 401 : scenario === "other-owner" ? 404 : scenario === "outage" ? 503 : 200);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.ok(!(await response.text()).includes("private"));
  }
});
test("checkout action ignores client prices, authenticates ownership through the database, and selects the resulting workspace", async () => {
  let input: Record<string, unknown> | undefined;
  const writes: unknown[][] = [];
  const api = load("../app/subscribe/actions.ts", {
    "node:crypto": { randomUUID: () => id },
    "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
    "next/headers": { cookies: async () => ({ set: (...values: unknown[]) => writes.push(values) }) },
    "@/lib/auth": { requireViewer: async () => ({ id }) },
    "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema },
    "@/lib/billing/alipay": { alipayReady: () => true },
    "@/lib/billing/plans": plans,
    "@/lib/billing/data": {},
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => { assert.equal(name, "create_current_package_subscription_order"); input = args; return { data: { id, workspace_id: workspaceId }, error: null }; } }) },
  });
  const form = new FormData(); form.set("plan", "starter"); form.set("seats", "100"); form.set("name", "My company"); form.set("amount", "0.01"); form.set("userId", "attacker");
  await assert.rejects(api.startCheckout({}, form), new RegExp(`redirect:/subscribe/orders/${id}`));
  assert.equal(input!.p_user_id, id); assert.equal(input!.p_plan_id, "starter");
  assert.equal(input!.p_period_months, 1); assert.equal(input!.p_seats, 1); assert.equal(input!.p_kind, "subscription");
  assert.ok(!("p_amount" in input!)); assert.ok(!JSON.stringify(input).includes("0.01"));
  assert.equal(writes[0][0], workspaceCookie); assert.equal(writes[0][1], workspaceId);
  form.set("billingPeriod", "annual");
  await assert.rejects(api.startCheckout({}, form), /redirect:/);
  assert.equal(input!.p_period_months, 12);
  form.set("billingPeriod", "weekly");
  assert.match(JSON.stringify(await api.startCheckout({}, form)), /Choose monthly or annual billing/);
});

test("legacy prices can renew an expired legacy contract but cannot be selected by a new customer", async () => {
  for (const eligible of [true, false]) {
    let writes = 0;
    const api = load("../app/subscribe/actions.ts", {
      "node:crypto": { randomUUID: () => id }, "next/navigation": { redirect: (path: string) => { throw new Error(`redirect:${path}`); } },
      "next/headers": { cookies: async () => ({ set() {} }) }, "@/lib/auth": { requireViewer: async () => ({ id }) },
      "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema },
      "@/lib/billing/alipay": { alipayReady: () => true }, "@/lib/billing/plans": plans,
      "@/lib/billing/data": { workspaceSubscription: async () => ({ legacyRenewalPlan: eligible ? "starter" : undefined }) },
      "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string) => { writes++; assert.equal(name,"create_subscription_order"); return { data:{id,workspace_id:workspaceId},error:null }; } }) },
    });
    const form = new FormData(); form.set("workspaceId",workspaceId); form.set("plan","starter"); form.set("legacy","1");
    if (eligible) await assert.rejects(api.startCheckout({},form),/redirect:/);
    else assert.match(JSON.stringify(await api.startCheckout({},form)),/only available for renewal/);
    assert.equal(writes,eligible ? 1 : 0);
  }
});

test("existing seat contracts renew using trusted contract details rather than submitted package fields", async () => {
  for (const version of [2, 3, 4]) {
    let calls = 0;
    const api = load("../app/subscribe/actions.ts", {
      "node:crypto": { randomUUID: () => id }, "next/navigation": { redirect: () => { throw Error("redirect:renewal"); } },
      "next/headers": { cookies: async () => ({ set() {} }) }, "@/lib/auth": { requireViewer: async () => ({ id }) },
      "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema },
      "@/lib/billing/alipay": { alipayReady: () => true }, "@/lib/billing/plans": plans,
      "@/lib/billing/data": { workspaceSubscription: async () => ({ catalogVersion: version, activePlan: "business", seats: 7, billingPeriod: version === 3 ? "annual" : "monthly" }) },
      "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        calls++; assert.equal(name, version === 2 ? "create_commercial_order" : version === 3 ? "create_period_subscription_order" : "create_package_subscription_order");
        assert.equal(args.p_user_id, id); assert.equal(args.p_plan_id, "business"); assert.equal(args.p_seats, 7);
        assert.equal(args.p_period_months, version === 3 ? 12 : version === 4 ? 1 : undefined);
        return { data: { id, workspace_id: workspaceId }, error: null };
      } }) },
    });
    const form = new FormData(); form.set("workspaceId", workspaceId); form.set("renewExisting", "1"); form.set("plan", "starter"); form.set("seats", "100"); form.set("billingPeriod", "monthly");
    await assert.rejects(api.startCheckout({}, form), /redirect:renewal/);
    assert.equal(calls, 1);
  }
});

test("completion verifies browser origin against its actual host, owner and active payment before selecting a workspace", async () => {
  for (const scenario of ["cross-origin","signed-out","missing","pending","expired","paid"]) {
    const cookies: unknown[][] = [];
    class Result extends Response {
      cookies = { set: (...args: unknown[]) => cookies.push(args) };
      static json(value: unknown, init?: ResponseInit) { return new Result(JSON.stringify(value), init); }
    }
    const api = load("../app/api/billing/orders/[id]/complete/route.ts", {
      "next/server": { NextResponse: Result },
      "@/lib/auth": { getViewer: async () => scenario === "signed-out" ? null : { id } },
      "@/lib/billing/data": {
        ownerOrder: async (userId: string) => { assert.equal(userId,id); return scenario === "missing" ? null : { workspace_id: workspaceId, status: scenario === "pending" ? "pending" : "paid" }; },
        workspaceSubscription: async () => ({ activePlan: scenario === "expired" ? undefined : "starter" }),
      },
      "@/lib/workspaces": { workspaceCookie, workspaceCookieOptions },
    });
    // Reverse proxies may expose an internal request URL. The browser's Host
    // and Origin must still match the public endpoint, never an attacker.
    const response = await api.POST(new Request("http://internal:3000/api/billing/orders/id/complete", { method:"POST", headers: { Host:"crm.example.test", Origin:scenario === "cross-origin" ? "https://attacker.example" : "https://crm.example.test" } }), { params:Promise.resolve({id}) });
    assert.equal(response.status,scenario === "cross-origin" ? 403 : scenario === "signed-out" ? 401 : scenario === "missing" ? 404 : scenario === "paid" ? 200 : 409);
    if(scenario === "paid") { assert.equal(cookies[0][0],workspaceCookie); assert.equal(cookies[0][1],workspaceId); }
    else assert.equal(cookies.length,0);
  }
});
