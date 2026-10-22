import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261022011557_single_bd_manager_assignment.sql", import.meta.url),
  "utf8",
);

test("a sole active BD manager claims every unassigned lead", () => {
  assert.match(migration, /cardinality\(eligible_manager_ids\).*<> 1/s);
  assert.match(migration, /update public\.pipeline[\s\S]*where owner_id is null/);
  assert.match(migration, /update public\.shopify_leads[\s\S]*where owner_id is null/);
  assert.match(migration, /update public\.meta_leads[\s\S]*where owner_id is null/);
});

test("changing the active BD pool reapplies the sole-manager rule", () => {
  assert.match(migration, /after insert on public\.workspace_members/);
  assert.match(migration, /after update of role, auto_assign_leads, activated_at on public\.workspace_members/);
  assert.match(migration, /after delete on public\.workspace_members/);
});
