// CDP network recorder - plain Node, built-in WebSocket (Node >= 22)
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL_TO_OPEN = process.argv[2] || 'https://www.yangshipin.cn/tv/home';
const OUT = process.argv[3] || path.join(__dirname, '..', 'capture', 'net.json');
const SECONDS = parseInt(process.argv[4] || '30', 10);
const PROFILE = path.join(__dirname, '..', 'capture', 'chrome-profile');

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--window-size=1440,900',
    '--autoplay-policy=no-user-gesture-required',
    'about:blank'
  ];
  const chrome = spawn(CHROME, args, { stdio: 'ignore', detached: false });
  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const v = await getJSON('/json/version');
      if (v && v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; }
    } catch (e) { }
  }
  if (!wsUrl) { console.error('NO CDP'); chrome.kill(); process.exit(2); }
  console.log('CDP at', wsUrl);

  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const records = new Map();

  function send(method, params, sessionId) {
    return new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
    });
  }

  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
      return;
    }
    if (msg.method) {
      events.push(msg);
      if (msg.method === 'Network.requestWillBeSent') {
        const rq = msg.params.request;
        records.set(msg.params.requestId, {
          requestId: msg.params.requestId,
          url: rq.url, method: rq.method, headers: rq.headers,
          postData: rq.postData || null,
          type: msg.params.type,
          timestamp: msg.params.timestamp
        });
      } else if (msg.method === 'Network.responseReceived') {
        const r = records.get(msg.params.requestId) || { requestId: msg.params.requestId, url: msg.params.response.url };
        r.status = msg.params.response.status;
        r.mimeType = msg.params.response.mimeType;
        r.responseHeaders = msg.params.response.headers;
        r.type = r.type || msg.params.type;
        records.set(msg.params.requestId, r);
      } else if (msg.method === 'Network.loadingFinished') {
        const r = records.get(msg.params.requestId);
        if (r) r.encodedDataLength = msg.params.encodedDataLength;
      } else if (msg.method === 'Network.loadingFailed') {
        const r = records.get(msg.params.requestId);
        if (r) { r.failed = msg.params.errorText; r.blockedReason = msg.params.blockedReason; }
      }
    }
  });

  // attach to a new target
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = sessionId;

  await send('Network.enable', { maxResourceBufferSize: 200 * 1024 * 1024, maxTotalBufferSize: 400 * 1024 * 1024 }, S);
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);
  await send('Page.navigate', { url: URL_TO_OPEN }, S);

  await sleep(SECONDS * 1000);

  // collect response bodies for interesting XHR/fetch
  const BIN = path.join(path.dirname(OUT), 'bin');
  fs.mkdirSync(BIN, { recursive: true });
  const bodies = {};
  let bi = 0;
  for (const [rid, r] of records) {
    const interesting = ['XHR', 'Fetch', 'Document'].includes(r.type) &&
      /yangshipin|cctv|yspepg|oms/i.test(r.url) && r.status >= 200 && r.status < 400;
    if (!interesting) continue;
    if (r.mimeType && /image|video\/|font/i.test(r.mimeType)) continue;
    if (/\.ts(\?|$)/.test(r.url) || /\.m3u8/.test(r.url) || /\.wasm/.test(r.url)) continue;
    try {
      const b = await send('Network.getResponseBody', { requestId: rid }, S);
      const buf = b.base64Encoded ? Buffer.from(b.body, 'base64') : Buffer.from(b.body, 'utf8');
      const isText = /json|javascript|html|text|xml/i.test(r.mimeType || '');
      if (isText) {
        let text = buf.toString('utf8');
        bodies[rid] = text.length > 400000 ? text.slice(0, 400000) + '...[TRUNC]' : text;
      } else {
        const name = String(bi++).padStart(2, '0') + '_' + r.url.replace(/[^A-Za-z0-9]+/g, '_').slice(-60) + '.bin';
        fs.writeFileSync(path.join(BIN, name), buf);
        bodies[rid] = '<<BINARY file=' + name + ' bytes=' + buf.length + ' mime=' + r.mimeType + '>>';
      }
    } catch (e) { bodies[rid] = '<<ERR ' + e.message + '>>'; }
  }

  const out = {
    url: URL_TO_OPEN,
    capturedAt: new Date().toISOString(),
    requests: [...records.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
    bodies
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
  console.log('WROTE', OUT, 'requests:', out.requests.length, 'bodies:', Object.keys(bodies).length);

  try { ws.close(); } catch (e) { }
  await sleep(500);
  try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
