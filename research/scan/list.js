const fs = require('fs');
const f = process.argv[2];
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log('captured:', d.url, d.capturedAt);
console.log('--- API-ish requests (XHR/Fetch) ---');
for (const r of d.requests) {
  if (!['XHR', 'Fetch'].includes(r.type)) continue;
  console.log([r.status, r.method, r.type, r.url].join(' | ') + (r.failed ? '  FAILED:' + r.failed : ''));
}
console.log('\n--- media / m3u8 / ts ---');
for (const r of d.requests) {
  if (/\.m3u8|\.ts\b|\.mp4|blob:/i.test(r.url)) console.log([r.status, r.type, r.url].join(' | '));
}
