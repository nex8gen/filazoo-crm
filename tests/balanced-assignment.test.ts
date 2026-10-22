import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261022024500_balance_bd_assignments_by_load.sql", import.meta.url),
  "utf8",
);

test("automatic assignment chooses the active BD manager with the fewest company profiles", () => {
  assert.match(migration, /select count\(\*\)[\s\S]*from public\.pipeline assigned_pipeline[\s\S]*assigned_pipeline\.owner_id = member\.user_id/);
  assert.match(migration, /member\.last_lead_assigned_at asc nulls first/);
  assert.match(migration, /pg_advisory_xact_lock/);
});
