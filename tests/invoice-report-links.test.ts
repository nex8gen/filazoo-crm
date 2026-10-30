import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { z } from "zod";

test("analytics issued-invoice link filters both the backend query and invoice workspace", async () => {
  const calls: unknown[][] = [];
  const deps: Record<string, unknown> = {
    "react/jsx-runtime": jsx, zod: { z },
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "viewer", role: "viewer" }) },
    "@/lib/data/invoices": { listInvoices: async (...args: unknown[]) => { calls.push(args); return { invoices: [], count: 0 }; } },
    "@/components/invoice-workspace": { InvoiceWorkspace: () => null },
    "next/navigation": { notFound: () => { throw new Error("Not found"); } },
  };
  const exports = {} as { default: (props: { searchParams: Promise<{ status?: string }> }) => Promise<{ props: { initialStatus: string; canWrite: boolean } }> };
  const code = ts.transpileModule(readFileSync(new URL("../app/invoices/page.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (id: string) => deps[id] ?? {}, Date });
  const issued = await exports.default({ searchParams: Promise.resolve({ status: "issued" }) });
  assert.equal(calls[0][2], "issued");
  assert.equal(issued.props.initialStatus, "issued");
  assert.equal(issued.props.canWrite, false);
  const invalid = await exports.default({ searchParams: Promise.resolve({ status: "invalid" }) });
  assert.equal(calls[1][2], "");
  assert.equal(invalid.props.initialStatus, "");
});
