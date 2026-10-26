import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translateUiText } from "../lib/i18n.ts";

// Brands, protocol names, shortcut keys, and example identifiers remain verbatim.
const unchanged = new Set(["English", "Filazoo", "Meta", "Facebook", "Instagram", "WhatsApp", "Google Workspace", "Microsoft 365", "SMTP / IMAP", "SMTP", "IMAP", "PDF", "CSV", "SKU", "KB", "USD", "EUR", "GBP", "CNY", "Ctrl K", "esc", "Authorization", "Bearer YOUR_CONNECTION_SECRET", "raul@filazoo.com", "© 2026 Filazoo"]);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : file.endsWith(".tsx") ? [file] : [];
  });
}

test("static screen copy has Chinese coverage across all app pages and components", () => {
  const missing = new Set<string>();
  for (const file of [...files("app"), ...files("components")]) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && (prop.name.getText(source) === "data-no-translate" || (prop.name.getText(source) === "translate" && prop.initializer?.getText(source) === '"no"')))) return;
      if (ts.isJsxElement(node) && ["code", "pre", "script", "style"].includes(node.openingElement.tagName.getText(source))) return;
      if (ts.isJsxText(node)) {
        const text = node.text.replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
        if (/[A-Za-z]{2}/.test(text) && !/[\u3400-\u9fff]/.test(text) && !unchanged.has(text) && translateUiText(text, "zh-CN") === text) missing.add(`${file}: ${text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual([...missing].sort(), [], "Add professional Chinese copy for new screen text; keep business data outside UI translation.");
});
