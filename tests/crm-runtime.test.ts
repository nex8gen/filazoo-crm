import assert from "node:assert/strict";
import test from "node:test";
import { crmRuntimePlan } from "../scripts/start-crm.mjs";

test("normal CRM use builds and serves production with the same isolated output mode", () => {
  const plan = crmRuntimePlan([], { NODE_ENV: "development", EXISTING_LOCAL_SETTING: "retained" });
  assert.equal(plan.origin, "http://localhost:3001");
  assert.equal(plan.environment.NODE_ENV, "production");
  assert.equal(plan.environment.FILAZOO_STABLE_RUNTIME, "1");
  assert.equal(plan.environment.EXISTING_LOCAL_SETTING, "retained");
  assert.deepEqual(plan.commands, [
    ["scripts/check-local-env.mjs"],
    ["node_modules/next/dist/bin/next", "build"],
    ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3001"],
  ]);
});

test("restarting the prepared CRM skips compilation while retaining production mode", () => {
  const plan = crmRuntimePlan(["--skip-build", "--port=3101"], {});
  assert.equal(plan.build, false);
  assert.equal(plan.origin, "http://localhost:3101");
  assert.equal(plan.commands.some(command => command.includes("build") || command.includes("dev")), false);
  assert.equal(plan.environment.NODE_ENV, "production");
});

test("invalid ports and unsupported runtime flags fail before building or starting a server", () => {
  for (const argument of ["--port=0", "--port=65536", "--port=abc", "--hostname=0.0.0.0", "--dev"]) {
    assert.throws(() => crmRuntimePlan([argument], {}));
  }
});
