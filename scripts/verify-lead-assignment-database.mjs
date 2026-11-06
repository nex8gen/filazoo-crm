// Local PostgreSQL integration verification, with no connection to hosted data.
// npm install --prefix tmp/lead-assignment-db --no-save --package-lock=false --ignore-scripts @electric-sql/pglite
// node scripts/verify-lead-assignment-database.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "../tmp/lead-assignment-db/node_modules/@electric-sql/pglite/dist/index.js";

const root = new URL("../", import.meta.url);
const migration = readFileSync(new URL("supabase/migrations/20261106023215_lead_assignment_controls.sql", root), "utf8");
const companyMigration = readFileSync(new URL("supabase/migrations/20261026063746_crm_company_action_connections.sql", root), "utf8");
const manualAssignment = companyMigration.slice(companyMigration.indexOf("create or replace function public.assign_company_owner"));
const admin = "00000000-1111-4111-8111-111111111111";
const a = "aaaaaaaa-1111-4111-8111-111111111111";
const b = "bbbbbbbb-1111-4111-8111-111111111111";
const c = "cccccccc-1111-4111-8111-111111111111";
let assertions = 0;

for (const tenancy of [false, true]) {
  const db = new PGlite();
  const sql = (text, params = []) => db.query(text, params);
  const value = async (text, params = []) => (await sql(text, params)).rows[0]?.value;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.workspace_members(user_id uuid primary key, role text, display_name text,
      auto_assign_leads boolean default true, activated_at timestamptz, last_lead_assigned_at timestamptz,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table public.companies(id uuid primary key default gen_random_uuid(),name text);
    create table public.pipeline(company_id uuid primary key references public.companies(id),owner_id uuid,stage text default 'new',updated_at timestamptz);
    create table public.shopify_leads(company_id uuid,owner_id uuid,assignment_method text);
    create table public.meta_leads(company_id uuid,owner_id uuid,assignment_method text);
    create table public.events(actor_id uuid,company_id uuid,type text,data jsonb);
  `);
  await db.exec(manualAssignment.replace(/commit;\s*$/i, ""));
  if (tenancy) {
    await db.exec(`
      create role crm_workspace_server;
      create schema crm_tenancy;
      create table public.workspaces(id uuid primary key);
      create function crm_tenancy.workspace_id() returns uuid language sql stable as $$
        select nullif(current_setting('crm.workspace_id',true),'')::uuid;
      $$;
      insert into public.workspaces values ('11111111-1111-4111-8111-111111111111'),('22222222-1111-4111-8111-111111111111');
      select set_config('crm.workspace_id','11111111-1111-4111-8111-111111111111',false);
      grant usage on schema public,crm_tenancy to crm_workspace_server;
      grant execute on function crm_tenancy.workspace_id() to crm_workspace_server;
      grant execute on function public.assign_company_owner(uuid,uuid,uuid) to crm_workspace_server;
    `);
    for (const table of ["workspace_members", "companies", "pipeline", "shopify_leads", "meta_leads", "events"]) {
      await db.exec(`alter table public.${table} add column workspace_id uuid not null default crm_tenancy.workspace_id();
        alter table public.${table} enable row level security;
        create policy tenant on public.${table} to crm_workspace_server using(workspace_id=crm_tenancy.workspace_id()) with check(workspace_id=crm_tenancy.workspace_id());
        grant select,insert,update,delete on public.${table} to crm_workspace_server;`);
    }
  }
  await db.exec(migration);
  if (tenancy) await db.exec("set role crm_workspace_server");
  await sql("insert into public.workspace_members(user_id,role,display_name,activated_at) values ($1,'admin','Admin',now()),($2,'bd_manager','A',now()),($3,'bd_manager','B',now()),($4,'bd_manager','Inactive',null)", [admin, a, b, c]);
  const read = () => value("select public.read_lead_assignment_settings($1) as value", [admin]);
  const save = async (overrides = {}) => {
    const view = await read();
    return value("select public.save_lead_assignment_settings($1,$2::jsonb) as value", [admin, JSON.stringify({
      revision: view.revision, enabled: view.enabled, strategy: view.strategy, workload: view.workload,
      members: view.members.map(({userId,enabled,capacity}) => ({userId,enabled,capacity})), ...overrides,
    })]);
  };
  const company = () => value("insert into public.companies(name) values ('Test buyer') returning id as value");
  const assign = async () => {
    const owner = await value("select public.assign_incoming_company($1) as value", [await company()]);
    // PGlite's millisecond clock can tie successive claims. Age successful turns
    // equally so the next claim has a distinct timestamp without changing order.
    if (owner) await sql("update public.workspace_members set last_lead_assigned_at=last_lead_assigned_at - interval '1 second'");
    return owner;
  };
  equal((await read()).revision, 0);
  equal(await assign(), a);
  equal(await assign(), b);
  equal(await assign(), a);
  equal((await read()).members.find(m => m.userId === a).total, 2);
  await save({ strategy: "round_robin" });
  equal(await assign(), b);
  equal(await assign(), a);
  // A high workload does not prevent a manager's turn in round robin.
  for (let index=0; index<4; index++) await sql("insert into public.pipeline(company_id,owner_id,stage) values ($1,$2,'won')", [await company(), b]);
  equal(await assign(), b);
  await save({ strategy: "lowest_workload", workload: "open" });
  equal(await assign(), a);
  const beforePause = await read();
  await save({ enabled: false });
  equal(await assign(), null);
  equal((await read()).members.map(m => m.lastAssignedAt), beforePause.members.map(m => m.lastAssignedAt));
  const queue = (await read()).unassigned;
  // Saving a sole-manager pool must never assign existing unowned companies.
  await save({ enabled: true, members: beforePause.members.map(m => ({ userId:m.userId, enabled:m.userId===a, capacity: m.userId===a ? m.open : null })) });
  equal((await read()).unassigned, queue);
  equal(await assign(), null); // A is exactly at capacity; B is paused; C is inactive.
  const pausedCompany = await company();
  equal(await value("select public.assign_company_owner($1,$2,$3) as value", [pausedCompany,b,admin]), "B");
  equal(await value("select public.assign_incoming_company($1) as value", [pausedCompany]), b); // Preserve manual owner.
  const policy = await read();
  const input = {revision:policy.revision,enabled:true,strategy:"round_robin",workload:"all",members:policy.members.map(m=>({userId:m.userId,enabled:m.userId!==c,capacity:null}))};
  await value("select public.save_lead_assignment_settings($1,$2::jsonb) as value", [admin,JSON.stringify(input)]);
  await assert.rejects(value("select public.save_lead_assignment_settings($1,$2::jsonb) as value", [admin,JSON.stringify(input)]), /settings changed/); assertions++;
  await assert.rejects(value("select public.read_lead_assignment_settings($1) as value", [a])); assertions++;
  for (const capacity of [0,-1,1.5,1000001,"fake"]) {
    await assert.rejects(save({members:input.members.map(m=>({...m,capacity}))})); assertions++;
  }
  await assert.rejects(save({members:[input.members[0],input.members[0],input.members[2]]}), /Duplicate manager/); assertions++;
  equal((await read()).revision, input.revision+1);
  equal(await value("select has_function_privilege('anon','public.assign_incoming_company(uuid)','execute') as value"), false);
  equal(await value("select has_function_privilege('authenticated','public.save_lead_assignment_settings(uuid,jsonb)','execute') as value"), false);
  if (tenancy) {
    await sql("select set_config('crm.workspace_id','22222222-1111-4111-8111-111111111111',false)");
    equal(await value("select count(*)::int as value from public.lead_assignment_settings"), 0);
    equal(await value("select public.claim_next_bd_sales_manager() as value"), null);
    await assert.rejects(read()); assertions++;
    await sql("insert into public.workspace_members(user_id,role,activated_at) values ($1,'admin',now())", ["dddddddd-1111-4111-8111-111111111111"]);
    const otherView=await value("select public.read_lead_assignment_settings($1) as value", ["dddddddd-1111-4111-8111-111111111111"]);
    equal(otherView.revision,0);
    equal(otherView.members,[]);
    await assert.rejects(value("select public.save_lead_assignment_settings($1,$2::jsonb) as value", ["dddddddd-1111-4111-8111-111111111111",JSON.stringify(input)]), /Manager pool changed/); assertions++;
  }
  await db.close();
  console.log(`Passed PostgreSQL checks (${tenancy ? "tenant RLS" : "legacy schema"}).`);
}
console.log(`${assertions} database assertions passed. No hosted data was accessed.`);
