// Find the app's own channel-switch entry point (TVA component) + programme title source.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-profile5');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
async function waitDevtools(ms) {
  const t0 = Date.now(); let last;
  while (Date.now() - t0 < ms) { try { return await getJson('/json/version'); } catch (e) { last = e; await sleep(400); } }
  throw new Error('devtools down');
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.on = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
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
  send(m, p = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + m)); } }, 60000);
    });
  }
  async eval(e, aw = false) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw, allowUnsafeEvalBlockedByCSP: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
}

const F = `window.__comp = function(name){
  var out = null;
  var seen = new Set();
  document.querySelectorAll('*').forEach(function(el){
    var v = el.__vue__; if (!v || seen.has(v)) return; seen.add(v);
    var n = (v.$options && (v.$options.name||v.$options._componentTag)) || '';
    if (n === name && !out) out = v;
  });
  return out;
};
window.__state = function(){
  var v = document.querySelector('video');
  var t = window.__comp('TVA');
  return {
    mark: window.__MARK || null,
    srcTail: v ? (v.src||'').slice(-20) : null,
    paused: v ? v.paused : null,
    currentJiemu: t ? t.currentJiemu : undefined,
    currentIndex: t ? t.currentIndex : undefined,
    selectIndex: t ? t.selectIndex : undefined,
    titleDom: (document.querySelector('[class*="tv-zhan-title"]')||{}).innerText || null,
    href: location.href
  };
};
true`;

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `--user-agent=${UA}`, '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' });
  process.on('exit', () => { try { proc.kill(); } catch (e) {} });

  await waitDevtools(30000);
  const cdp = await CDP.connect((await getJson('/json/list')).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  let navs = 0;
  cdp.on.push((m) => { if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) navs++; });

  async function freshLoad() {
    navs = 0;
    await cdp.send('Page.navigate', { url: 'https://www.yangshipin.cn/tv/home' });
    await sleep(19000);
    await cdp.eval(F);
    await cdp.eval(`window.__MARK = 'M-' + Date.now(); true`);
  }

  await freshLoad();
  console.log('[state]', JSON.stringify(await cdp.eval('window.__state()')));

  // ---- dump TVA component surface ----
  const tva = await cdp.eval(`(() => {
    const t = window.__comp('TVA');
    if (!t) return { ok:false };
    const dataKeys = Object.keys(t.$data || {});
    const methods = t.$options.methods ? Object.keys(t.$options.methods) : [];
    const computed = t.$options.computed ? Object.keys(t.$options.computed) : [];
    const fnProps = Object.keys(t).filter(k => typeof t[k] === 'function' && !k.startsWith('$') && !k.startsWith('_'));
    const safe = {};
    dataKeys.forEach(k => {
      const v = t[k];
      const ty = Array.isArray(v) ? 'array[' + v.length + ']' : (v === null ? 'null' : typeof v);
      let sample = '';
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') sample = String(v).slice(0,60);
      else if (Array.isArray(v) && v.length) sample = JSON.stringify(v[0]).slice(0,120);
      safe[k] = ty + (sample ? ' = ' + sample : '');
    });
    return { ok:true, data: safe, methods, computed, fnProps };
  })()`);
  console.log('\n===== TVA surface =====');
  console.log(JSON.stringify(tva, null, 2).slice(0, 6000));

  // ---- TEST: click a HIDDEN satellite element ----
  console.log('\n===== TEST: click hidden satellite 湖南卫视 =====');
  navs = 0;
  const click = await cdp.eval(`(() => {
    const els = Array.from(document.querySelectorAll('*')).filter(e => {
      const t = (e.innerText||'').trim();
      return t === '湖南卫视' && e.children.length <= 2;
    });
    const el = els[els.length-1];
    if (!el) return { ok:false };
    const vis = !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    el.click();
    return { ok:true, visibleBeforeClick: vis, tag: el.tagName, cls: String(el.className).slice(0,60) };
  })()`);
  console.log('[click]', JSON.stringify(click));
  await sleep(7000);
  console.log('[after]', JSON.stringify(await cdp.eval('window.__state()')));
  console.log('[no reload?]', (await cdp.eval('window.__MARK||null')) !== null, ' navs=', navs);

  // ---- TEST: drive TVA directly by index ----
  await freshLoad();
  console.log('\n===== TEST: TVA direct drive =====');
  const direct = await cdp.eval(`(() => {
    const t = window.__comp('TVA');
    if (!t) return { ok:false, why:'no TVA' };
    const before = { currentIndex: t.currentIndex, selectIndex: t.selectIndex };
    const names = Object.keys(t.$options.methods || {});
    // try a method that looks like a channel selector
    let called = null;
    for (const n of names) {
      if (/select|change|click|switch|channel|tab/i.test(n)) {
        try { t[n](0); called = n + '(0)'; break; } catch(e) {}
      }
    }
    return { ok:true, before, methodNames: names.slice(0,60), called };
  })()`);
  console.log('[direct]', JSON.stringify(direct, null, 2).slice(0, 3000));
  await sleep(6000);
  console.log('[after direct]', JSON.stringify(await cdp.eval('window.__state()')));

  // ---- TEST: click CCTV6 element (a channel far from current) ----
  console.log('\n===== TEST: click CCTV6 =====');
  const c6 = await cdp.eval(`(() => {
    const els = Array.from(document.querySelectorAll('*')).filter(e => (e.innerText||'').trim() === 'CCTV6' && e.children.length <= 2);
    const el = els[els.length-1];
    if (!el) return { ok:false, n: els.length };
    el.click(); return { ok:true, n: els.length, cls: String(el.className).slice(0,60) };
  })()`);
  console.log('[clickCCTV6]', JSON.stringify(c6));
  await sleep(7000);
  console.log('[after]', JSON.stringify(await cdp.eval('window.__state()')));

  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
