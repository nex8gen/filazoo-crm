import assert from "node:assert/strict";
import test from "node:test";
import { assignmentCapacity, leadAssignmentSettingsSchema, nextAssignment, type LeadAssignmentView } from "../lib/lead-assignment-settings.ts";
import { assignIncomingCompany } from "../lib/lead-assignment.ts";

const a = "aaaaaaaa-1111-4111-8111-111111111111";
const b = "bbbbbbbb-1111-4111-8111-111111111111";
const view = (): LeadAssignmentView => ({ revision: 0, enabled: true, strategy: "lowest_workload", workload: "all", unassigned: 2, members: [
  { userId: a, name: "A", activated: true, enabled: true, capacity: null, total: 5, open: 1, lastAssignedAt: null },
  { userId: b, name: "B", activated: true, enabled: true, capacity: null, total: 2, open: 2, lastAssignedAt: "2026-11-05T01:00:00Z" },
] });

test("workload preview honors the selected scope and never changes the rotation", () => {
  const policy = view();
  const before = structuredClone(policy);
  assert.equal(nextAssignment(policy)?.userId, b);
  assert.deepEqual(policy, before);
  assert.equal(nextAssignment({ ...policy, workload: "open" })?.userId, a);
  assert.equal(nextAssignment({ ...policy, strategy: "round_robin" })?.userId, a);
});

test("pause, capacity and activation prevent automatic selection under both rules", () => {
  for (const strategy of ["lowest_workload", "round_robin"] as const) {
    const policy = { ...view(), strategy };
    policy.members[0].capacity = 5;
    policy.members[1].enabled = false;
    assert.equal(nextAssignment(policy), null);
    policy.members[0].capacity = 6;
    assert.equal(nextAssignment(policy)?.userId, a);
    policy.members[0].activated = false;
    assert.equal(nextAssignment(policy), null);
    assert.equal(nextAssignment({ ...view(), enabled: false }), null);
  }
});

test("equal loads use the oldest assignment, then a stable manager ID", () => {
  const policy = view();
  policy.members[0].total = 2;
  assert.equal(nextAssignment(policy)?.userId, a);
  policy.members[0].lastAssignedAt = "2026-11-05T02:00:00Z";
  assert.equal(nextAssignment(policy)?.userId, b);
  policy.members[1].lastAssignedAt = policy.members[0].lastAssignedAt;
  assert.equal(nextAssignment(policy)?.userId, a);
});

test("settings validate limits and reject duplicate or forged manager entries", () => {
  const policy = view();
  const input = { revision: policy.revision, enabled: policy.enabled, strategy: policy.strategy, workload: policy.workload,
    members: policy.members.map(({ userId, enabled, capacity }) => ({ userId, enabled, capacity })) };
  assert.equal(leadAssignmentSettingsSchema.safeParse(input).success, true);
  assert.equal(assignmentCapacity(""), null);
  assert.equal(assignmentCapacity("   "), null);
  for (const limit of ["0", "-1", "1.5", "NaN", "Infinity", "1000001"]) {
    assert.equal(leadAssignmentSettingsSchema.safeParse({ ...input, members: [{ ...input.members[0], capacity: assignmentCapacity(limit) }] }).success, false);
  }
  assert.equal(leadAssignmentSettingsSchema.safeParse({ ...input, members: [input.members[0], input.members[0]] }).success, false);
  assert.equal(leadAssignmentSettingsSchema.safeParse({ ...input, members: [{ ...input.members[0], userId: "forged" }] }).success, false);
  assert.equal(leadAssignmentSettingsSchema.safeParse({ ...input, enabled: "true" }).success, false);
  assert.equal(leadAssignmentSettingsSchema.safeParse({ ...input, revision: -1 }).success, false);
});

test("incoming-company helper distinguishes the unassigned queue from a backend failure", async () => {
  const calls: unknown[] = [];
  let result: { data: string | null; error: { message: string } | null } = { data: a, error: null };
  const admin = { rpc: async (...args: unknown[]) => { calls.push(args); return result; } } as unknown as Parameters<typeof assignIncomingCompany>[0];
  assert.equal(await assignIncomingCompany(admin, b), a);
  assert.deepEqual(calls, [["assign_incoming_company", { p_company_id: b }]]);
  result = { data: null, error: null };
  assert.equal(await assignIncomingCompany(admin, b), null);
  result = { data: null, error: { message: "database unavailable" } };
  await assert.rejects(assignIncomingCompany(admin, b), /database unavailable/);
});
