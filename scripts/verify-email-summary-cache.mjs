// Disposable local PostgreSQL; no hosted data or paid AI calls.
// Uses the same PGlite installation as verify-lead-assignment-database.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../tmp/lead-assignment-db/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
const user = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444";
const token = "55555555-5555-4555-8555-555555555555", hash = "a".repeat(64);
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role crm_workspace_server;
    create schema auth; create schema crm_tenancy;
    create table auth.users(id uuid primary key); create table public.workspaces(id uuid primary key);
    create function crm_tenancy.workspace_id() returns uuid language sql stable as $$ select current_setting('crm.workspace_id')::uuid $$;
    grant usage on schema public,crm_tenancy to crm_workspace_server;
    grant execute on function crm_tenancy.workspace_id() to crm_workspace_server;
    insert into public.workspaces values ('${a}'),('${b}'); insert into auth.users values ('${user}'),('${other}');`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261109030916_email_summary_cache.sql", import.meta.url), "utf8"));
  await db.exec(`set role crm_workspace_server; select set_config('crm.workspace_id','${a}',false);`);
  await db.query("insert into public.email_summary_cache(user_id,input_hash) values($1,$2)", [user, hash]);
  const claim = actor => db.query("update public.email_summary_cache set lease_token=$1,lease_until=now()+interval '130 seconds' where user_id=$2 and input_hash=$3 and (lease_until is null or lease_until<now()) returning input_hash", [token, actor, hash]);
  assert.equal((await claim(user)).rows.length, 1);
  assert.equal((await claim(user)).rows.length, 0, "Another worker cannot claim a live lease");
  assert.equal((await claim(other)).rows.length, 0, "Different users cannot use a saved brief");
  const complete = lease => db.query("update public.email_summary_cache set output=$1,generated_at=now() where user_id=$2 and input_hash=$3 and lease_token=$4 returning input_hash", ['{"summary":"saved"}', user, hash, lease]);
  assert.equal((await complete(other)).rows.length, 0, "Stale tokens cannot save results");
  assert.equal((await complete(token)).rows.length, 1);
  await db.query("update public.email_summary_cache set lease_token=null,lease_until=null where user_id=$1 and input_hash=$2 and lease_token=$3", [user, hash, token]);
  assert.equal((await db.query("select output from public.email_summary_cache where user_id=$1 and input_hash=$2", [user, hash])).rows[0].output, '{"summary":"saved"}');
  await db.exec(`select set_config('crm.workspace_id','${b}',false);`);
  assert.equal((await db.query("select * from public.email_summary_cache")).rows.length, 0, "Saved analyses cannot cross workspaces");
  assert.equal((await claim(user)).rows.length, 0);
  await db.query("insert into public.email_summary_cache(user_id,input_hash) values($1,$2)", [user, hash]);
  assert.equal((await claim(user)).rows.length, 1, "The same content can have an independent lease in another workspace");
  await db.exec("reset role");
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await db.query("select has_table_privilege($1,'public.email_summary_cache','select') as allowed", [role])).rows[0].allowed, false);
  }
  console.log("Email summary database checks passed: saved output, leases, stale writers, user filters, workspace isolation and client grants.");
} finally { await db.close(); }
