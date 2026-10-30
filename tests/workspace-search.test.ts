import assert from "node:assert/strict";
import test from "node:test";
import { workspaceSearchFilter, searchInvoiceNumber, validWorkspaceSearch, normalizeWorkspaceSearch, rankWorkspaceResults, isWorkspaceSearchResponse, workspaceSearchDetail, type WorkspaceSearchResult } from "../lib/workspace-search.ts";
import { workspaceSearchLabels } from "../lib/workspace-search.ts";
import { translateUiText } from "../lib/i18n.ts";

test("workspace search quotes filter values and escapes LIKE wildcards", () => {
  const query = 'Acme, "R&D" (100%)_\\';
  const filter = workspaceSearchFilter(["name", "domain"], query);
  const expected = JSON.stringify('%Acme, "R&D" (100\\%)\\_\\\\%');
  assert.equal(filter, `name.ilike.${expected},domain.ilike.${expected}`);
});
test("workspace search accepts Chinese, email addresses and references with bounded input", () => {
  assert.equal(normalizeWorkspaceSearch("  测试  客户  "), "测试 客户");
  for (const value of ["测试", "name@example.com", "PO-2026-01", "INV-000001", "%_"]) assert.ok(validWorkspaceSearch(value));
  for (const value of ["", "a", "**", "abc*", "ab\u0000cd", "a".repeat(121)]) assert.equal(validWorkspaceSearch(value), false);
});
test("workspace search resolves actual invoice labels without extracting numbers from PO references", () => {
  for (const value of ["INV-000042", "inv 42", "#42", "000042"]) assert.equal(searchInvoiceNumber(value), 42);
  for (const value of ["PO-42", "invoice for 42", "12345678901234567890"]) assert.equal(searchInvoiceNumber(value), null);
});
test("workspace search deduplicates invoice sources, ranks exact titles and caps each type", () => {
  const result = (id: string, title: string): WorkspaceSearchResult => ({ id, title, kind: "company", detail: "", href: `/companies/${id}` });
  const ranked = rankWorkspaceResults([result("z", "Acme"), ...Array.from({ length: 10 }, (_, i) => result(String(i), `Acme supplier ${i}`)), result("z", "Acme")], "Acme");
  assert.equal(ranked.length, 6); assert.equal(ranked[0].id, "z");
});
test("workspace search rejects unsafe destinations and malformed API payloads", () => {
  const base = { query: "acme", results: [{ id: "c", kind: "company", title: "Acme", detail: "", href: "/companies/c" }], unavailable: [] };
  assert.ok(isWorkspaceSearchResponse(base));
  for (const href of ["//example.com", "https://example.com", "javascript:alert(1)"]) assert.equal(isWorkspaceSearchResponse({ ...base, results: [{ ...base.results[0], href }] }), false);
  assert.equal(isWorkspaceSearchResponse({ ...base, unavailable: ["private_table"] }), false);
});
test("search localizes task status metadata while preserving business names", () => {
  const item: WorkspaceSearchResult = { id: "t", kind: "task", title: "Task", detail: "Open Metal Ltd · done", href: "/tasks?task=t" };
  const labels: Record<string, string> = { Completed: "已完成", "Task is open": "任务待处理" };
  const translate = (value: string) => labels[value] ?? value;
  assert.equal(workspaceSearchDetail(item, translate), "Open Metal Ltd · 已完成");
  assert.equal(workspaceSearchDetail({ ...item, detail: "open" }, translate), "任务待处理");
  assert.equal(workspaceSearchDetail({ ...item, kind: "company", detail: "Open Metal Ltd" }, translate), "Open Metal Ltd");
});
test("all dynamic search headings and task metadata have Chinese translations", () => {
  for (const label of Object.values(workspaceSearchLabels)) assert.notEqual(translateUiText(label, "zh-CN"), label, label);
  assert.equal(translateUiText("Task is open", "zh-CN"), "任务待处理");
});
