import assert from "node:assert/strict";
import test from "node:test";
import { submitFlowEmail } from "../lib/flow-smtp.ts";

test("a connection timeout can reconnect once before SMTP submission", async () => {
  let attempts = 0;
  const result = await submitFlowEmail(async () => {
    if (++attempts === 1) throw Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT", command: "CONN" });
    return { messageId: "accepted-once" };
  });
  assert.equal(result.messageId, "accepted-once");
  assert.equal(attempts, 2);
});
test("SMTP DATA, authentication and unknown failures are never automatically resubmitted", async () => {
  for (const command of ["DATA", "AUTH", undefined]) {
    let attempts = 0;
    await assert.rejects(submitFlowEmail(async () => { attempts++; throw Object.assign(new Error("Interrupted"), { code: "ETIMEDOUT", command }); }), /Interrupted/);
    assert.equal(attempts, 1);
  }
});
