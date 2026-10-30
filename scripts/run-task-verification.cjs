/* eslint-disable @typescript-eslint/no-require-imports -- This verification-only CommonJS loader compiles existing server modules for Node. */
// Run server modules outside Next without weakening the application runtime boundary.
// Usage: node --env-file=.env.local scripts/run-task-verification.cjs scripts/verify-task-workflows.ts
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = process.cwd();
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) request = path.join(root, request.slice(2));
  if (request.startsWith(".") && parent?.filename) {
    const base = path.resolve(path.dirname(parent.filename), request);
    for (const suffix of [".ts", ".tsx"]) if (fs.existsSync(base + suffix)) return base + suffix;
  }
  return resolve.call(this, request, parent, ...rest);
};
Module._load = function (request, ...rest) {
  if (request === "server-only") return {};
  if (request === "next/cache") return { revalidatePath() {}, revalidateTag() {} };
  return load.call(this, request, ...rest);
};
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = function (module, filename) {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  module._compile(output, filename);
};
const entry = path.resolve(process.argv[2] || "");
if (!entry.startsWith(root + path.sep) || !entry.endsWith(".ts")) throw new Error("Choose a TypeScript verification script inside this workspace.");
require(entry);
