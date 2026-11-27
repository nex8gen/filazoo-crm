// Read-only qualification of assignment filters against the configured database.
// No authentication changes, customer writes, model calls or email sends.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { env } from "../lib/env.ts";
import { assertAiCustomerAccess, assignedAiCustomerIds } from "../lib/ai/customer-access.ts";

if (!process.argv.includes("--live")) {
  console.log(JSON.stringify({ readOnly: true, modelCalls: false, cases: ["all non-admin roles", "foreign customer denial", "admin workspace visibility", "PostgREST ownership joins"] }));
  process.exit(0);
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.supabaseSecretKey) throw new Error("Configured server database access is required.");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false }, db: { retry: false } });
const seed = await db.from("pipeline").select("company_id,owner_id").not("owner_id", "is", null).limit(1).throwOnError();
assert.ok(seed.data?.[0], "Need at least one assigned customer to qualify access");
const memberId = seed.data[0].owner_id;
const foreign = await db.from("pipeline").select("company_id").neq("owner_id", memberId).limit(1).throwOnError();
assert.ok(foreign.data?.[0], "Need a different customer's assignment to qualify denial");
const roles = ["operator", "bd_manager", "viewer"] as const;
let assignedCount = 0;
for (const role of roles) {
  const actor = { id: memberId, role };
  const ids = await assignedAiCustomerIds(actor, db);
  assert.ok(ids);
  assert.ok(ids.includes(seed.data[0].company_id));
  assert.ok(!ids.includes(foreign.data[0].company_id));
  assignedCount = ids.length;
  await assertAiCustomerAccess(actor, seed.data[0].company_id, db);
  await assert.rejects(() => assertAiCustomerAccess(actor, foreign.data![0].company_id, db), /not assigned/);
}
assert.equal(await assignedAiCustomerIds({ id: memberId, role: "admin" }, db), null);
const companies = await db.from("companies").select("id,pipeline!inner(owner_id)", { count: "exact", head: true }).eq("pipeline.owner_id", memberId).throwOnError();
assert.equal(companies.count, assignedCount);
const resources: Record<string, number | null> = { companies: companies.count };
for (const table of ["purchase_orders", "invoices", "crm_tasks", "catalogs"]) {
  const result = await db.from(table).select("id,ai_company:companies!inner(pipeline!inner(owner_id))", { count: "exact", head: true }).eq("ai_company.pipeline.owner_id", memberId).throwOnError();
  resources[table] = result.count;
}
const receipt = { checkedAt: new Date().toISOString(), passed: true, readOnly: true, businessWrites: false, modelCalls: false, rolesChecked: roles, assignedCustomers: assignedCount, validatedOwnershipJoins: resources };
mkdirSync("docs/audit-evidence", { recursive: true });
writeFileSync("docs/audit-evidence/ai-customer-access-20261127.json", JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
