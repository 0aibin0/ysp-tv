// Break down where the ~2.3s of stream startup goes, and check whether the
// player exposes a reusable stream URL for a channel that has already played.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9350;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-prewarm');
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
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  }
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `--user-agent=${UA}`, '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' });
  process.on('exit', () => { try { proc.kill(); } catch (e) {} });

  await waitDevtools(30000);
  const cdp = await CDP.connect((await getJson('/json/list')).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');

  // Time the network legs of a channel change
  const marks = [];
  cdp.on.push((m) => {
    const t = Date.now();
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (/player\/auth|get_live_info|\.m3u8/i.test(u)) marks.push({ t, kind: 'REQ', what: u.slice(0, 110) });
    } else if (m.method === 'Network.loadingFinished') {
      // matched later by requestId if needed
    } else if (m.method === 'Network.responseReceived') {
      const u = m.params.response.url;
      if (/player\/auth|get_live_info|\.m3u8/i.test(u)) marks.push({ t, kind: 'RES', what: u.slice(0, 110), status: m.params.response.status });
    }
  });

  console.log('[nav]');
  await cdp.send('Page.navigate', { url: 'https://www.yangshipin.cn/tv/home' });
  await sleep(22000);

  // Does the player state expose a stream URL we could cache?
  const probe = await cdp.eval(`(() => {
    const out = { found: [], video: null };
    const v = document.querySelector('video');
    if (v) out.video = { src: (v.src||'').slice(0,80), currentSrc: (v.currentSrc||'').slice(0,80) };
    const seen = new Set();
    document.querySelectorAll('*').forEach(el => {
      const c = el.__vue__; if (!c || seen.has(c)) return; seen.add(c);
      const d = c.$data || {};
      Object.keys(d).forEach(k => {
        const val = d[k];
        if (typeof val === 'string' && /^https?:.*(m3u8|playurl|flv)/i.test(val)) {
          out.found.push({ comp: (c.$options&&c.$options.name)||'?', key: k, val: val.slice(0,140) });
        }
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          Object.keys(val).forEach(k2 => {
            const v2 = val[k2];
            if (typeof v2 === 'string' && /^https?:.*(m3u8|playurl)/i.test(v2)) {
              out.found.push({ comp: (c.$options&&c.$options.name)||'?', key: k+'.'+k2, val: v2.slice(0,140) });
            }
          });
        }
      });
    });
    return out;
  })()`);
  console.log('\n=== exposed stream URLs ===');
  console.log(JSON.stringify(probe, null, 2).slice(0, 3000));

  marks.length = 0;
  console.log('\n=== switching to CCTV-5, timing the network legs ===');
  const t0 = Date.now();
  await cdp.eval(`(() => {
    const el = Array.from(document.querySelectorAll('*')).find(e => e.__vue__ && e.__vue__.$data && e.__vue__.$data.currentJiemu);
    const host = el.__vue__;
    const all = [host.tabA||[], host.tabB||[]];
    for (const arr of all) for (const ch of arr) if (String(ch.pid)==='600001818') { host.changeTV(ch); return true; }
    return false;
  })()`);

  // poll video state
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    const st = await cdp.eval(`(() => { const v=document.querySelector('video'); return v?{rs:v.readyState,vw:v.videoWidth,ct:Math.round(v.currentTime*100)/100}:null; })()`);
    if (st && st.vw > 0) { console.log(`  FIRST FRAME at ${Date.now()-t0}ms  ${JSON.stringify(st)}`); break; }
    if (i % 4 === 0) console.log(`  t=${Date.now()-t0}ms ${JSON.stringify(st)}`);
  }

  console.log('\n=== network legs after the switch ===');
  marks.forEach((m) => console.log(`  +${m.t - t0}ms ${m.kind} ${m.status||''} ${m.what}`));

  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
