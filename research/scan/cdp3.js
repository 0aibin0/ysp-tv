// Verify: (1) deep link ?pid= loads correct channel, (2) m3u8 + encryption
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const OUTDIR = path.join(__dirname, '..', 'capture3');
const PROFILE = path.join(OUTDIR, 'chrome-profile');
const TARGET = 'https://www.yangshipin.cn/tv/home?pid=600002483'; // 东方卫视

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    else if (msg.method === 'Network.responseReceived') { const r = records.get(msg.params.requestId); if (r) { r.status = msg.params.response.status; r.mimeType = msg.params.response.mimeType; } }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Network.enable', { maxResourceBufferSize: 300 * 1024 * 1024, maxTotalBufferSize: 600 * 1024 * 1024 }, S);
  await send('Page.enable', {}, S); await send('Runtime.enable', {}, S);
  await send('Page.navigate', { url: TARGET }, S);
  await sleep(25000);
  async function ev(e) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }, S); return r.exceptionDetails ? { __error: r.exceptionDetails.exception && r.exceptionDetails.exception.description } : r.result.value; }
  const res = {};
  res.url = await ev('location.href');
  res.state = await ev(`(function(){var v=document.querySelector('#app').__vue__;var f=null;
    (function w(c,d){if(!c||f||d>25)return;if(c.tabA||c.tabB){f=c;return;}(c.$children||[]).forEach(function(x){w(x,d+1)});})(v,0);
    if(!f) return 'NO_TVA';
    return {routeQuery:f.$route.query,tvIndex:{channelName:f.tvIndex.channelName,pid:f.tvIndex.pid,streamId:f.tvIndex.streamId},nowPlayItem:f.nowPlayItem,tabACount:f.tabA.length,tabBCount:f.tabB.length,selectIndex:f.selectIndex};})()`);
  // find the m3u8 request and fetch its text
  let m3u8url = null;
  for (const r of records.values()) if (/\.m3u8/.test(r.url)) { m3u8url = r.url; break; }
  res.m3u8url = m3u8url;
  if (m3u8url) {
    const t = await ev(`fetch(${JSON.stringify(m3u8url)}).then(r=>r.text()).then(t=>t.slice(0,3000)).catch(e=>'ERR '+e)`);
    res.m3u8body = typeof t === 'string' ? t : JSON.stringify(t);
  }
  // try fetching a .ts and check encryption / size
  let tsurl = null;
  for (const r of records.values()) if (/\.ts(\?|$)/.test(r.url)) { tsurl = r.url; break; }
  res.tsurl = tsurl;
  if (tsurl) {
    const t = await ev(`fetch(${JSON.stringify(tsurl)}).then(r=>r.arrayBuffer()).then(b=>{var u=new Uint8Array(b);return {bytes:u.length, head:Array.from(u.slice(0,16)).map(x=>x.toString(16).padStart(2,'0')).join(' ')};}).catch(e=>'ERR '+e)`);
    res.tsinfo = t;
  }
  // does the page set any DRM?
  res.drm = await ev(`(function(){var v=document.querySelector('video'); if(!v) return 'NO_VIDEO'; return {src:(v.src||'').slice(0,40), hasEME: typeof navigator.requestMediaKeySystemAccess, videoKeys: v.mediaKeys? 'HAS_MEDIAKEYS':'none', currentSrc:(v.currentSrc||'').slice(0,60)};})()`);
  fs.writeFileSync(path.join(OUTDIR, 'verify.json'), JSON.stringify(res, null, 1), 'utf8');
  console.log(JSON.stringify(res, null, 1).slice(0, 6000));
  try { ws.close(); } catch (e) { }
  await sleep(400); try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
