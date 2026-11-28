const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['scripts/audit-client-bundles.mjs'], { encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
fs.writeFileSync('.cache/session-performance-after.json', result.stdout);
const baseline = fs.readFileSync('.cache/session-performance-before.json');
const before = JSON.parse(baseline.toString(baseline[0] === 0xff ? 'utf16le' : 'utf8').replace(/^\uFEFF/, ''));
const after = JSON.parse(result.stdout);
const normalize = route => route.replaceAll('\\', '/');
for (const route of ['/products', '/workflow/analytics', '/companies']) {
  const a = before.results.find(row => normalize(row.route) === route), b = after.results.find(row => normalize(row.route) === route);
  console.log(JSON.stringify({route,before:a?.gzipBytes,after:b?.gzipBytes,reduction:a && b ? (100*(a.gzipBytes-b.gzipBytes)/a.gzipBytes).toFixed(1)+'%' : null}));
}
for (const entry of after.clientEntries) {
  const old = before.clientEntries.find(row => row.module === entry.module);
  console.log(JSON.stringify({module:entry.module,before:old.gzipBytes,after:entry.gzipBytes,pass:entry.pass}));
}
console.log(JSON.stringify({failingShells:after.results.filter(row=>!row.pass).map(row=>({route:row.route,gzipBytes:row.gzipBytes})),failingEntries:after.clientEntries.filter(row=>!row.pass).map(row=>row.module)}));
