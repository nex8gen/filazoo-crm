import assert from "node:assert/strict";
import test from "node:test";
import { uploadFlowAttachment } from "../lib/attachment-upload.ts";

test("a lost upload response retries the same private path safely before SMTP", async () => {
  let calls = 0;
  await uploadFlowAttachment(async (options) => {
    assert.equal(options.upsert, true);
    return { error: ++calls === 1 ? { message: "fetch failed" } : null };
  });
  assert.equal(calls, 2);
});
test("upload retries are bounded and permission failures fail immediately", async () => {
  for (const statusCode of [403, 503]) {
    let calls = 0;
    await assert.rejects(uploadFlowAttachment(async () => { calls++; return { error: { message: "Storage unavailable", statusCode } }; }), /Storage unavailable/);
    assert.equal(calls, statusCode === 403 ? 1 : 3);
  }
});
