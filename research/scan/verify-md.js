const fs = require('fs');
process.chdir('D:/Desktop/deepseek-dsh/yangshipin-tv/research');
const md = fs.readFileSync('FINDINGS.md', 'utf8');
const fence = '```';
const start = md.indexOf('### The 48 entries');
if (start < 0) { console.log('NO SECTION'); process.exit(1); }
const jStart = md.indexOf('json\n', start) + 5;
const jEnd = md.indexOf('\n' + fence, jStart);
const parsed = JSON.parse(md.slice(jStart, jEnd));
const real = JSON.parse(fs.readFileSync('channels-48.json', 'utf8'));
console.log('md block entries:', parsed.length, '| file entries:', real.length);
const norm = a => a.map(x => [x.no, x.name, x.pid, x.streamId, x.channelType, x.url].join('|'));
const A = norm(parsed), B = norm(real);
const diffs = A.map((x, i) => x === B[i] ? null : { i, md: x, file: B[i] }).filter(Boolean);
console.log('row diffs:', diffs.length);
diffs.slice(0, 8).forEach(d => console.log('  ', JSON.stringify(d)));
console.log('EXACT MATCH:', diffs.length === 0 && A.length === B.length);
