// Read-only database + server/PDF integration check. Does not send messages or mutate records.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { readQuotation, quotationDetail, mutateQuotation, QuotationError } from "../lib/data/quotations";
import { renderQuotationPdf } from "../lib/quotation-pdf";
import { quotationDocumentSchema } from "../lib/quotations";
import type { WorkspaceViewer } from "../lib/auth";

async function main() {
  const db = createSupabaseAdmin();
  const { data: members } = await db.from("workspace_members").select("user_id,role").not("activated_at", "is", null).throwOnError();
  const { data: quotes } = await db.from("catalogs").select("id,user_id,companies!inner(name)").not("quote_document", "is", null).like("companies.name", "%DO NOT CONTACT%").order("created_at", { ascending: false }).limit(1).throwOnError();
  const quote = quotes?.[0]; assert.ok(quote, "Save a clearly labelled internal QA quotation in the browser first.");
  const member = members?.find(row => row.user_id === quote.user_id); assert.ok(member);
  const owner = { id: member.user_id, role: member.role } as WorkspaceViewer;
  const catalog = await readQuotation(quote.id, owner); const detail = await quotationDetail(quote.id, owner); assert.ok(catalog.quote_document); assert.equal(detail.initial.items.length, catalog.quote_document.items.length);
  for (const other of members ?? []) {
    if (other.user_id === member.user_id) continue;
    await assert.rejects(readQuotation(quote.id, { id: other.user_id, role: other.role } as WorkspaceViewer), error => error instanceof QuotationError && error.status === 404);
  }
  const readonly = { ...owner, role: "viewer" } as WorkspaceViewer;
  assert.equal((await quotationDetail(quote.id, readonly)).canWrite, false);
  await assert.rejects(mutateQuotation(quote.id, { action: "share", revision: catalog.quote_revision }, readonly), error => error instanceof QuotationError && error.status === 403);
  await assert.rejects(mutateQuotation(quote.id, { action: "share", revision: catalog.quote_revision + 10 }, owner), /changed/);
  mkdirSync("tmp/quotation-pdf", { recursive: true });
  const pdf = await renderQuotationPdf(catalog); assert.equal(pdf.subarray(0, 4).toString(), "%PDF"); writeFileSync("tmp/quotation-pdf/saved-quotation.pdf", pdf);
  const first = catalog.quote_document.items[0];
  const items = Array.from({ length: 99 }, (_, index) => ({ ...first, description: `测试产品 ${index + 1} / Saved product variant with a longer description` }));
  const subtotalMinor = items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
  const stress = quotationDocumentSchema.parse({ ...catalog.quote_document, customerName: "测试客户 / QA customer", items, subtotalMinor, totalMinor: subtotalMinor + catalog.quote_document.shippingMinor, notes: "测试报价，仅用于验证。\nThis document is generated for layout verification only." });
  writeFileSync("tmp/quotation-pdf/long-quotation.pdf", await renderQuotationPdf({ ...catalog, quote_document: stress }));
  console.log(JSON.stringify({ privateOwnershipChecks: (members?.length ?? 1) - 1, readOnlyBlocked: true, staleRevisionBlocked: true, savedQuotationPdf: true, longChineseQuotationPdf: true, qaId: quote.id }));
}
main().catch(error => { console.error("Quotation verification failed:", error instanceof assert.AssertionError ? error.message : error instanceof QuotationError ? error.message : error instanceof Error ? error.name : "Unknown error"); process.exitCode = 1; });
