import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as engine from '../lib/flow-engine.ts';
import * as flows from '../lib/flows.ts';
import * as tags from '../lib/customer-tags.ts';
console.log('Read-only enrollment diagnostic starting');
const timer = setTimeout(() => { console.log('Diagnostic timed out'); process.exit(1); }, 45000);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  global: { headers: { 'x-crm-workspace-id': '80e30a20-fe11-4b78-9b38-ce59414ab31d' }, fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(15000) }) },
});
const admin = { from(table) {
  const query = db.from(table);
  if (table === 'flow_runs') query.insert = () => {
    const stub = { select: () => stub, single: async () => ({ data: null, error: { code: 'DIAGNOSTIC', message: 'Would enroll; write blocked' } }) };
    return stub;
  };
  return query;
} };
const deps = { '../supabase/admin.ts': { createSupabaseAdmin: () => admin }, '../flow-engine.ts': engine, '../flows.ts': flows, '../customer-tags.ts': tags };
const output = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/data/flow-runtime.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: output, require: name => deps[name] || {}, console, Date, Map, Set });
const result = await output.enrollMatchingFlows({ type: 'email_received', flowId: '1fe98594-6349-4159-87b9-5e9973e5a23b', conversationId: 'diagnostic', occurredAt: '2026-11-17T08:57:45Z', eventKey: 'email_received:d0106d16-15a1-4808-a66d-c11eb80407e6', contactId: '9b0418d3-3c5f-4ab4-a8f9-24a795fc218a', companyId: 'faa6fe6a-ed92-4ab2-a2cd-e458da93d1dc', mailboxId: '42730707-1304-4d11-94cc-2dd88dd229b5' }, { deferExecution: true });
console.log(JSON.stringify(result));
clearTimeout(timer);
