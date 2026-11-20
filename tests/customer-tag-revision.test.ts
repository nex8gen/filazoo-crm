import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('rules and processing changes refresh company views while respecting assigned-company scope', async () => {
  let stateRevision='2026-11-20T01:00:00Z';
  const scopes: string[][]=[];
  const exports={} as { GET: () => Promise<Response> };
  const db={from(table: string) {const query={select(){return query;},not(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},
    in(_key: string, ids: string[]){scopes.push(ids);return query;},throwOnError:async()=>({data:{updated_at:table==='crm_email_tags'?'2026-11-19T01:00:00Z':stateRevision}})};return query;}};
  const dependencies={ '@/lib/auth':{requireWorkspaceMember:async()=>({workspaceId:'workspace'})},'@/lib/supabase/admin':{createSupabaseAdmin:()=>db},
    '@/lib/data/email-access':{getAssignedEmailContacts:async()=>new Map([['buyer@example.invalid','assigned-company']])}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/api/customer-tags/revision/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,Response,require:(name:string)=>dependencies[name as keyof typeof dependencies]});
  const before=await exports.GET();
  const first=await before.json();
  stateRevision='2026-11-20T01:02:00Z';
  const second=await (await exports.GET()).json();
  assert.notEqual(first.revision,second.revision,'No saved email assignment needs to change for rules/health to refresh');
  assert.equal(before.headers.get('Cache-Control'),'private, no-store');
  assert.ok(scopes.length===4 && scopes.every(ids=>ids.length===1 && ids[0]==='assigned-company'));
  assert.doesNotMatch(JSON.stringify(second),/buyer@|assigned-company/,'The probe exposes no contact or company details');
});
