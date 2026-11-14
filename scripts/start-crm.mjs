import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkLocalDependencies } from "./check-local-dependencies.mjs";
import { assertCurrentLocalBuild, localBuildFingerprint, saveLocalBuild } from "./local-build-state.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function crmRuntimePlan(args = [], environment = process.env) {
  let port = "3001";
  let build = true;
  let serve = true;
  for (const arg of args) {
    if (arg === "--skip-build") build = false;
    else if (arg === "--build-only") serve = false;
    else if (/^--port=\d+$/.test(arg)) port = arg.slice(7);
    else throw new Error(`Unknown argument: ${arg}. Use --port=3001, --skip-build or --build-only.`);
  }
  if (!build && !serve) throw new Error("--skip-build and --build-only cannot be used together.");
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error("Choose a port between 1 and 65535.");
  return {
    port: Number(port),
    origin: `http://localhost:${Number(port)}`,
    environment: { ...environment, NODE_ENV: "production", FILAZOO_STABLE_RUNTIME: "1" },
    commands: [
      ["scripts/check-local-env.mjs"],
      ...(build ? [["node_modules/next/dist/bin/next", "build"]] : []),
      ...(serve ? [["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(Number(port))]] : []),
    ],
    build,
  };
}

export async function checkCrmPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use. If the CRM is running, open http://localhost:${port}. Stop it before rebuilding.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function main() {
  // Use the same local account/database configuration as the development CRM.
  // Only the rendering/build mode changes; never print environment values.
  checkLocalDependencies(root);
  const { default: nextEnv } = await import("@next/env");
  nextEnv.loadEnvConfig(root, true);
  const plan = crmRuntimePlan(process.argv.slice(2));
  await checkCrmPort(plan.port);
  const fingerprint = localBuildFingerprint(root, plan.environment);
  if (!plan.build) assertCurrentLocalBuild(root, fingerprint);
  let child;
  const stop = () => child?.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    for (const args of plan.commands) {
      const serving = args.includes("start");
      if (serving) console.log(`\nCRM ready for normal use: ${plan.origin}\nProduction mode; development edits do not rebuild this running app.\n`);
      else if (args.includes("build")) console.log("Preparing the optimized CRM build...");
      const code = await new Promise((resolve, reject) => {
        child = spawn(process.execPath, args, { cwd: root, env: plan.environment, stdio: "inherit", windowsHide: true });
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
      if (code !== 0) { process.exitCode = code; return; }
      if (args.includes("build")) {
        if (localBuildFingerprint(root, plan.environment) !== fingerprint) throw new Error("Application files changed while building. Run npm run crm again before starting this build.");
        saveLocalBuild(root, fingerprint);
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
