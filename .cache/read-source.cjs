const fs = require('node:fs');
const [file, from = 1, to = 2000] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split('\n');
console.log(lines.slice(Number(from) - 1, Number(to)).map((line, index) => `${Number(from) + index}: ${line}`).join('\n'));
