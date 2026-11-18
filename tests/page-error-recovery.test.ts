import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("page error buttons use Next's server retry instead of replaying a failed snapshot", () => {
  for (const file of ["../app/error.tsx", "../app/@company/(.)companies/[id]/error.tsx"]) {
    const exports: { default?: (props: object) => unknown } = {};
    const source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const jsx = (type: unknown, props: object) => ({ type, props });
    vm.runInNewContext(source, { exports, require: (name: string) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "@/components/data-state") return { ErrorState: "error-state" };
      throw new Error(name);
    } });
    let reads = 0;
    const retry = () => { reads++; };
    const tree = exports.default!({ retry, reset: () => assert.fail("reset does not refetch Server Components") });
    function click(value: unknown): boolean {
      if (!value || typeof value !== "object") return false;
      const node = value as { type?: string; props?: { retry?: () => void; onClick?: () => void; children?: unknown } };
      const handler = node.type === "error-state" ? node.props?.retry : node.type === "button" ? node.props?.onClick : undefined;
      if (handler) { handler(); return true; }
      return (Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).some(click);
    }
    assert.ok(click(tree), file);
    assert.equal(reads, 1);
  }
});
