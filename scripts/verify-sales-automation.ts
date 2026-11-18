// Read-only smoke checks. No emails, tasks, workflows or documents are changed.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-sales-automation.ts
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseControl } from "../lib/supabase/control.ts";

const origin = process.env.SALES_TEST_ORIGIN || "http://localhost:3000";
const control = createSupabaseControl();
const { data: workspace } = await control.from("workspaces").select("id,owner_id").eq("is_legacy", true).single().throwOnError();
const { data: user, error: userError } = await control.auth.admin.getUserById(workspace.owner_id);
assert.ifError(userError);
assert.ok(user.user?.email);
const { data: link, error } = await control.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
assert.ifError(error); assert.ok(link.properties?.hashed_token);
const jar = new Map<string, string>();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, {
  cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) },
});
assert.ifError((await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" })).error);
jar.set("crm_workspace", workspace.id);
const headers = { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), Origin: origin, "Content-Type": "application/json" };
try {
  for (const path of process.argv.includes("--ai-only") ? [] : ["/", "/workflow", "/documents", "/api/tasks?taskView=all&taskScope=mine", "/api/documents?attachable=1&sort=newest"]) {
    const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(90_000) });
    const text = await response.text();
    assert.equal(response.status, 200, `${path}: ${text.slice(0, 200)}`);
    if (path === "/") assert.match(text, /home-priorities-title/);
    console.log(JSON.stringify({ path, status: response.status, verified: true }));
  }
  const bad = await fetch(origin + "/api/documents/search", { method: "POST", headers, body: JSON.stringify({ query: "catalog", send: true }), signal: AbortSignal.timeout(90_000) });
  assert.equal(bad.status, 400, "Search cannot accept a sending instruction");
  if (process.argv.includes("--ai")) {
    const libraryResponse = await fetch(origin + "/api/documents?attachable=1&kind=template&sort=name", { headers, signal: AbortSignal.timeout(90_000) });
    const library = await libraryResponse.json();
    assert.equal(libraryResponse.status, 200);
    const existing = library.documents[0];
    assert.ok(existing, "An existing template is required for the positive search check");
    const response = await fetch(origin + "/api/documents/search", { method: "POST", headers, body: JSON.stringify({ query: `Find the saved email template named ${existing.name}`, kind: "template" }), signal: AbortSignal.timeout(90_000) });
    const result = await response.json();
    assert.equal(response.status, 200, result.error);
    assert.ok(Array.isArray(result.documents));
    assert.ok(result.documents.every((document: { kind: string }) => document.kind === "template"));
    assert.ok(result.documents.some((document: { name: string }) => document.name === existing.name), JSON.stringify({ requested: existing.name, matches: result.documents.map((document: { name: string }) => document.name), explanation: result.explanation }));
    console.log(JSON.stringify({ path: "/api/documents/search", status: response.status, matches: result.documents.length, readOnly: true }));
  }
} finally { await client.auth.signOut({ scope: "local" }); }
