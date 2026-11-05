import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFetch } from "../lib/supabase/workspace-fetch.ts";
import { invitationToken, invitationHash, validInvitationToken } from "../lib/workspace-invitations.ts";
import { workspaceSlug } from "../lib/workspaces.ts";
import { withWorkspaceContext, currentWorkspaceContext } from "../lib/workspace-context.ts";

test("tenant database requests use server-resolved scope and cannot forward forged control headers", async () => {
  let seen: { url: URL; headers: Headers; cache?: RequestCache } | undefined;
  const request = workspaceFetch(async () => ({ workspaceId: "workspace-a", userId: "user-a" }), async (input, init) => {
    seen = { url: new URL(String(input)), headers: new Headers(init?.headers), cache: init?.cache };
    return new Response("[]");
  });
  await request("https://test.supabase.co/rest/v1/products?on_conflict=sku", { headers: { "x-crm-control": "1", "x-crm-workspace-id": "forged" } });
  assert.equal(seen!.headers.get("x-crm-control"), null);
  assert.equal(seen!.headers.get("x-crm-workspace-id"), "workspace-a");
  assert.equal(seen!.headers.get("x-crm-user-id"), "user-a");
  assert.equal(seen!.url.searchParams.get("on_conflict"), "workspace_id,sku");
  assert.equal(seen!.cache, "no-store");
});

test("parallel tenant jobs retain independent context across awaited work", async () => {
  const a = "aaaaaaaa-1111-4222-8333-444444444444", b = "bbbbbbbb-1111-4222-8333-444444444444";
  const results = await Promise.all([a, b].map(id => withWorkspaceContext(id, async () => {
    await Promise.resolve(); return currentWorkspaceContext()?.workspaceId;
  })));
  assert.deepEqual(results, [a, b]);
  assert.equal(currentWorkspaceContext(), undefined);
  assert.throws(() => withWorkspaceContext("forged", () => {}));
});

test("invitations use strong opaque tokens, store hashes, and reject malformed bearer values", () => {
  const token = invitationToken();
  assert.ok(validInvitationToken(token));
  assert.notEqual(invitationToken(), token);
  assert.match(invitationHash(token), /^[a-f0-9]{64}$/);
  assert.notEqual(invitationHash(token), token);
  for (const invalid of ["", "../workspace", "short", "a".repeat(44)]) assert.equal(validInvitationToken(invalid), false);
  assert.equal(workspaceSlug("Acme & Co."), "acme-co");
});

test("legacy rollout compatibility preserves the existing database API and upsert keys", async () => {
  let observed: { headers: Headers; url: URL } | undefined;
  const request = workspaceFetch(async () => ({ workspaceId: "legacy", userId: "existing-member" }), async (input, init) => {
    observed = { headers: new Headers(init?.headers), url: new URL(String(input)) }; return new Response("[]");
  });
  await request("https://test.supabase.co/rest/v1/contacts?on_conflict=email");
  assert.equal(observed!.headers.get("x-crm-workspace-id"), null);
  assert.equal(observed!.url.searchParams.get("on_conflict"), "email");
});
