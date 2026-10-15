// Determine whether player-api signatures are reproducible outside the browser.
// Strategy: in the browser, (a) call cctvh5-openapi.getSignature on a CHOSEN input,
// (b) monkey-patch XHR to capture exactly what the player sends, (c) try to recover the md5 secrets.
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const OUTDIR = path.join(__dirname, '..', 'capture5');
const PROFILE = path.join(OUTDIR, 'chrome-profile');
const TARGET = 'https://www.yangshipin.cn/tv/home?pid=600001859';

function getJSON(p) { return new Promise((res, rej) => { http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true }); fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE, '--window-size=1600,1000',
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

  // Install an XHR/fetch interceptor BEFORE any app code runs
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__CAP = [];
      (function(){
        var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.open = function(m,u){ this.__m=m; this.__u=u; this.__h={}; return oOpen.apply(this, arguments); };
        XMLHttpRequest.prototype.setRequestHeader = function(k,v){ try{this.__h[k]=v;}catch(e){}; return oSet.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function(b){ try{ window.__CAP.push({m:this.__m,u:this.__u,h:this.__h,b:(typeof b==='string'?b:Object.prototype.toString.call(b))}); }catch(e){}; return oSend.apply(this, arguments); };
      })();
    `
  }, S);

  await send('Page.navigate', { url: TARGET }, S);
  await sleep(20000);

  async function ev(expr, awaitPromise) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise }, S);
    return r.exceptionDetails ? { __error: r.exceptionDetails.exception && r.exceptionDetails.exception.description } : r.result.value;
  }

  const out = {};
  out.captured = await ev('window.__CAP');
  fs.writeFileSync(path.join(OUTDIR, 'xhr-cap.json'), JSON.stringify(out.captured, null, 1), 'utf8');
  console.log('captured XHR count:', (out.captured || []).length);
  for (const c of (out.captured || [])) {
    if (/player\/auth|get_live_info|token/.test(c.u)) {
      console.log('\n--- ' + c.m + ' ' + c.u);
      console.log('   headers: ' + JSON.stringify(c.h));
      console.log('   body: ' + String(c.b).slice(0, 900));
    }
  }

  // Ask the openapi WASM to sign an ARBITRARY input -> proves it is a pure function we can query
  out.openapiVersion = await ev('window["cctvh5-openapi"] && window["cctvh5-openapi"].VERSION');
  out.sign1 = await ev('window["cctvh5-openapi"].getSignature({yspappid:"519748109",input:"HELLO-WORLD-TEST-1"})', true);
  out.sign2 = await ev('window["cctvh5-openapi"].getSignature({yspappid:"519748109",input:"HELLO-WORLD-TEST-1"})', true);
  out.sign3 = await ev('window["cctvh5-openapi"].getSignature({yspappid:"519748109",input:"HELLO-WORLD-TEST-2"})', true);
  out.sign4 = await ev('window["cctvh5-openapi"].getSignature({yspappid:"130004109",input:"HELLO-WORLD-TEST-1"})', true);
  console.log('\nopenapi VERSION:', out.openapiVersion);
  console.log('sign(HELLO-1) appid=519748109 :', JSON.stringify(out.sign1));
  console.log('sign(HELLO-1) again            :', JSON.stringify(out.sign2), '  <-- same input, see if deterministic');
  console.log('sign(HELLO-2) appid=519748109 :', JSON.stringify(out.sign3));
  console.log('sign(HELLO-1) appid=130004109 :', JSON.stringify(out.sign4));

  // Test the wasm signature against md5 hypotheses
  if (out.sign1 && out.sign1.openapi_signature) {
    const cands = {
      'md5(input)': md5('HELLO-WORLD-TEST-1'),
      'md5(input+appid)': md5('HELLO-WORLD-TEST-1' + '519748109'),
      'md5(appid+input)': md5('519748109' + 'HELLO-WORLD-TEST-1'),
      'md5(input+"519748109")': md5('HELLO-WORLD-TEST-1519748109'),
    };
    console.log('\nmd5 hypotheses for sign1:');
    for (const [k, v] of Object.entries(cands)) console.log('  ', k, '=', v, v === out.sign1.openapi_signature ? '  <== MATCH' : '');
  }

  fs.writeFileSync(path.join(OUTDIR, 'sign.json'), JSON.stringify(out, null, 1), 'utf8');
  try { ws.close(); } catch (e) { }
  await sleep(400); try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
