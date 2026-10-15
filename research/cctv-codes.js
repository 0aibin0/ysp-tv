// Discover tv.cctv.com live channel URL codes for the fallback source.
const https = require('https');
const fs = require('fs');

function get(url) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: 'https://tv.cctv.com/',
      },
    }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return get(new URL(r.headers.location, url).href).then(res, rej);
      }
      const c = [];
      r.on('data', (d) => c.push(d));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(c).toString('utf8') }));
    }).on('error', rej);
  });
}

(async () => {
  const out = {};

  // The live index page links every channel
  const idx = await get('https://tv.cctv.com/live/');
  const links = [...idx.body.matchAll(/href="([^"]*\/live\/[^"\/]+\/?)"/g)].map((m) => m[1]);
  const uniq = [...new Set(links)];
  console.log('links found on /live/ :', uniq.length);
  console.log(uniq.slice(0, 80).join('\n'));

  // Also pull the channel-name -> code mapping from the page text if present
  const codes = [...idx.body.matchAll(/\/live\/([a-z0-9_]+)\/?"[^>]*>([^<]{2,20})</g)];
  console.log('\nname->code pairs found:', codes.length);
  codes.slice(0, 80).forEach((m) => console.log(`  ${m[2].trim()}  =>  ${m[1]}`));

  fs.writeFileSync('D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research\\cctv-live-links.json',
    JSON.stringify({ links: uniq, pairs: codes.map((m) => ({ name: m[2].trim(), code: m[1] })) }, null, 2), 'utf8');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
