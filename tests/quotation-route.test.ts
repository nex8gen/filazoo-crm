import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { z } from "zod";

class QuotationError extends Error { status: number; constructor(message: string, status = 409) { super(message); this.status = status; } }
const id = "35d7d7ac-9e0d-4ab2-8bc8-94efe65b4108";
function load(options: { denied?: boolean; fail?: number; pdf?: boolean } = {}) {
  const calls: string[] = [];
  const read = async (_id: string, viewer: { id: string }) => { assert.equal(viewer.id, "actual-member"); calls.push("read"); if (options.fail) throw options.fail === 500 ? new Error("secret backend detail") : new QuotationError("Quotation not found in your account.", options.fail); return { catalog: { company_id: "company" }, quote_document: { items: [] } }; };
  const deps: Record<string, unknown> = { zod: { z }, "next/cache": { revalidatePath: (path: string) => calls.push(path) }, "@/lib/auth": { getWorkspaceViewer: async () => options.denied ? null : { id: "actual-member", role: "viewer" } }, "@/lib/data/quotations": { QuotationError, readQuotation: read, quotationDetail: read, mutateQuotation: async (_id: string, body: unknown, viewer: { id: string }) => { assert.equal(viewer.id, "actual-member"); calls.push("mutate"); if (options.fail) throw new QuotationError("Not allowed", options.fail); assert.ok(body); return { id }; } }, "@/lib/quotation-pdf": { renderQuotationPdf: async () => Buffer.from("%PDF-1.7") }, "@/lib/quotations": { quotationLabel: () => "Q-QA-V1" } };
  const exports = {} as { GET: (r: Request, context: unknown) => Promise<Response>; PATCH: (r: Request, context: unknown) => Promise<Response> };
  const file = options.pdf ? "../app/api/catalogs/[id]/quotation/pdf/route.ts" : "../app/api/catalogs/[id]/quotation/route.ts";
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: (name: string) => deps[name], Response, URL, Uint8Array });
  return { api: exports, calls };
}
const context = (value = id) => ({ params: Promise.resolve({ id: value }) });
const request = (origin: string | null = "https://crm.test") => new Request(`https://crm.test/api/catalogs/${id}/quotation`, { method: "PATCH", headers: origin ? { origin, "content-type": "application/json" } : {}, body: JSON.stringify({ action: "share", revision: 1 }) });
test("quotation endpoints authenticate before reading or mutating private records", async () => {
  const { api, calls } = load({ denied: true }); assert.equal((await api.GET(request(), context())).status, 401); assert.equal((await api.PATCH(request(), context())).status, 401); assert.equal(calls.length, 0);
});
test("quotation mutations reject cross-site or missing origins and invalid identifiers", async () => {
  const { api, calls } = load(); for (const origin of [null, "https://attacker.test"]) assert.equal((await api.PATCH(request(origin), context())).status, 403);
  assert.equal((await api.PATCH(request(), context("invalid"))).status, 400); assert.equal(calls.length, 0);
});
test("quotation reads do not cache or reveal internal errors", async () => {
  const result = await load().api.GET(request(), context()); assert.equal(result.headers.get("cache-control"), "private, no-store");
  const failed = await load({ fail: 500 }).api.GET(request(), context()); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /secret backend/);
  assert.equal((await load({ fail: 404 }).api.GET(request(), context())).status, 404);
});
test("successful quotation mutations refresh connected list, company and work queue", async () => {
  const { api, calls } = load(); const result = await api.PATCH(request(), context()); assert.equal(result.status, 200);
  assert.ok(calls.includes("/catalogs/companies")); assert.ok(calls.includes("/companies/company")); assert.ok(calls.includes("/my-day"));
});
test("PDF endpoint is private and uses a safe inline or download filename", async () => {
  assert.equal((await load({ pdf: true, denied: true }).api.GET(request(), context())).status, 401);
  const { api } = load({ pdf: true }); const inline = await api.GET(request(), context()); assert.equal(inline.headers.get("content-type"), "application/pdf"); assert.match(inline.headers.get("content-disposition")!, /^inline; filename="Q-QA-V1.pdf"/);
  const download = await api.GET(new Request(`https://crm.test/api/catalogs/${id}/quotation/pdf?download=1`), context()); assert.match(download.headers.get("content-disposition")!, /^attachment/); assert.equal(download.headers.get("cache-control"), "private, no-store");
});
