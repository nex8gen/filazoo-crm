import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFetch } from "../lib/supabase/workspace-fetch.ts";

const url = "https://database.test/rest/v1/emails?select=id";
const scope = async () => ({ workspaceId: "workspace-a", userId: "user-a" });

test("rolled-back table writes retry with the same body, authorization and workspace", async () => {
  for (const code of ["40P01", "40001"]) {
    let attempts = 0;
    const request = workspaceFetch(scope, async (input, init) => {
      attempts++;
      assert.equal(String(input), url);
      assert.equal(init?.body, '{"message_id":"already-accepted"}');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-crm-workspace-id"), "workspace-a");
      assert.equal(headers.get("x-crm-user-id"), "user-a");
      assert.equal(headers.get("authorization"), "Bearer fixture");
      return attempts === 1 ? Response.json({ code, message: "transaction rolled back" }, { status: 500 }) : Response.json([{ id: "saved" }]);
    });
    assert.deepEqual(await (await request(url, { method: "POST", headers: { authorization: "Bearer fixture" }, body: '{"message_id":"already-accepted"}' })).json(), [{ id: "saved" }]);
    assert.equal(attempts, 2);
  }
});

test("persistent deadlocks stop after three attempts and preserve the database error", async () => {
  let attempts = 0;
  const request = workspaceFetch(scope, async () => { attempts++; return Response.json({ code: "40P01", message: "deadlock detected" }, { status: 500 }); });
  const response = await request(url, { method: "PATCH", body: "{}" });
  assert.equal(attempts, 3);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "40P01");
});

test("uncertain commits, duplicate keys and arbitrary RPCs are never replayed", async () => {
  for (const code of ["23505", "42501", "PGRST002", "unknown"]) {
    let attempts = 0;
    const request = workspaceFetch(scope, async () => { attempts++; return Response.json({ code }, { status: 500 }); });
    assert.equal((await request(url, { method: "POST", body: "{}" })).status, 500);
    assert.equal(attempts, 1);
  }
  let attempts = 0;
  const request = workspaceFetch(scope, async () => { attempts++; return Response.json({ code: "40P01" }, { status: 500 }); });
  await request("https://database.test/rest/v1/rpc/send_something", { method: "POST", body: "{}" });
  assert.equal(attempts, 1);
  attempts = 0;
  const disconnected = workspaceFetch(scope, async () => { attempts++; throw new TypeError("fetch failed"); });
  await assert.rejects(disconnected(url, { method: "POST", body: "{}" }), /fetch failed/);
  assert.equal(attempts, 1);
});

test("Request bodies survive a proven rollback and cancellation prevents another write", async () => {
  let attempts = 0;
  const request = workspaceFetch(scope, async input => {
    attempts++;
    assert.ok(input instanceof Request);
    assert.equal(await input.text(), '{"status":"sent"}');
    return attempts === 1 ? Response.json({ code: "40P01" }, { status: 500 }) : Response.json([]);
  });
  await request(new Request(url, { method: "PATCH", body: '{"status":"sent"}' }));
  assert.equal(attempts, 2);
  const controller = new AbortController();
  attempts = 0;
  const cancelled = workspaceFetch(scope, async () => {
    attempts++;
    controller.abort();
    return Response.json({ code: "40P01" }, { status: 500 });
  });
  await assert.rejects(cancelled(url, { method: "POST", body: "{}", signal: controller.signal }), { name: "AbortError" });
  assert.equal(attempts, 1);
});
