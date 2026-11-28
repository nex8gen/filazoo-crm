const fs = require('node:fs');
for (const p of ['tests/flow-analytics.test.ts']) {
  console.log(p);
  if (fs.existsSync(p)) console.log(fs.readFileSync(p, 'utf8').split('\n').slice(105, 195).join('\n'));
}
