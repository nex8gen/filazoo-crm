import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { tablePaginationState } from "../lib/table-pagination.ts";

const require = createRequire(import.meta.url);
type Element = { props: Record<string, unknown> };
const children = (element: Element) => element.props.children as Element[];
function control(file: string, name: string) {
  const exports: Record<string, (props: Record<string, unknown>) => Element> = {};
  const dependencies: Record<string, unknown> = {
    "@/components/ui/button": { Button: () => null },
    "@/components/language-provider": { useLanguage: () => ({ t: (value: string) => value }) },
    "@/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
    "@/lib/table-pagination": { tablePaginationState },
  };
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (module: string) => dependencies[module] ?? require(module) });
  return exports[name];
}

test("pagination uses the declared page callback and the real bounded row range", () => {
  const render = control("../components/ui/table-pagination.tsx", "TablePagination");
  const pages: number[] = [];
  let legacyPrevious = 0;
  const tree = render({ page: 2, pageCount: 2, total: 30, start: 26, end: 50, itemLabel: "companies", onPrevious: () => legacyPrevious++, onNext: () => {}, onPageChange: (page: number) => pages.push(page) });
  const [previous, range, next] = children(children(tree)[0]);
  assert.equal(range.props.children, "26–30");
  assert.equal(previous.props["aria-label"], "Previous page");
  assert.equal(next.props.disabled, true);
  (previous.props.onClick as () => void)();
  assert.deepEqual(pages, [1]);
  assert.equal(legacyPrevious, 0);
});

test("pagination preserves server-backed next handlers and blocks pending controls", () => {
  const render = control("../components/ui/table-pagination.tsx", "TablePagination");
  let nextPage = 0;
  const props = { page: 1, pageCount: 2, total: 30, itemLabel: "invoices", onPrevious: () => {}, onNext: () => nextPage++ };
  const tree = render(props);
  (children(children(tree)[0])[2].props.onClick as () => void)();
  assert.equal(nextPage, 1);
  const pending = render({ ...props, disabled: true });
  assert.equal(children(children(pending)[0])[0].props.disabled, true);
  assert.equal(children(children(pending)[0])[2].props.disabled, true);
});

test("disabled filter forms cannot commit through Enter while an action is pending", () => {
  const render = control("../components/ui/table-filters.tsx", "TableFilters");
  let applied = 0;
  let prevented = 0;
  const submit = (disabled: boolean) => {
    const form = children(render({ children: null, disabled, onApply: () => applied++ }))[0];
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => prevented++ });
  };
  submit(true);
  assert.equal(applied, 0);
  submit(false);
  assert.equal(applied, 1);
  assert.equal(prevented, 2);
});
