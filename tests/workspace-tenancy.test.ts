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

test("signed webhook upserts adapt only a rejected legacy conflict target after the rollout", async () => {
  for (const scope of [null, { workspaceId: "legacy" }]) {
    const calls: { target: string | null; body: string; headers: Headers }[] = [];
    const request = workspaceFetch(async () => scope, async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push({ target: url.searchParams.get("on_conflict"), body: String(init?.body), headers: new Headers(init?.headers) });
      return calls.length === 1 ? Response.json({ code: "42P10" }, { status: 400 }) : Response.json([{ webhook_id: "test" }]);
    });
    const response = await request("https://test.supabase.co/rest/v1/shopify_leads?on_conflict=webhook_id", {
      method: "POST", body: '{"webhook_id":"test"}', headers: { "x-crm-control": "1", "x-crm-workspace-id": "forged" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(call => call.target), ["webhook_id", "workspace_id,webhook_id"]);
    assert.ok(calls.every(call => call.body === '{"webhook_id":"test"}' && !call.headers.has("x-crm-control") && !call.headers.has("x-crm-workspace-id")));
  }
});

test("webhook compatibility never replays successful writes, permission errors or server failures", async () => {
  for (const [status, code] of [[200, ""], [400, "23505"], [403, "42501"], [500, "42P10"]] as const) {
    let count = 0;
    const request = workspaceFetch(async () => null, async () => { count++; return Response.json({ code }, { status }); });
    const response = await request("https://test.supabase.co/rest/v1/shopify_leads?on_conflict=webhook_id", { method: "POST", body: "{}" });
    assert.equal(response.status, status);
    assert.equal(count, 1);
  }
});
