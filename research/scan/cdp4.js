// Capture the m3u8 body via CDP and test whether the CDN URL works from plain Node http
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const OUTDIR = path.join(__dirname, '..', 'capture4');
const PROFILE = path.join(OUTDIR, 'chrome-profile');
const TARGET = 'https://www.yangshipin.cn/tv/home?pid=600001859';

function getJSON(p) {
  return new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function plainGet(url, headers) {
  return new Promise(res => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: headers || {} }, r => {
      let d = []; r.on('data', c => d.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(d) }));
    });
    req.on('error', e => res({ error: e.message }));
    req.setTimeout(20000, () => { req.destroy(); res({ error: 'timeout' }); });
    req.end();
  });
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true }); fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1600,1000',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60; i++) { await sleep(500); try { const v = await getJSON('/json/version'); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) { } }
  if (!wsUrl) { console.error('NO CDP'); chrome.kill(); process.exit(2); }
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map(); const records = new Map();
  function send(m, p, s) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); }); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); return; }
    if (msg.method === 'Network.requestWillBeSent') records.set(msg.params.requestId, { requestId: msg.params.requestId, url: msg.params.request.url, method: msg.params.request.method, type: msg.params.type });
    else if (msg.method === 'Network.responseReceived') { const r = records.get(msg.params.requestId); if (r) { r.status = msg.params.response.status; r.mimeType = msg.params.response.mimeType; r.responseHeaders = msg.params.response.headers; } }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Network.enable', { maxResourceBufferSize: 300 * 1024 * 1024, maxTotalBufferSize: 600 * 1024 * 1024 }, S);
  await send('Page.enable', {}, S); await send('Runtime.enable', {}, S);
  await send('Page.navigate', { url: TARGET }, S);
  await sleep(25000);

  const res = {};
  // get the m3u8 response body that the player itself fetched
  for (const [rid, r] of records) {
    if (/\.m3u8/.test(r.url)) {
      try {
        const b = await send('Network.getResponseBody', { requestId: rid }, S);
        const buf = b.base64Encoded ? Buffer.from(b.body, 'base64') : Buffer.from(b.body, 'utf8');
        res.m3u8 = { url: r.url, status: r.status, mime: r.mimeType, headers: r.responseHeaders, body: buf.toString('utf8').slice(0, 4000) };
      } catch (e) { res.m3u8 = { url: r.url, err: e.message }; }
      break;
    }
  }
  fs.writeFileSync(path.join(OUTDIR, 'm3u8.json'), JSON.stringify(res, null, 1), 'utf8');
  console.log('=== m3u8 captured from player ===');
  console.log('url:', res.m3u8 && res.m3u8.url);
  console.log('status:', res.m3u8 && res.m3u8.status, 'mime:', res.m3u8 && res.m3u8.mime);
  console.log('resp headers:', JSON.stringify(res.m3u8 && res.m3u8.headers));
  console.log('--- body ---');
  console.log(res.m3u8 && res.m3u8.body);

  // Now replay the SAME m3u8 URL from plain Node http (no browser) to test hotlink protection
  if (res.m3u8 && res.m3u8.url) {
    console.log('\n=== replay from plain Node https, NO headers ===');
    const p1 = await plainGet(res.m3u8.url);
    console.log('status:', p1.status, 'err:', p1.error || '-', 'bytes:', p1.body ? p1.body.length : 0);
    console.log((p1.body ? p1.body.toString('utf8').slice(0, 800) : ''));

    console.log('\n=== replay from plain Node https, WITH Referer+Origin+UA ===');
    const p2 = await plainGet(res.m3u8.url, {
      'Referer': 'https://www.yangshipin.cn/', 'Origin': 'https://www.yangshipin.cn',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });
    console.log('status:', p2.status, 'err:', p2.error || '-', 'bytes:', p2.body ? p2.body.length : 0);
    console.log((p2.body ? p2.body.toString('utf8').slice(0, 800) : ''));
    fs.writeFileSync(path.join(OUTDIR, 'plain-replay.json'), JSON.stringify({ noHdr: { status: p1.status, err: p1.error, body: p1.body ? p1.body.toString('utf8').slice(0, 3000) : null }, withHdr: { status: p2.status, err: p2.error, body: p2.body ? p2.body.toString('utf8').slice(0, 3000) : null } }, null, 1), 'utf8');
  }
  try { ws.close(); } catch (e) { }
  await sleep(400); try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
