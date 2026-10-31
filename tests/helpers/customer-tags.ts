import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as vocabulary from "../../lib/customer-tags.ts";

/** Execute the real shared-tag data functions against the caller's database fixture. */
export function customerTagDataFixture(createSupabaseAdmin: () => unknown) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL("../../lib/data/customer-tags.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "../customer-tags.ts" ? vocabulary : { createSupabaseAdmin }, Date, Map });
  return exports;
}
