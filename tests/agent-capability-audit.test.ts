import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentCapabilities, AGENT_CONTRACT_VERSION } from "../lib/ai/capabilities.ts";
import { crmMutationSurfaces } from "../lib/ai/surface-audit.ts";

test("every CRM mutation surface is audited, and new features require an explicit coverage decision", () => {
  const audit = JSON.parse(readFileSync(new URL("../docs/agent-capability-audit.json", import.meta.url), "utf8"));
  assert.equal(audit.contractVersion, AGENT_CONTRACT_VERSION);
  assert.deepEqual(audit.surfaces.map((surface: { surface: string }) => surface.surface), crmMutationSurfaces(process.cwd()), "Update scripts/audit-agent-capabilities.ts, register the typed tool or honest guided handoff, then regenerate the audit.");
  const tools = new Set(agentCapabilities().map(capability => capability.name));
  assert.deepEqual(audit.capabilities.map((capability: { name: string }) => capability.name), [...tools]);
  for (const surface of audit.surfaces) {
    assert.ok(surface.explanation);
    if (surface.mode === "direct") { assert.ok(surface.tools.length); for (const name of surface.tools) assert.ok(tools.has(name), name); }
  }
});
