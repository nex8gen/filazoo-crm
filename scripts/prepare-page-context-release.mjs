import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = process.cwd();
const baseline = path.join(root, "tmp/research-intent-release/source");
const source = path.join(root, "tmp/page-context-release/source");
const prior = JSON.parse(fs.readFileSync(path.join(root, "docs/audit-evidence/google-web-research-intent-20261106.json"), "utf8"));
if (prior.production.deploymentId !== "dpl_C4zRZuUPM1Wxazp12N7fexSZrLBg") throw new Error("Unexpected production baseline");
for (const [file, expected] of Object.entries(prior.sourceSha256)) {
  if (createHash("sha256").update(fs.readFileSync(path.join(baseline, file))).digest("hex") !== expected) throw new Error(`Production baseline changed: ${file}`);
}
if (!fs.existsSync(source)) {
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.cpSync(baseline, source, { recursive: true, filter: name => !name.split(path.sep).some(part => ["node_modules", ".next", ".git"].includes(part)) });
  fs.symlinkSync(path.join(root, "node_modules"), path.join(source, "node_modules"), "junction");
}
const files = ["lib/ai/request-context.ts", "lib/ai/native-agent.ts", "lib/ai/workspace-assistant.ts", "app/api/ai/assistant/route.ts", "tests/request-context.test.ts", "tests/agent-routes.test.ts", "tests/ai-policy.test.ts", "tests/agent-crm-tools.test.ts", "tests/native-agent.test.ts", "tests/chat-history.test.ts", "tests/helpers/ai-policy.ts"];
for (const file of files) { fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true }); fs.copyFileSync(path.join(root, file), path.join(source, file)); }
fs.writeFileSync(path.join(source, "../manifest.json"), JSON.stringify({ baseDeployment: prior.production.deploymentId, source, files, scope: "Current-page defaults, explicit cross-page targets, general questions and bounded read-only Chat lookups. Existing CRM UI and navigation preserved." }, null, 2) + "\n");
console.log(JSON.stringify({ source, files }));
