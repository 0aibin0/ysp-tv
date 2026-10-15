// Drive headless Chrome via CDP to extract live Vue state from yangshipin.cn
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const TARGET = process.argv[2] || 'https://www.yangshipin.cn/tv/home';
const OUTDIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const PROFILE = path.join(OUTDIR, 'chrome-profile');

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

async function waitDevtools(timeoutMs) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    try { return await getJson('/json/version'); } catch (e) { last = e; await sleep(400); }
  }
  throw new Error('devtools never came up: ' + last);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); });
    const c = new CDP(ws);
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id); c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        c.events.push(msg);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 60000);
    });
  }
  async eval(expr, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise, allowUnsafeEvalBlockedByCSP: true,
    });
    if (r.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  }
}

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });

  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=Translate,OptimizationHints',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--user-agent=${UA_DESKTOP}`,
    '--window-size=1280,800',
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  await waitDevtools(30000);
  console.log('[cdp] devtools up');

  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Record API traffic
  const apiCalls = [];
  cdp.ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Network.requestWillBeSent') {
      const u = msg.params.request.url;
      if (/capi|csapi|omsot|yspepg|mzhanepg|voapi|sapi\.yangshipin/.test(u) && !/\.(png|svg|jpg|css|woff)/.test(u)) {
        apiCalls.push({ url: u, method: msg.params.request.method, postData: msg.params.request.postData });
      }
    }
  });

  console.log('[cdp] navigating ->', TARGET);
  await cdp.send('Page.navigate', { url: TARGET });
  await sleep(18000); // let SPA boot + player start

  const info = await cdp.eval(`(() => {
    const out = {};
    out.url = location.href;
    out.title = document.title;
    out.readyState = document.readyState;

    // collect all Vue component instances reachable from DOM
    const insts = [];
    const seen = new Set();
    document.querySelectorAll('*').forEach(el => {
      const v = el.__vue__;
      if (v && !seen.has(v)) { seen.add(v); insts.push(v); }
    });
    out.vueInstanceCount = insts.length;

    // describe each instance briefly
    out.instances = insts.slice(0, 80).map(v => {
      let name = (v.$options && (v.$options.name || v.$options._componentTag)) || '?';
      let keys = [];
      try { keys = Object.keys(v._data || {}); } catch(e){}
      let size = null;
      try { size = v.$el ? (v.$el.offsetWidth + 'x' + v.$el.offsetHeight) : null; } catch(e){}
      return { name, keys: keys.slice(0, 40), el: v.$el ? (v.$el.className || v.$el.tagName) : null, size };
    });

    // find instances that look like they hold the channel list
    out.channelCandidates = [];
    insts.forEach(v => {
      let d = {};
      try { d = v._data || {}; } catch(e){ return; }
      Object.keys(d).forEach(k => {
        const val = d[k];
        if (Array.isArray(val) && val.length > 5) {
          const s = JSON.stringify(val).slice(0, 300);
          if (/CCTV|卫视/.test(s)) {
            out.channelCandidates.push({ comp: (v.$options&&v.$options.name)||'?', key: k, len: val.length, sample: s });
          }
        }
      });
    });

    // program info candidates
    out.programCandidates = [];
    insts.forEach(v => {
      let d = {};
      try { d = v._data || {}; } catch(e){ return; }
      Object.keys(d).forEach(k => {
        const val = d[k];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const s = JSON.stringify(val);
          if (s && /title|Title|program|Program|name/.test(s) && s.length < 4000) {
            out.programCandidates.push({ comp:(v.$options&&v.$options.name)||'?', key:k, sample: s.slice(0,300) });
          }
        }
      });
    });

    // DOM-level: what does the right panel contain
    const right = document.querySelector('[class*="tv-main-con-r"]');
    out.rightPanel = right ? { cls: right.className, text: (right.innerText||'').slice(0, 600), html: right.outerHTML.slice(0, 1500) } : null;

    // geometry of key blocks
    out.geom = {};
    ['.tv-main-con-l','.tv-main-con-r','.tv-main-con','video','#vodbox2024078201','.tv-main','.tv','.tv-home','.tv-home-list'].forEach(sel => {
      const el = document.querySelector(sel);
      if (el) { const r = el.getBoundingClientRect(); out.geom[sel] = { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height) }; }
    });
    return out;
  })()`);

  fs.writeFileSync(path.join(OUTDIR, 'live-state.json'), JSON.stringify(info, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTDIR, 'api-calls.json'), JSON.stringify(apiCalls, null, 2), 'utf8');

  console.log('==== URL ====', info.url);
  console.log('==== vue instances ====', info.vueInstanceCount);
  console.log('==== channel candidates ====');
  console.log(JSON.stringify(info.channelCandidates, null, 2).slice(0, 4000));
  console.log('==== geometry ====');
  console.log(JSON.stringify(info.geom, null, 2));
  console.log('==== right panel text ====');
  console.log(info.rightPanel ? info.rightPanel.text : 'none');
  console.log('==== api calls ====');
  console.log(JSON.stringify(apiCalls.slice(0, 40), null, 2).slice(0, 5000));

  cleanup();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
