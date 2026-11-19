import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translateUiText } from "../lib/i18n.ts";

// Brands, protocol names, shortcut keys, and example identifiers remain verbatim.
const unchanged = new Set(["English", "Filazoo", "Meta", "Facebook", "Instagram", "WhatsApp", "Google Workspace", "Microsoft 365", "SMTP / IMAP", "SMTP", "IMAP", "PDF", "CSV", "SKU", "KB", "USD", "EUR", "GBP", "CNY", "Ctrl K", "esc", "Authorization", "Bearer YOUR_CONNECTION_SECRET", "raul@filazoo.com", "© 2026 Filazoo"]);
const copyAttributes = new Set(["aria-label", "aria-description", "aria-valuetext", "placeholder", "data-placeholder", "title", "alt", "label", "description", "emptyText"]);
for (const value of ["Apple", "Google", "Filazoo AI", "NetEase Lingxi Office", "PLA", "PLA-CUSTOM", "1–10 MB", "portal.yourbrand.com"]) unchanged.add(value);

function literalCopy(expression: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isConditionalExpression(expression)) return [...literalCopy(expression.whenTrue), ...literalCopy(expression.whenFalse)];
  if (ts.isParenthesizedExpression(expression)) return literalCopy(expression.expression);
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(expression.operatorToken.kind)) return literalCopy(expression.right);
  if (ts.isCallExpression(expression) && expression.expression.getText() === "t" && expression.arguments[0]) return literalCopy(expression.arguments[0]);
  return [];
}

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
    function check(value: string) {
      const text = value.replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
      // Example addresses, protocol values and product identifiers are data.
      const example = /^(?:https?:\/\/|[^\s@]+@[^\s@]+$|(?:smtp|imap)\.[\w.]+$|UTC[+\d]+$)/.test(text) || text.startsWith('{ "');
      if (/[A-Za-z]{2}/.test(text) && !/[\u3400-\u9fff]/.test(text) && !example && !unchanged.has(text) && translateUiText(text, "zh-CN") === text) missing.add(text);
    }
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((prop) => ts.isJsxAttribute(prop) && (prop.name.getText(source) === "data-no-translate" || (prop.name.getText(source) === "translate" && prop.initializer?.getText(source) === '"no"')))) return;
      if (ts.isJsxElement(node) && ["code", "pre", "script", "style"].includes(node.openingElement.tagName.getText(source))) return;
      if (ts.isJsxText(node)) {
        check(node.text);
      }
      if (ts.isJsxAttribute(node) && copyAttributes.has(node.name.getText(source)) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) check(node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) literalCopy(node.initializer.expression).forEach(check);
      }
      if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && node.expression) literalCopy(node.expression).forEach(check);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.equal(missing.size, 0, `Add professional Chinese copy for screen text; keep business data outside UI translation.\n${JSON.stringify([...missing].sort(), null, 2)}`);
});
