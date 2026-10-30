import assert from "node:assert/strict";
import test from "node:test";
import { auditFlowDefinition, flowAuditCanLaunch } from "../lib/flow-audit.ts";
import { defaultFlowInput, type FlowInput } from "../lib/flows.ts";

test("audit passes the safe default B2B follow-up", () => {
  const findings = auditFlowDefinition(defaultFlowInput);
  assert.equal(flowAuditCanLaunch(findings), true);
  assert.equal(findings.find((item) => item.id === "reply-safety")?.severity, "pass");
});

test("audit blocks email that ignores a customer reply", () => {
  const flow: FlowInput = { ...defaultFlowInput, steps: defaultFlowInput.steps.map((step) => step.type === "send_email" ? { ...step, config: { ...step.config, stopOnReply: false } } : step) };
  const findings = auditFlowDefinition(flow);
  assert.equal(flowAuditCanLaunch(findings), false);
  assert.equal(findings.find((item) => item.id === "reply-safety")?.severity, "error");
});

test("audit warns about consecutive messages and anytime sending", () => {
  const email = defaultFlowInput.steps.find((step) => step.type === "send_email")!;
  const flow: FlowInput = { ...defaultFlowInput, steps: [{ ...email, id: "one", config: { ...email.config, sendWindow: "anytime" } }, { ...email, id: "two" }] };
  const findings = auditFlowDefinition(flow);
  assert.equal(findings.find((item) => item.id === "message-pacing")?.severity, "warning");
  assert.equal(findings.find((item) => item.id === "send-window")?.severity, "warning");
});
