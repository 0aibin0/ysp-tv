// Harvest the yangshipin channel -> pid table + per-channel "now playing" title
// by driving the real page through CDP (ground truth, no guessing at minified JS).
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-profile2');
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOME = 'https://www.yangshipin.cn/tv/home';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
async function waitDevtools(ms) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) { try { return await getJson('/json/version'); } catch (e) { last = e; await sleep(400); } }
  throw new Error('devtools down: ' + last);
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.on = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws err')); });
    const c = new CDP(ws);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) c.on.forEach((f) => f(msg));
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 90000);
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, allowUnsafeEvalBlockedByCSP: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
    return r.result.value;
  }
}

const SAFE = `
window.__safeStr = function(o, maxLen){
  maxLen = maxLen || 1200;
  var seen = new WeakSet();
  try {
    var s = JSON.stringify(o, function(k, v){
      if (typeof v === 'function') return '[fn]';
      if (typeof v === 'object' && v !== null) { if (seen.has(v)) return '[circ]'; seen.add(v); }
      return v;
    });
    return s ? s.slice(0, maxLen) : String(s);
  } catch(e) { return '[err ' + e.message + ']'; }
};
window.__vis = function(el){
  if(!el) return false;
  var r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  var s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05;
};
window.__sel = function(){ var e = document.querySelector('.tvSelect'); return e ? e.innerText.trim().split('\\n')[0].trim() : null; };
window.__title = function(){ var e = document.querySelector('.tv-zhan-title'); return e ? e.innerText.trim() : null; };
window.__info = function(){
  var v = document.querySelector('video');
  return {
    sel: window.__sel(),
    prog: window.__title(),
    href: location.href,
    videoSrc: v ? (v.src||'').slice(0,80) : null,
    paused: v ? v.paused : null,
    currentTime: v ? Math.round(v.currentTime*10)/10 : null
  };
};
true`;

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `--user-agent=${UA_DESKTOP}`, '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  await waitDevtools(30000);
  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');

  const apiCalls = [];
  cdp.on.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const u = msg.params.request.url;
      if (/capi\.|csapi\.|omsot|yspepg|mzhanepg|voapi/.test(u)) {
        apiCalls.push({ url: u.slice(0, 300), method: msg.params.request.method, post: (msg.params.request.postData || '').slice(0, 400) });
      }
    }
  });

  console.log('[nav]', HOME);
  await cdp.send('Page.navigate', { url: HOME });
  await sleep(20000);
  await cdp.eval(SAFE);
  console.log('[boot]', JSON.stringify(await cdp.eval('window.__info()')));

  // Discover the two channel lists and the tab control
  const layout = await cdp.eval(`(() => {
    const q = (s) => Array.from(document.querySelectorAll(s));
    const a = q('[class*="tv-main-con-r-list-left-imga"]');
    const b = q('[class*="tv-main-con-r-list-left-imgb"]');
    const tabs = q('[class*="tv-main-con-r-tab-img"]');
    return {
      aCount: a.length, bCount: b.length, tabCount: tabs.length,
      aVisible: a.filter(window.__vis).length, bVisible: b.filter(window.__vis).length,
      aNames: a.slice(0,60).map(e => e.innerText.trim().split('\\n')[0].trim()),
      bNames: b.slice(0,60).map(e => e.innerText.trim().split('\\n')[0].trim()),
      tabHtml: tabs.map(t => t.outerHTML.slice(0,200)),
      parentCls: a[0] ? a[0].parentElement.className : null,
      grandCls: a[0] ? a[0].parentElement.parentElement.className : null
    };
  })()`);
  fs.writeFileSync(path.join(OUTDIR, 'layout.json'), JSON.stringify(layout, null, 2), 'utf8');
  console.log('[layout] aCount=%d bCount=%d aVis=%d bVis=%d tabs=%d', layout.aCount, layout.bCount, layout.aVisible, layout.bVisible, layout.tabCount);
  console.log('[layout] aNames=%s', JSON.stringify(layout.aNames));
  console.log('[layout] bNames=%s', JSON.stringify(layout.bNames));

  const results = [];

  // Click every entry of a given list class, recording pid + programme title
  async function scan(selClass, label) {
    const count = await cdp.eval(`document.querySelectorAll('${selClass}').length`);
    console.log(`[scan ${label}] ${count} entries`);
    for (let i = 0; i < count; i++) {
      const clicked = await cdp.eval(`(() => {
        const els = document.querySelectorAll('${selClass}');
        const el = els[${i}];
        if (!el) return { ok:false, why:'missing' };
        const name = el.innerText.trim().split('\\n')[0].trim();
        el.scrollIntoView({block:'center'});
        el.click();
        return { ok:true, name };
      })()`);
      if (!clicked.ok) { results.push({ list: label, idx: i, error: clicked.why }); continue; }
      await sleep(1100);
      const st = await cdp.eval('window.__info()');
      results.push({ list: label, idx: i, name: clicked.name, sel: st.sel, prog: st.prog, href: st.href, videoSrc: st.videoSrc, paused: st.paused });
      if (i % 8 === 0 || i === count - 1) console.log(`  [${label} ${i+1}/${count}] ${clicked.name} -> prog=${st.prog} pid=${(st.href.match(/pid=([^&]+)/)||[])[1]}`);
    }
  }

  // CCTV list first
  await scan('[class*="tv-main-con-r-list-left-imga"]', 'cctv');

  // switch to the satellite tab, then scan list b
  const tabClicked = await cdp.eval(`(() => {
    const tabs = document.querySelectorAll('[class*="tv-main-con-r-tab-img"]');
    if (tabs.length < 2) return false;
    tabs[1].click(); return true;
  })()`);
  console.log('[tab] switched to satellite tab:', tabClicked);
  await sleep(2500);

  await scan('[class*="tv-main-con-r-list-left-imgb"]', 'satellite');

  fs.writeFileSync(path.join(OUTDIR, 'channels-raw.json'), JSON.stringify(results, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTDIR, 'api-calls2.json'), JSON.stringify(apiCalls.slice(0, 120), null, 2), 'utf8');

  const ok = results.filter((r) => r.href && /pid=/.test(r.href));
  console.log('\n===== SUMMARY =====');
  console.log('total entries:', results.length, ' with pid:', ok.length);
  console.log('unique pids:', new Set(ok.map((r) => (r.href.match(/pid=([^&]+)/) || [])[1])).size);
  console.log('cctv captured:', results.filter(r=>r.list==='cctv' && r.href && /pid=/.test(r.href)).length);
  console.log('satellite captured:', results.filter(r=>r.list==='satellite' && r.href && /pid=/.test(r.href)).length);
  console.log('sample rows:', JSON.stringify(ok.slice(0, 6), null, 2));
  console.log('api samples:', JSON.stringify(apiCalls.slice(0, 12), null, 2));

  cleanup(); process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
