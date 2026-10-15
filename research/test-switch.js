// Verify the critical design assumption: can we change channel by pushing the
// Vue route (no full page reload), and does the player actually re-load?
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-profile3');
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

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `--user-agent=${UA}`, '--window-size=1920,1080', 'about:blank',
  ], { stdio: 'ignore' });
  process.on('exit', () => { try { proc.kill(); } catch (e) {} });

  await waitDevtools(30000);
  const list = await getJson('/json/list');
  const cdp = await CDP.connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  let mainNavigations = 0;
  cdp.on.push((m) => {
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) mainNavigations++;
  });

  await cdp.send('Page.navigate', { url: 'https://www.yangshipin.cn/tv/home' });
  await sleep(20000);
  mainNavigations = 0; // ignore the initial load

  // Mark the document so a reload is detectable
  await cdp.eval(`window.__MARK = 'alive-' + Math.random(); true`);
  const mark0 = await cdp.eval('window.__MARK');
  console.log('[mark]', mark0);

  // ---------- locate the Vue app + router ----------
  const probe = await cdp.eval(`(() => {
    const out = { rootIds: [], vue2: false, vue3App: false, routerFound: false, routerType: null };
    const roots = [document.querySelector('#app'), document.querySelector('#__nuxt'), document.body.firstElementChild].filter(Boolean);
    out.rootIds = roots.map(e => e.id || e.tagName + '.' + (e.className||'').toString().slice(0,40));

    // Vue 2 style
    for (const r of roots) { if (r.__vue__) out.vue2 = true; }
    // Vue 3 style
    const all = document.querySelectorAll('*');
    let app = null;
    for (const el of all) { if (el.__vue_app__) { app = el.__vue_app__; break; } }
    if (app) {
      out.vue3App = true;
      const gp = app.config && app.config.globalProperties;
      out.hasGlobalProps = !!gp;
      if (gp && gp.$router) {
        out.routerFound = true;
        out.routerType = (gp.$router.currentRoute && 'vue-router');
        out.currentRoute = gp.$router.currentRoute && gp.$router.currentRoute.value
          ? { path: gp.$router.currentRoute.value.path, query: JSON.parse(JSON.stringify(gp.$router.currentRoute.value.query)) }
          : null;
      }
      out.appKeys = Object.keys(app).slice(0, 20);
    }
    return out;
  })()`);
  console.log('[probe]', JSON.stringify(probe, null, 2));

  const sel0 = await cdp.eval(`(() => {
    const v = document.querySelector('video');
    return { src: v ? v.src : null, prog: (document.querySelector('[class*="tv-zhan-title"]')||{}).innerText || null, href: location.href };
  })()`);
  console.log('[before]', JSON.stringify(sel0));

  // ---------- TEST 1: router.push ----------
  console.log('\n===== TEST 1: router.push({path:/tv/home, query:{pid}}) =====');
  const pushed = await cdp.eval(`(() => {
    const el = document.querySelector('[__vue_app__]') ||
      Array.from(document.querySelectorAll('*')).find(e => e.__vue_app__);
    if (!el) return { ok:false, why:'no vue app' };
    const gp = el.__vue_app__.config && el.__vue_app__.config.globalProperties;
    const r = gp && gp.$router;
    if (!r) return { ok:false, why:'no router' };
    try {
      r.push({ path: '/tv/home', query: { pid: '600001818' } });
      return { ok:true };
    } catch (e) { return { ok:false, why: String(e) }; }
  })()`);
  console.log('[push]', JSON.stringify(pushed));
  await sleep(6000);

  const after1 = await cdp.eval(`(() => {
    const v = document.querySelector('video');
    return { mark: window.__MARK || null, src: v ? v.src : null,
             prog: (document.querySelector('[class*="tv-zhan-title"]')||{}).innerText || null,
             href: location.href,
             readyState: v ? v.readyState : null, paused: v ? v.paused : null };
  })()`);
  console.log('[after1]', JSON.stringify(after1, null, 2));
  console.log('[after1] marker survived (no reload)?', after1.mark === mark0);
  console.log('[after1] main-frame navigations during push:', mainNavigations);

  // ---------- TEST 2: history.pushState + popstate ----------
  console.log('\n===== TEST 2: history.pushState + popstate =====');
  mainNavigations = 0;
  await cdp.eval(`(() => {
    history.pushState({}, '', '/tv/home?pid=600002521');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    return true;
  })()`);
  await sleep(6000);
  const after2 = await cdp.eval(`(() => {
    const v = document.querySelector('video');
    return { mark: window.__MARK || null, src: v ? v.src : null,
             prog: (document.querySelector('[class*="tv-zhan-title"]')||{}).innerText || null,
             href: location.href, readyState: v ? v.readyState : null };
  })()`);
  console.log('[after2]', JSON.stringify(after2, null, 2));
  console.log('[after2] marker survived?', after2.mark === mark0, ' navs:', mainNavigations);

  // ---------- TEST 3: isolated-player injection + screenshot ----------
  console.log('\n===== TEST 3: inject isolation, then screenshot =====');
  await cdp.eval(`(() => {
    const MAXZ = 2147483000;
    const v = document.querySelector('video');
    if (!v) return false;
    // neutralize clipping ancestors
    let p = v.parentElement;
    while (p) { const s = p.style; s.overflow='visible'; s.transform='none'; s.filter='none';
      s.contain='none'; s.clipPath='none'; s.perspective='none'; p = p.parentElement; }
    const s = v.style;
    s.position='fixed'; s.left='0px'; s.top='0px'; s.width='100vw'; s.height='100vh';
    s.zIndex=String(MAXZ); s.objectFit='contain'; s.background='#000';
    // shield
    let sh = document.getElementById('__ysp_shield');
    if (!sh) { sh = document.createElement('div'); sh.id='__ysp_shield';
      sh.style.cssText='position:fixed;inset:0;background:#000;z-index:'+(MAXZ-1);
      document.body.appendChild(sh); }
    return true;
  })()`);
  await sleep(2500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUTDIR, 'isolated.png'), Buffer.from(shot.data, 'base64'));
  console.log('[shot] isolated.png written');

  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
