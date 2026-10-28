import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

// A deterministic production-shell budget. It measures scripts referenced by
// prerendered HTML; route-specific streamed/interactive code is measured in the browser.
const root = process.cwd();
const limits = JSON.parse(await readFile(path.join(root, "docs/performance-budgets.json"), "utf8"));
const files = new Map();
const results = [];
for (const route of limits.routes) {
  const html = await readFile(path.join(root, ".next/server/app", route + ".html"), "utf8");
  const urls = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]).filter(url => url.startsWith("/_next/static/") && url.endsWith(".js")))];
  let bytes = 0, gzipBytes = 0;
  for (const url of urls) {
    if (!files.has(url)) {
      const file = path.resolve(root, ".next", url.slice("/_next/".length));
      if (!file.startsWith(path.resolve(root, ".next") + path.sep)) throw new Error("Invalid build asset path");
      const data = await readFile(file);
      files.set(url, { bytes: data.length, gzipBytes: gzipSync(data).length });
    }
    const size = files.get(url); bytes += size.bytes; gzipBytes += size.gzipBytes;
  }
  results.push({ route: route === "index" ? "/" : "/" + route, scripts: urls.length, bytes, gzipBytes, pass: gzipBytes <= limits.maxShellGzipBytes });
}
console.log(JSON.stringify({ scope: "prerendered shell scripts", maxGzipBytes: limits.maxShellGzipBytes, results }, null, 2));
const output = process.argv.indexOf("--output");
if (output !== -1 && process.argv[output + 1]) await writeFile(process.argv[output + 1], JSON.stringify(results, null, 2) + "\n");
if (results.some(result => !result.pass)) { console.error("Initial JavaScript budget exceeded. Check global imports and deferred features."); process.exitCode = 1; }
