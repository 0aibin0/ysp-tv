// Fetch a live .ts segment from plain Node and inspect whether it is a raw MPEG-TS or custom-encrypted
const https = require('https');
const fs = require('fs');
const path = require('path');

function get(url, headers) {
  return new Promise(res => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: headers || {} }, r => {
      const chunks = []; r.on('data', c => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', e => res({ error: e.message }));
    req.setTimeout(25000, () => { req.destroy(); res({ error: 'timeout' }); });
    req.end();
  });
}

(async () => {
  const m3u8url = process.argv[2];
  const r1 = await get(m3u8url);
  const text = r1.body.toString('utf8');
  console.log('m3u8 status', r1.status, 'bytes', r1.body.length);
  const hasKey = /#EXT-X-KEY/i.test(text);
  const hasSessionKey = /#EXT-X-SESSION-KEY/i.test(text);
  console.log('has EXT-X-KEY:', hasKey, '| has EXT-X-SESSION-KEY:', hasSessionKey);
  const base = m3u8url.split('?')[0];
  const q = m3u8url.split('?')[1];
  const seg = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if (!seg.length) { console.log('no segments found'); return; }
  const segUrl = base.replace(/[^/]*$/, '') + seg[1];
  console.log('\nsegment URL:', segUrl.slice(0, 200));
  const r2 = await get(segUrl);
  console.log('ts status', r2.status, 'bytes', r2.body ? r2.body.length : 0, 'ctype', r2.headers && r2.headers['content-type']);
  console.log('CORS:', r2.headers && r2.headers['access-control-allow-origin']);
  if (r2.body && r2.body.length) {
    const head = r2.body.subarray(0, 32);
    console.log('first 32 bytes hex:', head.toString('hex').match(/../g).join(' '));
    console.log('first byte 0x47 (MPEG-TS sync)?', head[0] === 0x47);
    // count 0x47 sync bytes at 188-byte intervals
    let sync = 0; for (let i = 0; i + 188 <= r2.body.length; i += 188) if (r2.body[i] === 0x47) sync++;
    console.log('188-byte sync hits:', sync, 'of', Math.floor(r2.body.length / 188));
    console.log('printable head:', head.toString('latin1').replace(/[^\x20-\x7e]/g, '.'));
    fs.writeFileSync(path.join(__dirname, '..', 'capture4', 'seg.ts'), r2.body);
  }
  console.log('\nfull m3u8:\n' + text);
})();
