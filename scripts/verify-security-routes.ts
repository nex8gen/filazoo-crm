import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// HTTP verification against a local Next server. Creates no customer records.
const appUrl = process.env.SECURITY_VERIFY_APP_URL || "http://localhost:3108";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(appUrl).hostname), "This check is restricted to a local app server");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
const admin = createClient(url, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "x-crm-control": "1" } } });
const check = (result: { error: { code?: string } | null }, stage: string) => { if (result.error) throw new Error(`${stage} failed (${result.error.code || "unknown"})`); };
function totp(secret: string) {
  const bits = [...secret].map(c => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0")).join("");
  const secretBytes = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", secretBytes).update(counter).digest();
  return ((hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
function authClient() {
  const jar = new Map<string, string>();
  const auth = createServerClient(url, key, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: changes => { changes.forEach(({ name, value }) => { if (value) jar.set(name, value); else jar.delete(name); }); } } });
  return { auth, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}
async function read(path: string, cookie = "") {
  const response = await fetch(new URL(path, appUrl), { headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36" }, redirect: "manual", signal: AbortSignal.timeout(60000) });
  return { response, body: await response.text() };
}
function redirected(result: Awaited<ReturnType<typeof read>>, path: string) {
  return result.response.headers.get("location")?.includes(path) || result.body.includes(`url=${path}`) || result.body.includes(`NEXT_REDIRECT;replace;${path};`);
}

let userId: string | undefined;
let workspaceId: string | undefined;
try {
  const loginPage = await read("/login"); assert.equal(loginPage.response.status, 200); assert.match(loginPage.body, /Sign in with a passkey/);
  console.log("PASS login renders passkey sign-in");
  const email = `security-routes-${randomBytes(8).toString("hex")}@example.invalid`;
  const password = `Verify!${randomBytes(24).toString("hex")}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); check(created, "Create route verification account"); userId = created.data.user!.id;
  workspaceId = randomUUID();
  check(await admin.from("workspaces").insert({ id: workspaceId, owner_id: userId, slug: `security-${workspaceId}`, name: "Security verification workspace" }), "Create isolated workspace");
  check(await admin.from("workspace_subscriptions").update({ grandfathered: true }).eq("workspace_id", workspaceId), "Enable isolated workspace access");
  check(await admin.from("workspace_members").insert({ workspace_id: workspaceId, user_id: userId, role: "admin", display_name: "Security verification", activated_at: new Date().toISOString() }), "Activate test membership");
  const first = authClient(); check(await first.auth.auth.signInWithPassword({ email, password }), "Route test sign-in");
  const settings = await read("/settings/security", first.cookie()); assert.equal(settings.response.status, 200);
  for (const title of ["Manage sessions", "Two-step verification", "Add passkey", "Last login", "This device"]) assert.ok(settings.body.includes(title), `Missing security settings: ${title}`);
  assert.ok(!settings.body.includes('data-next-error-message='), "Security settings failed during rendering");
  console.log("PASS authenticated settings renders devices, current-session status, passkeys and authenticator setup");
  const enrollment = await first.auth.auth.mfa.enroll({ factorType: "totp", friendlyName: "Route verification" }); check(enrollment, "Enroll route test authenticator");
  check(await first.auth.auth.mfa.challengeAndVerify({ factorId: enrollment.data!.id, code: totp(enrollment.data!.totp.secret) }), "Verify route test authenticator");
  const verified = await read("/settings/security", first.cookie()); assert.ok(verified.body.includes("Manage sessions") && verified.body.includes("Add backup authenticator"));
  console.log("PASS verified AAL2 sessions retain access to security settings");
  const pending = authClient(); check(await pending.auth.auth.signInWithPassword({ email, password }), "Create pending MFA session");
  const blocked = await read("/settings/security", pending.cookie()); assert.ok(redirected(blocked, "/auth/mfa"), "Pending MFA must redirect to verification");
  assert.ok(!blocked.body.includes('data-slot="card-title">Manage sessions'), "Session data leaked before MFA");
  const challenge = await read("/auth/mfa", pending.cookie()); assert.equal(challenge.response.status, 200); assert.match(challenge.body, /Verify and sign in/); assert.match(challenge.body, /one-time-code/);
  console.log("PASS pending MFA cannot render security data and receives a functioning verification form");
  const unauthenticated = await read("/api/tasks"); assert.equal(unauthenticated.response.status, 401);
  console.log("PASS unsigned requests cannot reach staff APIs");
} finally {
  // Default runtime state can be initialized by background jobs. Clean up in
  // one transaction, so no worker can recreate a foreign-key row between REST
  // deletions. This explicit live check requires the authenticated Supabase CLI.
  if (workspaceId && userId) {
    const uuid = /^[0-9a-f-]{36}$/i; assert.ok(uuid.test(workspaceId) && uuid.test(userId));
    const projectRef = new URL(url).hostname.split(".")[0]; assert.match(projectRef, /^[a-z]{20}$/);
    const directory = mkdtempSync(join(tmpdir(), "filazoo-security-cleanup-"));
    const file = join(directory, "cleanup.sql");
    writeFileSync(file, `begin;
      update public.workspaces set owner_id=null where id='${workspaceId}' and owner_id='${userId}' and name='Security verification workspace';
      delete from public.workspace_members where workspace_id='${workspaceId}';
      delete from public.mailbox_sync_state where workspace_id='${workspaceId}';
      delete from public.crm_tag_runtime_state where workspace_id='${workspaceId}';
      delete from public.workspaces where id='${workspaceId}' and name='Security verification workspace' and owner_id is null;
      delete from auth.users where id='${userId}' and email like 'security-routes-%@example.invalid';
      commit;`);
    try {
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "npx --yes supabase db query --remote=$env:FILAZOO_SECURITY_PROJECT_REF --yes --file $env:FILAZOO_SECURITY_CLEANUP_SQL --output-format json; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"], { windowsHide: true, stdio: "pipe", env: { ...process.env, FILAZOO_SECURITY_PROJECT_REF: projectRef, FILAZOO_SECURITY_CLEANUP_SQL: file } });
    } finally { rmSync(file); rmdirSync(directory); }
  } else if (userId) check(await admin.auth.admin.deleteUser(userId), "Remove route verification account");
  console.log("Route verification account, workspace and credentials removed.");
}
