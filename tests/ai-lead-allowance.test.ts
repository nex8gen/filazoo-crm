import test from "node:test";
import assert from "node:assert/strict";
import { budgetMeter, type AiBudgetSummary } from "../lib/ai/budget.ts";
import { leadAllowance, leadAllowanceBlocked, leadResetTime, leadUsd } from "../lib/lead-allowance.ts";
import { LeadApiError, leadApi, leadSearchFailureState } from "../lib/lead-client.ts";
import type { LeadSearch } from "../lib/ai-leads.ts";

function summary(remaining=64648):AiBudgetSummary {
  return {timezone:"Asia/Shanghai",members:5,enabled:true,daily:budgetMeter(200000-remaining,200000,"2026-11-09T16:00:00Z"),workspaceDaily:budgetMeter(0,1000000,"2026-11-09T16:00:00Z"),monthly:budgetMeter(0,30000000,"2026-11-30T16:00:00Z")};
}
test("preflight distinguishes a nonzero balance from an affordable reservation",()=>{
  const blocked=leadAllowance(summary(),68000);
  assert.equal(blocked.availableMicros,64648);assert.equal(blocked.requiredMicros,68000);assert.equal(leadAllowanceBlocked(blocked),true);
  assert.equal(leadAllowanceBlocked(leadAllowance(summary(68000),68000)),false);
  assert.equal(leadAllowanceBlocked(leadAllowance(summary(200000),68000)),false);
  assert.equal(leadUsd(64648),"$0.0646");assert.match(leadResetTime(blocked.resetsAt),/10 Nov.*00:00/);
});
test("preflight respects disabled and workspace/monthly limits and the latest blocking reset",()=>{
  assert.equal(leadAllowanceBlocked(leadAllowance({...summary(200000),enabled:false},68000)),true);
  const limits=summary();limits.monthly=budgetMeter(29950000,30000000,"2026-11-30T16:00:00Z");
  const blocked=leadAllowance(limits,68000);
  assert.equal(blocked.scope,"monthly");assert.equal(blocked.availableMicros,50000);assert.equal(blocked.resetsAt,"2026-11-30T16:00:00Z");
});
test("failed and cancelled searches never present as completed zero-result research",()=>{
  const base={status:"failed",error:"Your remaining daily AI allowance is too low for this request."} as LeadSearch;
  assert.equal(leadSearchFailureState(base)?.kind,"allowance");
  assert.equal(leadSearchFailureState({...base,error:"Gateway timeout"})?.title,"Search could not finish");
  assert.equal(leadSearchFailureState({...base,status:"cancelled"})?.kind,"cancelled");
  for(const status of ["complete","queued","running"] as const)assert.equal(leadSearchFailureState({...base,status}),null);
});
test("the client preserves structured allowance errors without retrying a request",async()=>{
  const previous=globalThis.fetch;let calls=0;
  const allowance=leadAllowance(summary(),68000);
  try {
    globalThis.fetch=async()=>{calls++;return Response.json({error:"CRM allowance is too low",code:"AI_ALLOWANCE_BLOCKED",allowance},{status:429});};
    await assert.rejects(()=>leadApi("/api/ai/leads","POST",{}),(error:unknown)=>{
      assert.ok(error instanceof LeadApiError);assert.deepEqual(error.allowance,allowance);return true;
    });
    assert.equal(calls,1);
  } finally {globalThis.fetch=previous;}
});
