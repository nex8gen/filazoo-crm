const fs = require('node:fs');
const ts = require('typescript');
const files = fs.readdirSync('tests').filter(file => file.endsWith('.test.ts'));
const changed = [];
for (const file of files) {
  if (['notifications.test.ts', 'campaign-reload.test.ts'].includes(file)) continue;
  const name = `tests/${file}`, source = fs.readFileSync(name, 'utf8');
  if (!source.includes('JsxEmit.ReactJSX') || !source.includes('vm.runInNewContext')) continue;
  const tree = ts.createSourceFile(name, source, 99, true, ts.ScriptKind.TS), edits = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'require') {
      const current = node.initializer.getText(tree);
      edits.push({ start: node.initializer.getStart(tree), end: node.initializer.end, text: `(name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : (${current})(name)` });
      return;
    }
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'require') {
      edits.push({ start: node.getStart(tree), end: node.end, text: 'require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : require(name)' });
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!edits.length) continue;
  const importAt = tree.statements.filter(ts.isImportDeclaration).at(-1).end;
  edits.push({ start: importAt, end: importAt, text: '\nimport { notificationToastModule } from "./helpers/notification-toast.ts";' });
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  fs.writeFileSync(name, result); changed.push(name);
}
console.log(`Updated ${changed.length} component fixture loaders.`);
