// Find the reliable in-place channel switch. The site is Vue 2.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-profile4');
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
  throw new Error('devtools down ' + last);
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
  async eval(e, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise, allowUnsafeEvalBlockedByCSP: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
}

const STATE = `(() => {
  const v = document.querySelector('video');
  return { mark: window.__MARK || null,
           src: v ? (v.src||'').slice(-24) : null,
           prog: (document.querySelector('[class*="tv-zhan-title"]')||{}).innerText || null,
           href: location.href };
})()`;

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

  await cdp.send('Page.navigate', { url: 'https://www.yangshipin.cn/tv/home' });
  await sleep(20000);
  navs = 0;
  await cdp.eval(`window.__MARK='M1'; true`);

  console.log('[before]', JSON.stringify(await cdp.eval(STATE)));

  // ---- inspect the Vue 2 root instance ----
  const root = await cdp.eval(`(() => {
    const app = document.querySelector('#app');
    const v = app && app.__vue__;
    if (!v) return { ok:false };
    const r = v.$router;
    return {
      ok: true,
      hasRouter: !!r,
      mode: r ? r.mode : null,
      current: r ? { path: r.currentRoute.path, query: JSON.parse(JSON.stringify(r.currentRoute.query)) } : null,
      rootKeys: Object.keys(v.$data || {}).slice(0,30),
      hasStore: !!v.$store,
      storeKeys: v.$store ? Object.keys(v.$store.state || {}).slice(0,30) : null
    };
  })()`);
  console.log('[root]', JSON.stringify(root, null, 2));

  // ---- TEST A: Vue 2 router.push ----
  console.log('\n===== TEST A: $router.push pid=600001818 (CCTV5) =====');
  const a = await cdp.eval(`(() => {
    const v = document.querySelector('#app').__vue__;
    try { v.$router.push({ path: '/tv/home', query: { pid: '600001818' } }); return { ok:true }; }
    catch(e){ return { ok:false, why:String(e) }; }
  })()`);
  console.log('[push]', JSON.stringify(a));
  await sleep(7000);
  console.log('[afterA]', JSON.stringify(await cdp.eval(STATE)), 'navs=', navs);

  if ((await cdp.eval('window.__MARK')) !== 'M1') { console.log('!!! PAGE RELOADED - router.push causes full reload'); }
  else console.log('[A] marker intact -> no page reload');

  // ---- TEST B: click the page's own channel element ----
  console.log('\n===== TEST B: click channel element by text =====');
  navs = 0;
  const b = await cdp.eval(`(() => {
    const els = Array.from(document.querySelectorAll('[class*="tv-main-con-r-list-left-imga"],[class*="tv-main-con-r-list-left-imgb"]'));
    const t = els.find(e => e.innerText.trim().split('\\n')[0].trim() === 'CCTV13');
    if (!t) return { ok:false, found: els.length };
    const wasHidden = !(t.offsetWidth || t.offsetHeight);
    t.click();
    return { ok:true, hidden: wasHidden };
  })()`);
  console.log('[clickCCTV13]', JSON.stringify(b));
  await sleep(7000);
  console.log('[afterB]', JSON.stringify(await cdp.eval(STATE)), 'navs=', navs);
  console.log('[B] marker intact?', (await cdp.eval('window.__MARK')) === 'M1');

  // ---- TEST C: how does the app itself update the programme title / find the player component ----
  console.log('\n===== TEST C: locate the player-bearing component =====');
  const c = await cdp.eval(`(() => {
    const found = [];
    const seen = new Set();
    document.querySelectorAll('*').forEach(el => {
      const v = el.__vue__;
      if (!v || seen.has(v)) return; seen.add(v);
      const d = v.$data || {};
      const props = v.$props || {};
      const has = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
      const keys = [...Object.keys(d), ...Object.keys(props)];
      const interesting = keys.filter(k => /player|video|pid|channel|url|src|live|cur|select/i.test(k));
      if (interesting.length) {
        found.push({ name: (v.$options && (v.$options.name||v.$options._componentTag)) || '?',
                     tag: v.$el ? (v.$el.className||v.$el.tagName||'').toString().slice(0,50) : null,
                     interesting: interesting.slice(0,14) });
      }
    });
    return found.slice(0, 25);
  })()`);
  console.log('[components]', JSON.stringify(c, null, 2));

  // ---- TEST D: what page URL/keys map the list entries to channels ----
  console.log('\n===== TEST D: full channel element list w/ index =====');
  const d = await cdp.eval(`(() => {
    const els = Array.from(document.querySelectorAll('[class*="tv-main-con-r-list-left-imga"],[class*="tv-main-con-r-list-left-imgb"]'));
    return els.map((e,i) => ({ i, cls: (e.className.match(/imga|imgb/)||[''])[0], t: e.innerText.trim().split('\\n')[0].trim(), sel: e.className.includes('tvSelect') }));
  })()`);
  console.log(JSON.stringify(d));

  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
