// Rebuild local assets from the pinned, independently licensed VvvebJs editor.
// Usage: node scripts/vendor-vvveb.mjs <path-to-VvvebJs-checkout>
import { cpSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const source = resolve(process.argv[2] || "tmp/vvvebjs-upstream");
const commit = "1acbab7ebfe3e7b004f1f18c039d26550fc04bd8";
if (execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== commit) throw new Error("Use the pinned VvvebJs commit: " + commit);
const target = resolve("public/vendor/vvveb");
mkdirSync(target, { recursive: true });
for (const path of ["css", "fonts", "img", "libs/builder", "libs/autocomplete", "LICENSE", "Credits.md", "js/bootstrap.min.js", "js/popper.min.js"]) cpSync(join(source, path), join(target, path), { recursive: true });
let html = readFileSync(join(source, "editor.html"), "utf8");
html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b(?![^>]*type="text\/html")[^>]*>[\s\S]*?<\/script>/gi, "");
html = html.replace(/<link[^>]*>/g, tag => tag.includes('css/editor.css') ? tag : "");
html = html.replace(/<title>.*?<\/title>/, "<title>Filazoo website designer</title>");
html = html.replace(/<base[^>]*>/, "");
html = html.replace(/<iframe\b/, '<iframe sandbox="allow-same-origin"');
html = html.replace("</head>", '<link rel="stylesheet" href="filazoo.css"></head>');
const scripts = ["js/popper.min.js", "js/bootstrap.min.js", "libs/builder/builder.js", "libs/builder/undo.js", "libs/builder/inputs.js", "libs/autocomplete/autocomplete.js", "libs/builder/components-common.js", "libs/builder/components-html.js", "filazoo.js"];
html = html.replace("</body>", scripts.map(src => `<script src="${src}"></script>`).join("\n") + "</body>");
writeFileSync(join(target, "editor.html"), html);
writeFileSync(join(target, "UPSTREAM.txt"), `VvvebJs — https://github.com/givanz/VvvebJs\nCommit: ${commit}\nApache-2.0 (see LICENSE); bundled dependencies retain their notices.\nFilazoo changes: selected assets, portal-specific initialization, curated blocks, sandboxed canvas, branded styles and parent message bridge.\nRebuild: node scripts/vendor-vvveb.mjs <checkout>\n`);
