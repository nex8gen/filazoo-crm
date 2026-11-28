import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

const origin = process.argv[2] || "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)) throw new Error("Export only from a local development server with synthetic fixtures.");
const output = path.resolve("public/marketing/crm-demo");
await mkdir(path.join(output, "assets"), { recursive: true });
const assets = new Map();
async function download(url, css = false) {
  const absolute = new URL(url, origin);
  if (absolute.origin !== new URL(origin).origin) throw new Error("Demo exports cannot load external assets.");
  if (assets.has(absolute.href)) return assets.get(absolute.href);
  const extension = css ? ".css" : path.extname(absolute.pathname);
  if (!/\.(css|woff2?|ttf|otf|png|svg)$/.test(extension)) throw new Error(`Unexpected asset: ${absolute.pathname}`);
  const filename = createHash("sha256").update(absolute.href).digest("hex").slice(0, 18) + extension;
  const href = `/marketing/crm-demo/assets/${filename}`;
  assets.set(absolute.href, href);
  const response = await fetch(absolute);
  if (!response.ok) throw new Error(`Unable to export ${absolute.pathname}: ${response.status}`);
  let content = Buffer.from(await response.arrayBuffer());
  if (css) {
    let text = content.toString("utf8");
    for (const match of [...text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)]) {
      if (match[1].startsWith("data:") || match[1].startsWith("#")) continue;
      const exported = await download(new URL(match[1], absolute).href);
      text = text.split(match[0]).join(`url("${exported}")`);
    }
    text = text.replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, "");
    content = Buffer.from(text);
  }
  await writeFile(path.join(output, "assets", filename), content);
  return href;
}

for (const view of ["home", "email", "workflow", "orders"]) {
  const response = await fetch(`${origin}/marketing/demo-source?view=${view}`);
  if (!response.ok) throw new Error(`Demo source ${view} returned ${response.status}`);
  const source = new JSDOM(await response.text()).window.document;
  // Next dev emits route-component CSS as style preloads; include those too.
  const resourceLinks = [...source.querySelectorAll("link[href]")].map(link => link.getAttribute("href")).filter(href => /\.css(?:\?|$)/.test(href));
  // Resolve streamed React boundaries structurally; never execute the page scripts.
  for (const segment of [...source.querySelectorAll('[id^="S:"]')]) {
    const placeholder = source.getElementById(`B:${segment.id.slice(2)}`);
    if (!placeholder) continue;
    let next = placeholder.nextSibling;
    while (next && !(next.nodeType === 8 && next.data === "/$")) {
      const remove = next;
      next = next.nextSibling;
      remove.remove();
    }
    placeholder.replaceWith(...segment.childNodes);
    segment.remove();
  }
  const root = source.getElementById("marketing-crm-demo");
  if (!root) throw new Error(`Missing production CRM markup for ${view}`);
  // The live canvas reveals and fits its nodes after ResizeObserver runs.
  // Resolve that initial measurement state for the fixed 1280px static export.
  if (view === "workflow") {
    const layer = root.querySelector(".wf-canvas > div[style*='visibility']");
    if (!layer || !layer.querySelector("[data-flow-node-id]")) throw new Error("Missing workflow nodes.");
    layer.style.visibility = "visible";
    layer.style.transform = "translate(260px, 8px) scale(0.85)";
  }
  // Production page actions hydrate into these header hosts. Preserve their
  // actual rendered controls in the same location in the script-free export.
  const header = root.querySelector(".workspace-page-header");
  const commands = root.querySelector("[data-page-actions]");
  if (header && commands) header.lastElementChild.append(commands);
  for (const element of root.querySelectorAll("script,template,link[rel=preload]")) element.remove();
  for (const element of root.querySelectorAll("a,form,input,textarea,button")) {
    for (const attr of ["href", "action", "formaction", "target", "srcdoc"]) element.removeAttribute(attr);
    if (element.tagName === "BUTTON") element.setAttribute("type", "button");
    if (["INPUT", "TEXTAREA"].includes(element.tagName)) element.setAttribute("readonly", "");
  }
  // The demo account displays a fixture balance using the shared credit formatter.
  const { formatCredits, MICROS_PER_CREDIT } = await import("../lib/billing/credits.ts");
  const creditSection = root.querySelector(".workspace-ai-usage-link");
  const loading = creditSection?.querySelector('[role="status"]');
  if (loading) {
    const balance = source.createElement("span");
    balance.className = "mt-3 flex items-baseline gap-1.5";
    const amount = source.createElement("strong");
    amount.className = "text-xl font-semibold leading-none tracking-tight tabular-nums";
    amount.textContent = formatCredits(6000 * MICROS_PER_CREDIT);
    balance.append(amount, " credits");
    loading.replaceWith(balance);
  }
  const stylesheets = [];
  for (const href of [...new Set(resourceLinks)]) stylesheets.push(await download(href, true));
  const markup = `<!doctype html><html lang="en" class="${source.documentElement.className} light"><head><meta charset="utf-8"><meta name="viewport" content="width=1280,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>NewAI CRM ${view} - sample data</title>${stylesheets.map(href => `<link rel="stylesheet" href="${href}">`).join("")}<style>html,body{margin:0;height:100%;overflow:hidden}#marketing-crm-demo{pointer-events:none}*,*::before,*::after{animation:none!important;transition:none!important}</style></head><body>${root.outerHTML}</body></html>`;
  if (/<script[\s>]/i.test(markup) || /https?:\/\//i.test(root.outerHTML.replaceAll('http://www.w3.org/2000/svg', ''))) {
    // External URLs in harmless text are fine, but executable/remote resource
    // attributes must never survive the export.
    if (/<script[\s>]|(?:src|action|href)=["']https?:/i.test(markup)) throw new Error("Unsafe demo export.");
  }
  await writeFile(path.join(output, `${view}.html`), markup);
  console.log(`Exported ${view}: production component markup, fixture data, ${stylesheets.length} stylesheets.`);
}
console.log(`Exported ${assets.size} local assets. No app scripts or API connections are included.`);
