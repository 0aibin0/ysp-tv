// Is the site's per-channel play-info / playlist cacheable enough to prewarm?
// If a second request for the same pid is much faster, we can prefetch.
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function timed(url, headers) {
  return new Promise((res) => {
    const t0 = Date.now();
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': UA, Referer: 'https://www.yangshipin.cn/' }, headers || {}) }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ url, status: r.statusCode, ms: Date.now() - t0, len: Buffer.concat(chunks).length, ctype: r.headers['content-type'] }));
    });
    req.on('error', (e) => res({ url, error: String(e.message), ms: Date.now() - t0 }));
    req.setTimeout(15000, () => { req.destroy(); res({ url, error: 'timeout', ms: Date.now() - t0 }); });
  });
}

(async () => {
  const pid = '600001800'; // CCTV-2
  const urls = [
    `https://capi.yangshipin.cn/api/yspepg/program/${pid}/20261013`,
    `https://csapi.yangshipin.cn/voapi/omsot/live/playinfo?pid=${pid}`,
    `https://capi.yangshipin.cn/api/oms/pc/page/PG00000004`,
  ];

  for (const u of urls) {
    console.log('\n=== ' + u + ' ===');
    for (let i = 1; i <= 3; i++) {
      const r = await timed(u);
      console.log(`  attempt ${i}: ${r.status || r.error} ${r.ms}ms len=${r.len || 0} ${r.ctype || ''}`);
    }
  }

  // Cross-check: is a *different* pid slower than a warm one?
  console.log('\n=== different pids, first touch each ===');
  const pids = ['600001801', '600001814', '600001818', '600001800'];
  for (const p of pids) {
    const r = await timed(`https://capi.yangshipin.cn/api/yspepg/program/${p}/20261013`);
    console.log(`  pid ${p}: ${r.status} ${r.ms}ms len=${r.len}`);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
