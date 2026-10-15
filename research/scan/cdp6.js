// Dump the obfuscated string-building code and evaluate it in-page to recover the signature secrets.
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
const OUTDIR = path.join(__dirname, '..', 'capture6');
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
  await send('Page.navigate', { url: TARGET }, S);
  await sleep(18000);
  async function ev(expr, aw) { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!aw }, S); return r.exceptionDetails ? { __error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || JSON.stringify(r.exceptionDetails) } : r.result.value; }

  const out = {};
  // Provide controlled knowns, then run the player's own signing path in-page and read the output.
  // We drive the real code by calling the module-level functions via the webpack runtime.
  out.probe = await ev(`(function(){
     var out={};
     try{
       var wv=window.webpackJsonp;
       out.hasWebpackJsonp = !!wv;
       out.chunks = (wv||[]).length;
     }catch(e){ out.err=String(e); }
     return out;
  })()`);
  console.log('probe:', JSON.stringify(out.probe));

  // Find the webpack require and pull the vendor module that holds the signing helpers.
  out.req = await ev(`(function(){
    var res={};
    try{
      // webpack 4 style: window.webpackJsonp.push([[],{ __probe: function(m,e,r){ window.__REQ = r; } },[[ "__probe" ]]]);
      window.webpackJsonp.push([[],[{__probe:function(m,e,r){ window.__REQ=r; }}],[["__probe"]]]);
      res.ok = typeof window.__REQ === 'function';
    }catch(e){ res.err = String(e); }
    return res;
  })()`);
  console.log('webpack require:', JSON.stringify(out.req));

  // Enumerate module ids in the vendors bundle that contain 'hex_md5' style helpers is not possible directly.
  // Instead: hook the players own signing by capturing XHR, then read the decrypted secrets from the DOM scope is not possible.
  // Practical route: ask the page what it computes for a CONTROLLED auth body by re-using openapi sign on the auth body.
  out.authSignOnControlledInputs = await ev(`(async function(){
     var o=window['cctvh5-openapi'];
     var r={};
     r.sig_of_authbody = await o.getSignature({yspappid:'519748109', input:'pid=600001859&guid=TESTGUID1234&appid=ysp_pc&rand_str=AAAAAAAAAA'});
     r.sig_of_sorted   = await o.getSignature({yspappid:'519748109', input:'appid=ysp_pc&guid=TESTGUID1234&pid=600001859&rand_str=AAAAAAAAAA'});
     return r;
  })()`, true);
  console.log('openapi sig on auth-like bodies:', JSON.stringify(out.authSignOnControlledInputs, null, 1));

  // Verify determinism + whether the openapi md5 is a function of (appid,input) only
  out.grid = await ev(`(async function(){
     var o=window['cctvh5-openapi']; var r=[];
     for (var i=0;i<3;i++){
       var s = await o.getSignature({yspappid:'519748109', input:'X'+i});
       r.push(s.openapi_signature);
     }
     return r;
  })()`, true);
  console.log('sign X0..X2:', JSON.stringify(out.grid));

  // For each, test md5 hypotheses to identify the openapi inner hash
  if (Array.isArray(out.grid)) {
    console.log('\nmd5 hypotheses on openapi sign(X0):');
    const t = out.grid[0].split('-')[0];
    const tries = {
      'md5("X0")': md5('X0'),
      'md5("519748109X0")': md5('519748109X0'),
      'md5("X0519748109")': md5('X0519748109'),
      'md5("519748109|X0")': md5('519748109|X0'),
      'md5("X0|519748109")': md5('X0|519748109'),
      'md5("519748109-X0")': md5('519748109-X0'),
      'md5("X0-519748109")': md5('X0-519748109'),
      'md5("yspappid=519748109&input=X0")': md5('yspappid=519748109&input=X0'),
    };
    for (const [k, v] of Object.entries(tries)) if (v === t) console.log('   MATCH:', k);
    console.log('   (target was ' + t + ')');
  }

  fs.writeFileSync(path.join(OUTDIR, 'probe.json'), JSON.stringify(out, null, 1), 'utf8');
  try { ws.close(); } catch (e) { }
  await sleep(400); try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
