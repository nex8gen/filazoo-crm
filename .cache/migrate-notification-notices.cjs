const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const directories = ['components', 'app'];
const exclude = new Set(['components/workspace-error-boundary.tsx', 'app/purchase-orders/error.tsx']);
const files = directories.flatMap(directory => fs.readdirSync(directory, { recursive: true }).filter(name => name.endsWith('.tsx')).map(name => path.join(directory, name).replaceAll('\\', '/')));
const manifest = [];
for (const file of files) {
  if (exclude.has(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const entries = [];
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const role = opening.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(tree) === 'role');
      const value = role?.initializer && ts.isStringLiteral(role.initializer) ? role.initializer.text : '';
      const childrenText = node.children.map(child => child.getText(tree)).join(' ');
      const isStateNotice = value === 'status' && /^(?:\s|\{\s*)*(?:error|notice|success|messageError|voiceError|research\.warning|state\??\.success)\b/.test(childrenText);
      if (value === 'alert' || isStateNotice) {
        const original = node.getText(tree);
        const tone = isStateNotice ? /warning/.test(childrenText) ? 'warning' : /[Ee]rror/.test(childrenText) ? 'error' : /success/.test(childrenText) ? 'success' : 'message' : /(?:bg|text|border)-amber/.test(opening.getText(tree)) ? 'warning' : 'error';
        const attributes = opening.attributes.properties.filter(property => !ts.isJsxAttribute(property) || !['role', 'className', 'style'].includes(property.name.getText(tree))).map(property => property.getText(tree));
        const newOpening = `<NotificationToast${tone === 'error' ? '' : ` tone="${tone}"`}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`;
        const children = source.slice(opening.end, node.closingElement.getStart(tree));
        edits.push({ start: node.getStart(tree), end: node.end, text: newOpening + children + '</NotificationToast>' });
        entries.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, tone, text: original.slice(0, 150) });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!edits.length) continue;
  const directive = tree.statements.find(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use client');
  const importAt = directive ? directive.end : 0;
  edits.push({ start: importAt, end: importAt, text: `${importAt ? '\n' : ''}import { NotificationToast } from "@/components/ui/notification-toast";\n` });
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  fs.writeFileSync(file, result);
  manifest.push({ file, entries });
}
fs.writeFileSync('.cache/notification-migration.json', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ files: manifest.length, notices: manifest.reduce((count, file) => count + file.entries.length, 0), perFile: manifest.map(file => [file.file, file.entries.length]) }, null, 2));
