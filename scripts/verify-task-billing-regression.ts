// Additional no-send regression under the approved, labelled live QA fixture.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { workflowOwner } from "../lib/data/task-workflow-preparation";
import { createAgentTask } from "../lib/data/agent-tasks";
import { processTaskWorkflows, taskWorkflowDetail } from "../lib/data/task-workflows";
import { executeTaskWorkflow } from "../lib/data/task-workflow-execution";
import { getInvoice, mutateInvoice } from "../lib/data/invoices";
import { invoiceTotals } from "../lib/invoices";
import { renderInvoicePdf } from "../lib/invoice-pdf";
import { withMailboxSyncSessions } from "../lib/mailbox-imap";

async function main() {
  const checkpointPath = "tmp/task-workflow-live-checkpoint.json";
  const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
  assert.equal(checkpoint.phase, "complete", "Run only after the approved three-message test.");
  checkpoint.billingRegressionId ??= randomUUID();
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  const db = createSupabaseAdmin();
  const { data: originalWork } = await db.from("crm_task_workflows").select("owner_id,payload").eq("task_id", checkpoint.requestId).single().throwOnError();
  const viewer = await workflowOwner(originalWork.owner_id);
  const input = { ...originalWork.payload.input }; delete input.shippingMinor;
  await createAgentTask(viewer, checkpoint.billingRegressionId, { op: "create_task", companyId: checkpoint.companyId, title: "[QA] Billing address extraction regression — no send", notes: "Reuse the approved QA reply as an explicit regression fixture. Prepare a draft only; no additional email is authorized.", workflow: input });
  // A test fixture association, never an alternative production handoff path.
  await db.from("crm_task_workflows").update({ request_id: checkpoint.requestId }).eq("task_id", checkpoint.billingRegressionId).throwOnError();
  await processTaskWorkflows({ taskId: checkpoint.billingRegressionId, maxJobs: 1 });
  let detail = await taskWorkflowDetail(viewer, checkpoint.billingRegressionId);
  if (detail.workflow.status === "blocked") detail = await executeTaskWorkflow(viewer, checkpoint.billingRegressionId, { action: "prepare", revision: detail.workflow.revision });
  assert.equal(detail.workflow.status, "ready", JSON.stringify(detail.workflow.blockers));
  assert.ok(detail.invoice);
  assert.match(detail.invoice.document.customerAddress, /99 Synthetic Test Road/i);
  assert.match(detail.invoice.document.shippingAddress!, /99 Synthetic Test Road/i);
  assert.doesNotMatch(detail.invoice.document.customerAddress, /Obsolete|London/i);
  assert.equal(detail.workflow.payload.shippingConfirmed, false);
  assert.match(detail.workflow.payload.subject!, /Filazoo task QA/);
  const originalInvoice = await getInvoice(checkpoint.requestId);
  assert.equal(originalInvoice?.status, "draft");
  const document = { ...originalInvoice!.document, customerAddress: detail.invoice.document.customerAddress };
  const corrected = await mutateInvoice(originalInvoice!.id, viewer.id, { action: "save", revision: originalInvoice!.revision, document, totalMinor: invoiceTotals(document).total });
  const pdf = await renderInvoicePdf(corrected, new Date().toISOString().slice(0, 10));
  writeFileSync("tmp/pdfs/task-workflow-qa-corrected.pdf", pdf);
  const evidencePath = "docs/audit-evidence/task-workflows-live-20261030.json";
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  evidence.billingRegression = { taskId: checkpoint.billingRegressionId, invoiceId: detail.invoice.id, fullBillingAddressExtracted: true, fullShippingAddressExtracted: true, quotedAddressIgnored: true, originalThreadSubjectPreserved: true, shippingStillRequiresConfirmation: true, initialQaPdfHadCountryOnlyBilling: true, originalDraftCorrectedWithoutResend: true, additionalEmailSent: false, correctedPdfBytes: pdf.length };
  checkpoint.results = evidence;
  writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ phase: "billing-regression-PASS", ...evidence.billingRegression }));
}
void withMailboxSyncSessions(main).catch(error => { console.error(error); process.exitCode = 1; });
