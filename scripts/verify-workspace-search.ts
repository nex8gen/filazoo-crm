// Read-only verification against the configured database. No messages or mutations.
import assert from "node:assert/strict";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { readWorkspaceSearch } from "../lib/data/workspace-search";
import { isWorkspaceSearchResponse } from "../lib/workspace-search";

async function main() {
  const db = createSupabaseAdmin();
  const { data: members } = await db.from("workspace_members").select("user_id,role").not("activated_at", "is", null).order("user_id").throwOnError();
  assert.ok(members?.length, "An active CRM member is required");
  for (const member of members) {
    const result = await readWorkspaceSearch(db, { id: member.user_id, role: member.role }, "qa");
    assert.ok(isWorkspaceSearchResponse(result));
    assert.equal(result.unavailable.length, 0, `Unavailable search types: ${result.unavailable.join(",")}`);
    const taskIds = result.results.filter(row => row.kind === "task").map(row => row.id);
    if (taskIds.length) {
      const { data: tasks } = await db.from("crm_tasks").select("assigned_to").in("id", taskIds).throwOnError();
      assert.ok(tasks?.every(task => task.assigned_to === member.user_id), "Task search stays personal");
    }
    if (member.role === "bd_manager") {
      const companyIds = result.results.filter(row => row.kind === "company").map(row => row.id);
      if (companyIds.length) {
        const { data: ownership } = await db.from("pipeline").select("company_id,owner_id").in("company_id", companyIds).throwOnError();
        assert.equal(ownership?.length, companyIds.length);
        assert.ok(ownership?.every(row => row.owner_id === member.user_id), "BD company search respects current ownership");
      }
    }
    console.log(JSON.stringify({ role: member.role, resultCount: result.results.length, sourcesPassed: 7 }));
  }
  const admin = members.find(member => member.role === "admin");
  assert.ok(admin, "Admin test reader required");
  const viewer = { id: admin.user_id, role: admin.role };
  for (const query of ['Acme, "R&D" (100%)_\\', "%_", "PLA"]) {
    const result = await readWorkspaceSearch(db, viewer, query);
    assert.equal(result.unavailable.length, 0, "Literal punctuation and product queries must work for every source");
  }
  const { data: invoices } = await db.from("invoices").select("id,number").order("number").limit(1).throwOnError();
  if (invoices?.[0]) {
    const invoice = invoices[0];
    const result = await readWorkspaceSearch(db, viewer, `INV-${String(invoice.number).padStart(6, "0")}`);
    assert.ok(result.results.some(row => row.kind === "invoice" && row.id === invoice.id), "Formatted invoice numbers must resolve to the real invoice");
  }
  const { data: orders } = await db.from("purchase_orders").select("id,company_id,reference:document->>reference").order("id").limit(1).throwOnError();
  if (orders?.[0]?.reference && orders[0].reference.length >= 2 && orders[0].reference.length <= 120 && !orders[0].reference.includes("*")) {
    const order = orders[0];
    const result = await readWorkspaceSearch(db, viewer, order.reference!);
    const match = result.results.find(row => row.kind === "order" && row.id === order.id);
    assert.ok(match, "Order reference must resolve to the matching saved order");
    assert.ok(match.href.includes(`orderId=${order.id}`));
  }
  console.log(JSON.stringify({ literalQueriesPassed: true, invoiceLookupPassed: Boolean(invoices?.length), orderLookupPassed: Boolean(orders?.length) }));
}
main().catch(error => { console.error("Workspace search verification failed.", error instanceof assert.AssertionError ? error.message : "Check database connectivity and configuration."); process.exitCode = 1; });
