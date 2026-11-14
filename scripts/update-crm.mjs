import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCrmPort } from "./start-crm.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function syncCrmSource(run, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const branch = (await run("git", ["branch", "--show-current"])).trim();
  if (branch !== "main") throw new Error("Switch to main before running crm:update. Your current branch was preserved.");
  for (let attempt = 1; ; attempt++) {
    try {
      await run("git", ["-c", "http.version=HTTP/1.1", "-c", "http.lowSpeedLimit=1", "-c", "http.lowSpeedTime=30", "fetch", "origin", "refs/heads/main:refs/remotes/origin/main"]);
      break;
    } catch (error) {
      if (attempt === 3 || !/early EOF|partial file|RPC failed|timed? out|timeout|SSL_ERROR_SYSCALL|Connection reset|Couldn't connect|Could not resolve|Failed to connect/i.test(error.message)) throw error;
      console.log(`Download interrupted. Retrying (${attempt + 1}/3)...`);
      await wait(attempt * 1000);
    }
  }
  const [ahead, behind] = (await run("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"])).trim().split(/\s+/).map(Number);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) throw new Error("Could not compare local and remote versions.");
  if (ahead) throw new Error("Local main contains commits absent from origin/main. Reconcile them before updating; no local commits were removed.");
  if (behind) {
    if ((await run("git", ["status", "--porcelain", "--untracked-files=no"])).trim()) throw new Error("New code is available, but local files have edits. Commit or stash your edits, then rerun crm:update. Nothing was overwritten.");
    await run("git", ["merge", "--ff-only", "origin/main"]);
  }
  return (await run("git", ["rev-parse", "--short", "HEAD"])).trim();
}

function run(command, args, capture = true, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...environment, GIT_TERMINAL_PROMPT: "0" }, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "", errors = "";
    child.stdout?.on("data", chunk => { output += chunk; });
    child.stderr?.on("data", chunk => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(output) : reject(new Error(`${command} failed (${code}). ${errors || "See output above."}`)));
  });
}

async function main() {
  await checkCrmPort(3001);
  const commit = await syncCrmSource(run);
  console.log(`Source synchronized at ${commit}. Installing the pinned release dependencies...`);
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--no-audit", "--no-fund"], false);
  await run(process.execPath, ["scripts/start-crm.mjs", "--build-only"], false);
  await run(process.execPath, ["scripts/audit-client-bundles.mjs"], false, { FILAZOO_STABLE_RUNTIME: "1" });
  console.log(`CRM ${commit} is prepared. Run npm run crm:start and open http://localhost:3001.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
