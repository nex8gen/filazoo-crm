import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { workflowDryRun } from "../lib/sending-mode.ts";

test("customer workflows send normally without an administrator choosing a server mode", () => {
  assert.equal(workflowDryRun({ NODE_ENV: "production" }), false);
  assert.equal(workflowDryRun({ NODE_ENV: "production", VERCEL_ENV: "production" }), false);
  for (const environment of [{}, { NODE_ENV: "development" }, { DRY_RUN: "true" }, { NODE_ENV: "production", DRY_RUN: "true" }, { NODE_ENV: "production", VERCEL_ENV: "development" }]) {
    assert.equal(workflowDryRun(environment), false);
  }
  for (const environment of [{ NODE_ENV: "test" }, { NODE_ENV: "production", VERCEL_ENV: "preview" }]) {
    assert.equal(workflowDryRun(environment), true);
  }
});

test("an explicit operator setting always wins over the deployment default", () => {
  assert.equal(workflowDryRun({ NODE_ENV: "production", FLOW_DRY_RUN: "true" }), true);
  assert.equal(workflowDryRun({ NODE_ENV: "development", DRY_RUN: "false" }), false);
  assert.equal(workflowDryRun({ NODE_ENV: "production", VERCEL_ENV: "preview", FLOW_DRY_RUN: "false" }), false);
  assert.equal(workflowDryRun({ NODE_ENV: "production", FLOW_DRY_RUN: "invalid" }), true);
  assert.equal(workflowDryRun({ DRY_RUN: "true", FLOW_DRY_RUN: "false" }), false);
  assert.equal(workflowDryRun({ DRY_RUN: "false", FLOW_DRY_RUN: "true" }), true);
});

test("the actual server environment schema uses the same mode and rejects invalid settings", () => {
  const require = createRequire(import.meta.url);
  const source = ts.transpileModule(readFileSync(new URL("../lib/env.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  function load(environment: Record<string, string>) {
    const exports: { env?: { dryRun: boolean; flowDryRun: boolean; DRY_RUN: string } } = {};
    vm.runInNewContext(source, { exports, process: { env: environment }, require: (name: string) => name === "./sending-mode.ts" ? { workflowDryRun } : require(name) });
    return exports.env!;
  }
  assert.equal(load({ NODE_ENV: "production" }).flowDryRun, false);
  assert.equal(load({ NODE_ENV: "production" }).dryRun, true, "Other automation keeps its existing default");
  assert.equal(load({ NODE_ENV: "production", VERCEL_ENV: "preview" }).flowDryRun, true);
  assert.equal(load({ NODE_ENV: "production", DRY_RUN: "true" }).flowDryRun, false);
  assert.equal(load({ NODE_ENV: "development", DRY_RUN: "false" }).flowDryRun, false);
  const workflowOnly = load({ DRY_RUN: "true", FLOW_DRY_RUN: "false" });
  assert.equal(workflowOnly.flowDryRun, false);
  assert.equal(workflowOnly.dryRun, true);
  assert.throws(() => load({ DRY_RUN: "invalid" }), /Invalid server environment/);
  assert.throws(() => load({ FLOW_DRY_RUN: "invalid" }), /Invalid server environment/);
});
