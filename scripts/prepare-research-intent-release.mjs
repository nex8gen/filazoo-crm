import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const root = process.cwd(), source = path.join(root, "tmp/research-intent-release/source");
const productionCommit = "dc8497bc6630bbd2efa762358f74352816494085";
if (!fs.existsSync(source)) {
  fs.mkdirSync(source, { recursive: true });
  const archive = path.join(source, "../production-source.tar");
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, productionCommit]);
  const entries = execFileSync("tar", ["-tf", archive], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim().split(/\r?\n/);
  if (entries.some(name => /^[A-Za-z]:|^[/\\]/.test(name) || name.replaceAll("\\", "/").split("/").includes(".."))) throw new Error("Unsafe archive paths");
  execFileSync("tar", ["-xf", archive, "-C", source]);
  fs.mkdirSync(path.join(source, ".vercel"), { recursive: true });
  fs.copyFileSync(path.join(root, ".vercel/project.json"), path.join(source, ".vercel/project.json"));
  fs.symlinkSync(path.join(root, "node_modules"), path.join(source, "node_modules"), "junction");
}
const changed = [];
function patch(file, before, after) {
  const target = path.join(source, file), text = fs.readFileSync(target, "utf8");
  if (text.includes(after)) return;
  if (!text.includes(before)) throw new Error(`Missing scoped release boundary: ${file}`);
  fs.writeFileSync(target, text.replace(before, after)); changed.push(file);
}
for (const file of ["lib/ai/research-request.ts", "components/ui/customer-research.tsx", "tests/research-request.test.ts", "tests/research-composer.test.ts", "tests/agent-routes.test.ts", "tests/ai-policy.test.ts", "tests/helpers/ai-policy.ts"]) {
  fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
  fs.copyFileSync(path.join(root, file), path.join(source, file)); changed.push(file);
}
const frontend = "components/workspace-ai-assistant.tsx";
patch(frontend, 'import { isInvoiceCreationRequest } from "@/lib/ai/assistant-intent";', 'import { isInvoiceCreationRequest } from "@/lib/ai/assistant-intent";\nimport { webSearchForRequest, type WebSearchPreference } from "@/lib/ai/research-request";');
patch(frontend, '  const [webSearch, setWebSearch] = useState(false);', '  const [webSearchPreference, setWebSearchPreference] = useState<WebSearchPreference>("auto");\n  const webSearch = webSearchForRequest(webSearchPreference, question);\n  const setWebSearch = (enabled: boolean) => setWebSearchPreference(enabled ? "on" : "off");');
patch(frontend, '    const pageContext = restoredElsewhere ?', '    const requestWebSearch = webSearchForRequest(webSearchPreference, content);\n    if (requestWebSearch && webSearchPreference === "auto") setWebSearchPreference("on");\n    const pageContext = restoredElsewhere ?');
patch(frontend, '          webSearch,', '          webSearch: requestWebSearch,');
const route = "app/api/ai/assistant/route.ts", currentRoute = fs.readFileSync(path.join(root, route), "utf8");
patch(route, 'import { researchCustomer } from "@/lib/ai/customer-research";', 'import { researchCustomer } from "@/lib/ai/customer-research";\nimport { companyResearchTarget } from "@/lib/ai/research-request";');
const previousRoute = fs.readFileSync(path.join(source, route), "utf8");
if (!previousRoute.includes('    const researchTarget =')) {
  const beforeStart = previousRoute.indexOf('    const research = parsed.data.webSearch ?'), beforeEnd = previousRoute.indexOf('    const researchResult =', beforeStart);
  const afterStart = currentRoute.indexOf('    const researchTarget ='), afterEnd = currentRoute.indexOf('    const researchResult =', afterStart);
  if ([beforeStart, beforeEnd, afterStart, afterEnd].some(value => value < 0)) throw new Error("Missing research route section");
  patch(route, previousRoute.slice(beforeStart, beforeEnd), currentRoute.slice(afterStart, afterEnd));
}
const instruction = '    "The current page supplies context; it does not restrict public research about a company explicitly named by the user. When WEB_RESEARCH is provided, answer from that evidence even from Analytics or another unrelated page, without requiring Agent mode or opening a company profile. Be concise and practical. Use short paragraphs and simple lists without markdown tables.",';
patch("lib/ai/workspace-assistant.ts", '    "Respect the current page scope. Be concise and practical. Use short paragraphs and simple lists without markdown tables.",', instruction);
const translationFile = "lib/i18n-ai-history.ts", target = path.join(source, translationFile);
let translations = fs.readFileSync(target, "utf8");
for (const line of fs.readFileSync(path.join(root, translationFile), "utf8").split(/\r?\n/).filter(line => ['  "Web search on":', '  "Web search off":', '  "Which company should I research?'].some(prefix => line.startsWith(prefix)))) {
  if (!translations.includes(line)) translations = translations.replace('export const zhCNAiHistory: Record<string, string> = {', 'export const zhCNAiHistory: Record<string, string> = {\n' + line);
}
fs.writeFileSync(target, translations); changed.push(translationFile, frontend, route, "lib/ai/workspace-assistant.ts");
fs.writeFileSync(path.join(source, "../intent-manifest.json"), JSON.stringify({ baseDeployment: "dpl_5djDt41vmUHRCujuQpBouLkKczre", productionCommit, files: [...new Set(changed)], scope: "Explicit public-research intent, visible search state, authorized cross-page company identity and read-only research report. Existing production UI and other CRM changes preserved." }, null, 2) + "\n");
console.log(JSON.stringify({ source, files: [...new Set(changed)] }));
