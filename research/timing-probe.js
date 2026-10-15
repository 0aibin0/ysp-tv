// Careful measurement of a real channel change in desktop Chrome.
// Verifies the src actually swapped before believing any "first frame" time,
// so we do not accidentally time the OLD stream and conclude it is instant.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9352;
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-timing');
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
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: 'https://www.yangshipin.cn/tv/home' });
  await sleep(22000);

  // Timestamps gathered inside the page so there is no IPC noise.
  await cdp.eval(`
    window.__T = { events: [] };
    window.__mark = function(k){ window.__T.events.push([k, performance.now()]); };
    (function(){
      var tick = setInterval(function(){
        var v = document.querySelector('video');
        if (!v) return;
        if (window.__lastSrc !== (v.src||'')) {
          window.__lastSrc = v.src||'';
          window.__mark('src=' + window.__lastSrc.slice(-12));
        }
        if (v.videoWidth > 0 && !window.__hadW) { window.__hadW = true; window.__mark('WIDTH>0'); }
        if (v.videoWidth === 0 && window.__hadW)  { window.__hadW = false; window.__mark('WIDTH=0'); }
      }, 20);
    })();
    true;
  `);

  const targets = ['600001818', '600001801', '600001814'];
  for (const pid of targets) {
    await cdp.eval(`window.__T.events.length = 0; window.__mark('CALL');
      (function(){
        var el = Array.from(document.querySelectorAll('*')).find(e => e.__vue__ && e.__vue__.$data && e.__vue__.$data.currentJiemu);
        var host = el.__vue__;
        var arrs = [host.tabA||[], host.tabB||[]];
        for (var a=0;a<arrs.length;a++) for (var i=0;i<arrs[a].length;i++)
          if (String(arrs[a][i].pid) === '${pid}') { host.changeTV(arrs[a][i]); return true; }
        return false;
      })(); true;`);

    await sleep(6000);
    const ev = await cdp.eval('JSON.stringify(window.__T.events)');
    const events = JSON.parse(ev);
    const t0 = events.find((e) => e[0] === 'CALL');
    console.log(`\n=== pid ${pid} ===`);
    events.forEach((e) => {
      const rel = t0 ? Math.round(e[1] - t0[1]) : 0;
      console.log(`  +${rel}ms  ${e[0]}`);
    });
  }

  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
