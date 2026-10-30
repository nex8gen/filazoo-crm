// Read-only integration verification. No customer changes, messages or payments.
import assert from "node:assert/strict";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { readMyDayData } from "../lib/data/my-day";

async function main() {
  const db = createSupabaseAdmin();
  const { data: members } = await db.from("workspace_members").select("user_id,role").not("activated_at", "is", null).order("user_id").throwOnError();
  assert.ok(members?.length, "An active workspace member is required");
  for (const member of members) {
    const data = await readMyDayData(db, { id: member.user_id, role: member.role });
    assert.ok(data.sources.every(source => source.ok), `Unavailable sources: ${data.sources.filter(source => !source.ok).map(source => source.id).join(", ")}`);
    assert.equal(new Set(data.items.map(item => item.id)).size, data.items.length);
    assert.ok(data.items.every(item => item.href.startsWith("/") && !item.href.startsWith("//")));
    console.log(JSON.stringify({ role: member.role, items: data.items.length, sources: data.sources.length, passed: true }));
  }
}
main().catch(error => { console.error("My Day integration verification failed.", error instanceof assert.AssertionError ? error.message : "Check database connectivity and configuration."); process.exitCode = 1; });
