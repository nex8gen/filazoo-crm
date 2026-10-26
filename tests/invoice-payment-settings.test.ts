import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as methods from "../lib/invoice-payment-methods.ts";
import * as links from "../lib/invoice-links.ts";
import * as permissions from "../lib/invoice-permissions.ts";

const require = createRequire(import.meta.url);
function moduleAt(file: string, dependencies: Record<string, unknown>): Record<string, (...args: never[]) => Promise<unknown>> {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "server-only" ? {} : dependencies[name] ?? require(name), Response, Request, URL, Date, Error, console });
  return exports;
}

const paypal = { id: "3280fd30-4529-4c4d-ab74-c695ab064e57", type: "paypal", label: "PayPal", currency: "", details: "test@example.test", paymentUrl: "" };
const seller = { sellerName: "Test seller", sellerAddress: "Address", sellerTaxId: "Tax", paymentInstructions: "Instructions", notes: "Terms" };

function fixture(role: string | null = "admin", options: { absent?: boolean; conflicts?: number } = {}) {
  let row = options.absent ? null : { settings: { ...seller } as Record<string, unknown>, updated_at: "2026-10-26T00:00:00Z" };
  let queries = 0;
  let conflicts = options.conflicts ?? 0;
  const db = { from() {
    queries++;
    let mutation: Record<string, unknown> | undefined;
    let inserting = false;
    const filters = new Map<string, unknown>();
    const execute = () => {
      if (inserting) {
        if (row) return { data: null, error: { code: "23505" } };
        row = mutation as typeof row;
        return { data: null, error: null };
      }
      if (!mutation) return { data: row ? structuredClone(row) : null, error: null };
      if (conflicts-- > 0 && row) {
        row = { ...row, settings: { ...row.settings, concurrentField: "preserved" }, updated_at: "2026-10-26T00:01:00Z" };
        return { data: [], error: null };
      }
      if (!row || filters.get("updated_at") !== row.updated_at) return { data: [], error: null };
      row = mutation as typeof row;
      return { data: [{ singleton: true }], error: null };
    };
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.set(key, value); return query; },
      update(value: Record<string, unknown>) { mutation = value; return query; },
      insert(value: Record<string, unknown>) { inserting = true; mutation = value; return query; },
      async maybeSingle() { return execute(); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); },
    };
    return query;
  } };
  const storage = moduleAt("../lib/data/invoice-payment-methods.ts", {
    "../supabase/admin": { createSupabaseAdmin: () => db }, "../invoice-payment-methods": methods,
  });
  const access = moduleAt("../lib/invoice-api.ts", {
    "./auth": { getWorkspaceViewer: async () => role ? { id: paypal.id, role } : null }, "./invoice-permissions": permissions,
  });
  const route = moduleAt("../app/api/invoices/billing/route.ts", {
    "@/lib/invoice-api": access, "@/lib/supabase/admin": { createSupabaseAdmin: () => db },
    "@/lib/data/invoice-payment-methods": storage, "@/lib/invoice-payment-methods": methods, "@/lib/invoice-links": links,
  });
  return {
    put: (body: unknown, origin = "http://localhost:3000") => route.PUT(new Request("http://localhost:3000/api/invoices/billing", { method: "PUT", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }) as never) as Promise<Response>,
    read: () => storage.invoicePaymentMethods(), row: () => row, queries: () => queries,
  };
}

test("saving and reading payment settings preserves seller defaults; seller edits preserve payment methods", async () => {
  const mock = fixture();
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [paypal] })).status, 200);
  assert.equal(mock.row()!.settings.sellerName, seller.sellerName);
  assert.deepEqual(await mock.read(), [paypal]);
  assert.equal((await mock.put({ kind: "seller", settings: { ...seller, sellerName: "Updated seller" } })).status, 200);
  assert.deepEqual(await mock.read(), [paypal]);
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [] })).status, 200);
  assert.equal(mock.row()!.settings.sellerName, "Updated seller");
  assert.deepEqual(await mock.read(), []);
});

test("first payment configuration works without existing seller defaults", async () => {
  const mock = fixture("operator", { absent: true });
  assert.deepEqual(await mock.read(), []);
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [paypal] })).status, 200);
  assert.deepEqual(await mock.read(), [paypal]);
});

test("concurrent settings changes are reread and retained before retrying", async () => {
  const mock = fixture("admin", { conflicts: 1 });
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [paypal] })).status, 200);
  assert.equal(mock.row()!.settings.concurrentField, "preserved");
  assert.deepEqual(await mock.read(), [paypal]);
});

test("repeated settings conflicts return a retry response instead of overwriting", async () => {
  const mock = fixture("admin", { conflicts: 4 });
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [paypal] })).status, 409);
  assert.equal(mock.row()!.settings.paymentMethods, undefined);
});

test("payment settings writes enforce membership, billing role, origin, and validation", async () => {
  for (const role of [null, "bd_manager", "viewer"]) {
    const mock = fixture(role);
    assert.equal((await mock.put({ kind: "payments", paymentMethods: [paypal] })).status, role ? 403 : 401);
    assert.equal(mock.queries(), 0);
  }
  const mock = fixture();
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [paypal] }, "https://untrusted.example")).status, 403);
  assert.equal((await mock.put({ kind: "payments", paymentMethods: [{ ...paypal, paymentUrl: "javascript:alert(1)" }] })).status, 400);
  assert.equal(mock.queries(), 0);
});
