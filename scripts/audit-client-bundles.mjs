import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import vm from "node:vm";

// Deterministic budgets for HTML shell scripts and selected client entry chunks.
// Neither measures live latency or features downloaded after interaction.
const root = process.cwd();
const buildRoot = path.join(root, process.env.FILAZOO_STABLE_RUNTIME === "1" ? ".next-crm" : ".next");
const limits = JSON.parse(await readFile(path.join(root, "docs/performance-budgets.json"), "utf8"));
const files = new Map();
const results = [];
async function measure(urls) {
  let bytes = 0, gzipBytes = 0;
  for (const url of new Set(urls)) {
    if (!files.has(url)) {
      const file = path.resolve(buildRoot, url.slice("/_next/".length));
      if (!file.startsWith(buildRoot + path.sep)) throw new Error("Invalid build asset path");
      const data = await readFile(file);
      files.set(url, { bytes: data.length, gzipBytes: gzipSync(data).length });
    }
    const size = files.get(url); bytes += size.bytes; gzipBytes += size.gzipBytes;
  }
  return { scripts: new Set(urls).size, bytes, gzipBytes };
}
const emittedRoutes = limits.allRouteShells
  ? (await readdir(path.join(buildRoot, "server/app"), { recursive: true })).filter(file => file.endsWith(".html")).map(file => file.slice(0, -5))
  : [];
for (const route of new Set([...limits.routes, ...emittedRoutes])) {
  const html = await readFile(path.join(buildRoot, "server/app", route + ".html"), "utf8");
  const urls = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]).filter(url => url.startsWith("/_next/static/") && url.endsWith(".js")))];
  const size = await measure(urls);
  const maxGzipBytes = limits.routeLimits?.[route] ?? limits.maxShellGzipBytes;
  results.push({ route: route === "index" ? "/" : "/" + route, ...size, maxGzipBytes, pass: size.gzipBytes <= maxGzipBytes });
}
const clientEntries = [];
for (const entry of limits.clientEntries ?? []) {
  const context = { globalThis: {} };
  // Next emits this local manifest as a JavaScript assignment, not JSON.
  vm.runInNewContext(await readFile(path.join(buildRoot, "server/app", entry.manifest + "_client-reference-manifest.js"), "utf8"), context);
  const manifest = Object.values(context.globalThis.__RSC_MANIFEST)[0];
  const clientModule = Object.entries(manifest.clientModules).find(([name]) => name.endsWith("/" + entry.module))?.[1];
  if (!clientModule) throw new Error(`Client entry missing from build: ${entry.module}`);
  const urls = clientModule.chunks.filter(chunk => chunk.endsWith(".js")).map(chunk => chunk.startsWith("/_next/") ? chunk : "/_next/" + chunk);
  if (!urls.length) throw new Error(`No JavaScript chunks for client entry: ${entry.module}`);
  const size = await measure(urls);
  clientEntries.push({ module: entry.module, ...size, maxGzipBytes: entry.maxGzipBytes, pass: size.gzipBytes <= entry.maxGzipBytes });
}
console.log(JSON.stringify({ scope: "prerendered shell scripts and client entry chunks", maxGzipBytes: limits.maxShellGzipBytes, results, clientEntries }, null, 2));
const output = process.argv.indexOf("--output");
if (output !== -1 && process.argv[output + 1]) await writeFile(process.argv[output + 1], JSON.stringify(results, null, 2) + "\n");
if ([...results, ...clientEntries].some(result => !result.pass)) { console.error("Initial JavaScript budget exceeded. Check global imports and deferred features."); process.exitCode = 1; }
