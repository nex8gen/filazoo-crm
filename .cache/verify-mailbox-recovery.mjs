import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const control = createClient(url, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false }, global: { headers: { 'x-crm-control': '1' } } });
const { data: owner, error: ownerError } = await control.auth.admin.getUserById('9755e816-c3a5-43e3-b83c-a3748199e529');
assert.ifError(ownerError);
const { data: link, error: linkError } = await control.auth.admin.generateLink({ type: 'magiclink', email: owner.user.email });
assert.ifError(linkError);
const cookies = new Map();
const client = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: { getAll: () => [...cookies].map(([name,value]) => ({ name,value })), setAll: values => values.forEach(({name,value}) => cookies.set(name,value)) } });
const { error } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
assert.ifError(error);
cookies.set('crm_workspace', '80e30a20-fe11-4b78-9b38-ce59414ab31d');
try {
  for (const origin of ['http://localhost:3000', 'https://crm.filazoosupply.com']) {
    const started = performance.now();
    const response = await fetch(origin + '/api/email/inbox?refresh=false&mailboxId=42730707-1304-4d11-94cc-2dd88dd229b5', { headers: { Cookie: [...cookies].map(([name,value]) => `${name}=${value}`).join('; ') }, signal: AbortSignal.timeout(90000) });
    const body = await response.text();
    let result; try { result = JSON.parse(body); } catch { result = {}; }
    console.log(JSON.stringify({ origin, status: response.status, bytes: Buffer.byteLength(body), elapsedMs: Math.round(performance.now() - started), messages: result.emails?.length, inboxError: result.inboxError, error: result.error, readOnly: true }));
  }
} finally { await client.auth.signOut({ scope: 'local' }); }
