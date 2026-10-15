// Does tv.cctv.com/live/<ch>/ actually produce a playing video in a desktop browser?
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9340;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-fb');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const TARGET = process.argv[2] || 'https://tv.cctv.com/live/cctv1/';
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

  const media = [];
  cdp.on.push((m) => {
    if (m.method === 'Network.responseReceived') {
      const u = m.params.response.url;
      if (/\.m3u8|\.ts(\?|$)|\.mp4|get_live|playinfo/i.test(u)) media.push(u.slice(0, 160));
    }
  });

  console.log('[nav]', TARGET);
  await cdp.send('Page.navigate', { url: TARGET });

  for (const t of [8, 16, 24, 34]) {
    await sleep(t === 8 ? 8000 : 8000);
    const st = await cdp.eval(`(() => {
      const vs = Array.from(document.querySelectorAll('video'));
      const ifr = Array.from(document.querySelectorAll('iframe')).map(f => f.src || '(no src)');
      return {
        href: location.href,
        title: document.title,
        videoCount: vs.length,
        videos: vs.map(v => ({
          rs: v.readyState, paused: v.paused, ct: Math.round(v.currentTime*10)/10,
          w: v.videoWidth, h: v.videoHeight, err: v.error ? v.error.code : 0,
          src: (v.currentSrc || v.src || '').slice(0, 90)
        })),
        iframes: ifr.slice(0, 6)
      };
    })()`);
    console.log(`\n--- t=${t}s ---`);
    console.log(JSON.stringify(st, null, 2));
  }

  console.log('\n=== media requests seen ===');
  console.log(media.slice(0, 25).join('\n') || '(none)');

  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
