import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { FlowPreparationRetry } from "../lib/flow-execution-errors.ts";

const require = createRequire(import.meta.url);
function allowance(state: string, failure = false) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const exports: {
    reserveWorkflowEmail?: (run: string, step: string) => Promise<boolean>;
    finishWorkflowEmail?: (run: string, step: string, result: string) => Promise<void>;
    workflowEmailNotSubmitted?: (error: unknown) => boolean;
  } = {};
  const source = ts.transpileModule(readFileSync(new URL('../lib/billing/workflow-email.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, Date, require: (name: string) => ({
    'server-only': {}, '../flow-execution-errors.ts': { FlowPreparationRetry },
    '../supabase/admin.ts': { createSupabaseAdmin: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: { state, resetsAt: new Date(Date.now() + 10 * 86_400_000).toISOString() }, error: failure ? { message: 'private database error' } : null };
    } }) },
  }[name] ?? require(name)) });
  return { ...exports, calls };
}

test('workflow email capacity fails closed and never resends an accepted or uncertain submission', async () => {
  assert.equal(await allowance('reserved').reserveWorkflowEmail!('run', 'step'), true);
  assert.equal(await allowance('sent').reserveWorkflowEmail!('run', 'step'), false);
  for (const state of ['pending', 'uncertain']) await assert.rejects(allowance(state).reserveWorkflowEmail!('run', 'step'), /Delivery may have started/);
  for (const [state, failure] of [['unexpected', false], ['reserved', true]] as const) {
    await assert.rejects(allowance(state, failure).reserveWorkflowEmail!('run', 'step'), (error: unknown) => error instanceof FlowPreparationRetry && error.category === 'data' && !error.message.includes('private database'));
  }
  await assert.rejects(allowance('limited').reserveWorkflowEmail!('run', 'step'), (error: unknown) => error instanceof FlowPreparationRetry && error.category === 'monthly_limit' && error.delayMs > 9 * 86_400_000);
});

test('quota calls identify the run/action and do not accept a client-provided usage total', async () => {
  const app = allowance('reserved');
  await app.reserveWorkflowEmail!('run', 'step');
  await app.finishWorkflowEmail!('run', 'step', 'sent');
  assert.equal(app.calls[0].name, 'reserve_workflow_email');
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].args)), { p_run_id: 'run', p_step_id: 'step' });
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls[1].args)), { p_run_id: 'run', p_step_id: 'step', p_outcome: 'sent' });
  await assert.rejects(allowance('reserved', true).finishWorkflowEmail!('run', 'step', 'sent'), /Unable to record/);
});

test('only definitive SMTP rejection or a pre-submission failure releases capacity', () => {
  const { workflowEmailNotSubmitted: safe } = allowance('reserved');
  for (const error of [{ message: 'SMTP connection failed before submission: timeout' }, { command: 'AUTH PLAIN', code: 'EAUTH' }, { responseCode: 550 }, { responseCode: 421 }]) assert.equal(safe!(error), true);
  for (const error of [new Error('Timed out after DATA'), { code: 'ETIMEDOUT', command: 'DATA' }, {}, null]) assert.equal(safe!(error), false);
});
