const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const files = fs.readdirSync('tests').filter(file => /^(product.*|flow-analytics.*|document.*|email-accounts.*|email-inbox.*|email-page.*|session-recovery-refresh|background-refresh|page-cache|workspace-memory|workspace-navigation.*)\.test\.ts$/.test(file)).map(file => 'tests/' + file);
console.log(`Checking ${files.length} test files`);
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', '--test-concurrency=2', ...files], { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
fs.writeFileSync('.cache/session-feature-tests.log', result.stdout + result.stderr);
console.log(result.stdout.split('\n').slice(-17).join('\n'));
if (result.status) console.log(result.stdout.split('\n').filter(line => line.startsWith('✖') || line.includes('Error:')).join('\n'));
process.exitCode = result.status ?? 1;
