import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { findPlan } from "../lib/billing/plans.ts";
import { workspaceCookie, workspaceCookieOptions, workspaceIdSchema, workspaceNameSchema } from "../lib/workspaces.ts";

function load(file: string, dependencies: Record<string, unknown>) {
  const exports: Record<string, (...args: unknown[]) => Promise<Response>> = {};
  const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, Response, Request, Buffer, URL, Date });
  return exports;
}
const id = "aaaaaaaa-1111-4111-8111-111111111111";
const workspaceId = "bbbbbbbb-1111-4111-8111-111111111111";
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
    "@/lib/billing/plans": { findPlan },
    "@/lib/supabase/control": { createSupabaseControl: () => ({ rpc: async (name: string, args: Record<string, unknown>) => { assert.equal(name, "create_subscription_order"); input = args; return { data: { id, workspace_id: workspaceId }, error: null }; } }) },
  });
  const form = new FormData(); form.set("plan", "starter"); form.set("name", "My company"); form.set("amount", "0.01"); form.set("userId", "attacker");
  await assert.rejects(api.startCheckout({}, form), new RegExp(`redirect:/subscribe/orders/${id}`));
  assert.equal(input!.p_user_id, id); assert.equal(input!.p_plan_id, "starter");
  assert.ok(!("p_amount" in input!)); assert.ok(!JSON.stringify(input).includes("0.01"));
  assert.equal(writes[0][0], workspaceCookie); assert.equal(writes[0][1], workspaceId);
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
