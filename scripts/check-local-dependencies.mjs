import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkLocalDependencies(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const mismatches = [];
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const expected = lock.packages?.[`node_modules/${name}`]?.version;
    let installed;
    try { installed = JSON.parse(readFileSync(path.join(root, "node_modules", name, "package.json"), "utf8")).version; }
    catch { /* Missing packages are reported together below. */ }
    if (!expected || installed !== expected) mismatches.push(name);
  }
  if (mismatches.length) throw new Error(`Local dependencies do not match this release: ${mismatches.join(", ")}. Run npm ci, or npm run crm:update to update and rebuild.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkLocalDependencies(process.cwd()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
