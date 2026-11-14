import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Include uncommitted application files too; a commit SHA alone cannot identify
// a local build. Never store source text or environment values in the stamp.
export function localBuildFingerprint(root, environment = process.env) {
  const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
    "app", "components", "hooks", "lib", "public", "scripts", "styles", "types",
    "*.json", "*.mjs", "*.ts", "*.tsx", "*.js", "*.css"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const hash = createHash("sha256");
  hash.update(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }));
  for (const file of [...new Set(paths)].sort()) {
    if (file.startsWith("docs/") || file.startsWith("tests/") || file.startsWith(".cache/")) continue;
    hash.update(file + "\0");
    try { hash.update(readFileSync(path.join(root, file))); }
    catch (error) { if (error.code !== "ENOENT") throw error; hash.update("deleted"); }
    hash.update("\0");
  }
  for (const file of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"]) {
    hash.update(file + "\0");
    try { hash.update(readFileSync(path.join(root, file))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    hash.update("\0");
  }
  for (const key of Object.keys(environment).filter(key => key.startsWith("NEXT_PUBLIC_")).sort()) hash.update(`${key}=${environment[key]}\0`);
  return hash.digest("hex");
}

export function saveLocalBuild(root, fingerprint) {
  const buildId = readFileSync(path.join(root, ".next-crm/BUILD_ID"), "utf8").trim();
  writeFileSync(path.join(root, ".next-crm/local-release.json"), JSON.stringify({ fingerprint, buildId }) + "\n");
}

export function assertCurrentLocalBuild(root, fingerprint) {
  let stamp;
  let buildId;
  try {
    stamp = JSON.parse(readFileSync(path.join(root, ".next-crm/local-release.json"), "utf8"));
    buildId = readFileSync(path.join(root, ".next-crm/BUILD_ID"), "utf8").trim();
  } catch { throw new Error("No verified normal-use CRM build exists. Run npm run crm to build the current version."); }
  if (stamp.fingerprint !== fingerprint || stamp.buildId !== buildId) {
    throw new Error("The local CRM build is older than your code or configuration. Run npm run crm to rebuild, or npm run crm:update to download and prepare the latest main release.");
  }
}
