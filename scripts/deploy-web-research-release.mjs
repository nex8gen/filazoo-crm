import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
const root = process.cwd();
const child = spawn(process.execPath, [path.join(root, "tmp/vercel-cli-cache/_npx/624bc71218319a47/node_modules/vercel/dist/vc.js"), "deploy", "--prod", "--skip-domain", "--archive=tgz", "--no-wait", "--json", "--yes", "--project", "prj_8FpTI4sEU5vUDrochgFpT3IjCXCn", "--scope", "team_TuvssrxhHF8qgyVEckWNUiBq", "--meta", "webResearchFix=google-discovery-url-context"], { cwd: path.join(root, "tmp/web-research-release/source"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let output = "", errors = "";
child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { errors += data; });
child.on("exit", code => {
  writeFileSync("tmp/web-research-release/deployment.json", output); writeFileSync("tmp/web-research-release/deployment.log", errors);
  if (code) { console.error(errors.slice(-1800)); process.exitCode = code; return; }
  const result = JSON.parse(output); console.log(JSON.stringify({ status: result.status, deployment: result.deployment && { id: result.deployment.id, url: result.deployment.url } }));
});
