// Does the short form /tv?pid=... also select the channel? (router redirects /tv -> /tv/home)
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9340;
const OUTDIR = path.join(__dirname, '..', 'capture7');
const PROFILE = path.join(OUTDIR, 'chrome-profile');
function getJSON(p) { return new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true }); fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1400,900',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 60; i++) { await sleep(500); try { const v = await getJSON('/json/version'); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) { } }
  if (!wsUrl) { console.error('NO CDP'); chrome.kill(); process.exit(2); }
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  function send(m, p, s) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p || {}, sessionId: s })); }); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); } });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, S); await send('Runtime.enable', {}, S);
  const results = {};
  for (const [label, url] of [['short /tv?pid', 'https://www.yangshipin.cn/tv?pid=600002475'], ['long /tv/home?pid', 'https://www.yangshipin.cn/tv/home?pid=600002475']]) {
    await send('Page.navigate', { url }, S);
    await sleep(16000);
    const r = await send('Runtime.evaluate', { expression: `(function(){var v=document.querySelector('#app')&&document.querySelector('#app').__vue__;if(!v)return 'NO_VUE';var f=null;(function w(c,d){if(!c||f||d>25)return;if(c.tabA||c.tabB){f=c;return;}(c.$children||[]).forEach(function(x){w(x,d+1)});})(v,0);if(!f)return 'NO_TVA';return {href:location.href,routePath:f.$route.path,routeQuery:f.$route.query,channel:f.tvIndex.channelName,pid:f.tvIndex.pid,now:f.nowPlayItem,selectIndex:f.selectIndex};})()`, returnByValue: true }, S);
    results[label] = r.result.value;
    console.log(label, '->', JSON.stringify(r.result.value));
  }
  fs.writeFileSync(path.join(OUTDIR, 'urlforms.json'), JSON.stringify(results, null, 1), 'utf8');
  try { ws.close(); } catch (e) { }
  await sleep(400); try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
