const fs = require('node:fs');
const ts = require('typescript');
const selections = {
  'components/ai-leads-workspace.tsx': { notice: 'success' },
  'components/document-preview.tsx': { 'currentPreview?.error': 'error', relatedError: 'error' },
  'components/email-ai-summary.tsx': { 'error && !summary': 'error', saveError: 'error' },
  'components/email-inbox.tsx': { aiWritingError: 'warning', notice: 'message' },
  'components/flow-builder.tsx': { '!canEdit': 'warning', 'errors.triggerConfig': 'error', 'errors[`step-${selectedIndex}`]': 'error' },
  'components/messenger-inbox.tsx': { notice: 'message', '!data.connection.configured || data.dataError': 'warning' },
  'components/purchase-order-summary.tsx': { activityError: 'warning' },
  'components/ui/customer-research.tsx': { 'research.warning': 'warning' },
  'app/login/login-form.tsx': { 'message && !state?.error': 'success' },
  'app/settings/erp-connection-form.tsx': { notice: 'message' },
};
const manifest = JSON.parse(fs.readFileSync('.cache/notification-migration.json', 'utf8'));
let count = 0;
for (const [file, conditions] of Object.entries(selections)) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, 99, true, ts.ScriptKind.TSX);
  const edits = [];
  function visit(node) {
    if (ts.isConditionalExpression(node) && ts.isJsxElement(node.whenTrue)) {
      const condition = node.condition.getText(tree), element = node.whenTrue;
      if (condition in conditions && ['div', 'p', 'span'].includes(element.openingElement.tagName.getText(tree))) {
        const attributes = element.openingElement.attributes.properties.filter(property => !ts.isJsxAttribute(property) || !['role', 'className', 'style'].includes(property.name.getText(tree))).map(property => property.getText(tree));
        const tone = file === 'app/settings/erp-connection-form.tsx' ? 'tone={notice.error ? "error" : "success"}' : `tone="${conditions[condition]}"`;
        edits.push({ start: element.getStart(tree), end: element.end, text: `<NotificationToast ${tone}${attributes.length ? ` ${attributes.join(' ')}` : ''}>${source.slice(element.openingElement.end, element.closingElement.getStart(tree))}</NotificationToast>` });
        count++;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!edits.length) continue;
  if (!source.includes('import { NotificationToast }')) {
    const directive = tree.statements.find(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use client');
    const start = directive?.end ?? 0;
    edits.push({ start, end: start, text: `${start ? '\n' : ''}import { NotificationToast } from "@/components/ui/notification-toast";\n` });
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  fs.writeFileSync(file, result);
  if (!manifest.some(entry => entry.file === file)) manifest.push({ file, entries: [] });
}
fs.writeFileSync('.cache/notification-migration.json', JSON.stringify(manifest, null, 2));
console.log(`Migrated ${count} additional warning and message notices.`);
