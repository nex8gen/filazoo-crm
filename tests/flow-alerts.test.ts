import assert from "node:assert/strict";
import test from "node:test";
import { flowAlertKey, flowAlerts, partitionFlowAlerts } from "../lib/flow-alerts.ts";
import { flowConnectorHealth } from "../lib/flow-connector-health.ts";
import { blankStep, defaultFlowInput, flowInputSchema, type FlowInput, type JsonConfig } from "../lib/flows.ts";

function base(steps: FlowInput["steps"]): FlowInput { return { ...structuredClone(defaultFlowInput), status: "draft", steps }; }

test("a newly inserted incomplete email produces one immediate, action-specific setup alert", () => {
  const email = blankStep("send_email"), flow = base([blankStep("wait"), email]);
  const alerts = flowAlerts(flow, flowConnectorHealth(flow));
  const setup = alerts.filter(alert => alert.target === "action");
  assert.equal(setup.length, 1);
  assert.equal(setup[0].actionId, email.id);
  assert.equal(setup[0].title, "Set up email");
  assert.equal(setup[0].step, 2);
  assert.equal(alerts.some(alert => alert.id === "workflow:health"), false, "schema summary must not duplicate the action alert");
  const fixed = base([blankStep("wait"), { ...email, config: { ...email.config, templateId: "helpful_reminder" } }]);
  assert.equal(flowAlerts(fixed).filter(alert => alert.target === "action").length, 0);
});

test("incomplete actions inside multiple split levels retain their identities and path context", () => {
  const email = blankStep("send_email"), task = blankStep("create_task"); task.config.title = "";
  const inner = blankStep("split");
  (inner.config.paths as Array<{ steps: FlowInput["steps"] }>)[0].steps = [email, task];
  const outer = blankStep("split");
  (outer.config.paths as Array<{ steps: FlowInput["steps"] }>)[1].steps = [inner];
  const alerts = flowAlerts(base([outer])).filter(alert => alert.target === "action");
  assert.deepEqual(alerts.map(alert => alert.actionId), [email.id, task.id]);
  assert.ok(alerts.every(alert => alert.trail?.length === 4));
  assert.ok(alerts.every(alert => ![inner.id, outer.id].includes(alert.actionId)));
});

test("dismissal changes presentation without making an incomplete workflow launchable", () => {
  const flow = base([blankStep("send_email")]), alerts = flowAlerts(flow);
  const keys = [flowAlertKey(alerts[0])];
  const state = partitionFlowAlerts(alerts, keys);
  assert.equal(state.active.length, 0);
  assert.equal(state.dismissed.length, 1);
  assert.equal(flowInputSchema.safeParse(flow).success, false);
  const changed = alerts.map(alert => ({ ...alert, detail: "A different setting needs attention." }));
  assert.equal(partitionFlowAlerts(changed, keys).active.length, 1, "a changed problem must reactivate");
  assert.equal(partitionFlowAlerts([], keys).dismissed.length, 0, "resolved problems disappear from both tabs");
});

test("runtime failures and unverified connections stay attached to the affected action", () => {
  const a = blankStep("wait"), b = blankStep("stop"), flow = base([a, b]);
  const alerts = flowAlerts(flow, { state: "error", message: "Task execution failed", actions: {
    [a.id!]: { state: "live", message: "" }, [b.id!]: { state: "error", message: "Task execution failed" },
  } });
  assert.equal(alerts.length, 1); assert.equal(alerts[0].actionId, b.id);
  const unverified = flowAlerts(flow, { state: "unknown", message: "Connection timed out", actions: { [a.id!]: { state: "unknown", message: "Connection timed out" } } });
  assert.equal(unverified.length, 1); assert.equal(unverified[0].severity, "warning");
  assert.equal(unverified[0].actionId, a.id);
});

test("global provider failures are reviewable without assigning them to a healthy action", () => {
  const alerts = flowAlerts(base([blankStep("wait")]), { state: "error", message: "Delivery service is unavailable" });
  assert.equal(alerts.length, 1); assert.equal(alerts[0].target, "checks"); assert.equal(alerts[0].actionId, undefined);
});

test("pending health and ordinary unsaved edits are not setup notifications", () => {
  const flow = base([blankStep("wait"), blankStep("stop")]);
  for (const message of ["Checking workflow health", "Save changes to verify this live workflow"]) assert.deepEqual(flowAlerts(flow, { state: "unknown", message }), []);
});

test("optional business-hour preferences do not inflate the required setup count", () => {
  const email = blankStep("send_email");
  email.config = { ...email.config, templateId: "helpful_reminder", sendWindow: "anytime" };
  assert.deepEqual(flowAlerts(base([email])), []);
});

test("trigger errors and workflow-level checks can be reviewed independently", () => {
  const flow = { ...base([blankStep("stop")]), name: "", triggerType: "no_reply" as const, triggerConfig: { amount: 0, unit: "days" } as JsonConfig };
  const alerts = flowAlerts(flow);
  assert.ok(alerts.some(alert => alert.target === "trigger"));
  assert.ok(alerts.some(alert => alert.target === "workflow"));
});

test("reply safety is one actionable alert instead of a repeated workflow warning", () => {
  const email = blankStep("send_email"); email.config = { ...email.config, templateId: "helpful_reminder", stopOnReply: false };
  const flow = base([email]);
  const alerts = flowAlerts(flow, flowConnectorHealth(flow));
  assert.equal(alerts.filter(alert => alert.severity === "error").length, 1);
  assert.equal(alerts[0].actionId, email.id);
});
