// CDP capture + interaction + live Vue state extraction
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL_TO_OPEN = process.argv[2] || 'https://www.yangshipin.cn/tv/home';
const OUTDIR = process.argv[3] || path.join(__dirname, '..', 'capture2');
const PROFILE = path.join(OUTDIR, 'chrome-profile');

function getJSON(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + PROFILE,
    '--window-size=1600,1000', '--autoplay-policy=no-user-gesture-required', 'about:blank'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const v = await getJSON('/json/version'); if (v.webSocketDebuggerUrl) { wsUrl = v.webSocketDebuggerUrl; break; } } catch (e) { }
  }
  if (!wsUrl) { console.error('NO CDP'); chrome.kill(); process.exit(2); }

  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const records = new Map(); const logs = [];
  function send(method, params, sessionId) {
    return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId })); });
  }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); return; }
    if (!msg.method) return;
    if (msg.method === 'Network.requestWillBeSent') {
      const rq = msg.params.request;
      records.set(msg.params.requestId, {
        requestId: msg.params.requestId, url: rq.url, method: rq.method, headers: rq.headers,
        postData: rq.postData || null, type: msg.params.type, timestamp: msg.params.timestamp,
        initiator: msg.params.initiator ? msg.params.initiator.stack ? (msg.params.initiator.stack.callFrames || []).slice(0, 2).map(f => f.functionName + '@' + f.url.split('/').pop() + ':' + f.lineNumber).join(' <- ') : msg.params.initiator.type : ''
      });
    } else if (msg.method === 'Network.responseReceived') {
      const r = records.get(msg.params.requestId) || { requestId: msg.params.requestId, url: msg.params.response.url };
      r.status = msg.params.response.status; r.mimeType = msg.params.response.mimeType;
      r.responseHeaders = msg.params.response.headers; r.type = r.type || msg.params.type;
      records.set(msg.params.requestId, r);
    } else if (msg.method === 'Network.loadingFinished') {
      const r = records.get(msg.params.requestId); if (r) r.encodedDataLength = msg.params.encodedDataLength;
    } else if (msg.method === 'Network.loadingFailed') {
      const r = records.get(msg.params.requestId); if (r) { r.failed = msg.params.errorText; r.blockedReason = msg.params.blockedReason; }
    } else if (msg.method === 'Log.entryAdded') {
      logs.push(msg.params.entry);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push({ source: 'console.' + msg.params.type, text: (msg.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' ') });
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Network.enable', { maxResourceBufferSize: 300 * 1024 * 1024, maxTotalBufferSize: 600 * 1024 * 1024 }, S);
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);
  await send('Log.enable', {}, S);
  await send('Page.navigate', { url: URL_TO_OPEN }, S);
  await sleep(22000);

  async function ev(expr, awaitPromise) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise }, S);
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : JSON.stringify(r.exceptionDetails) };
    return r.result.value;
  }

  const extracted = {};
  extracted.urlNow = await ev('location.href');
  // Vue 2 root instance reachable from DOM
  extracted.vueProbe = await ev(`(function(){
    var el=document.querySelector('.tv-home')||document.querySelector('#app')||document.body.firstElementChild;
    var v=el&&el.__vue__;
    if(!v) return 'NO_VUE';
    var out={};
    try{ out.rootName=v.$options.name||'(anon)'; }catch(e){}
    try{ out.routePath=v.$route&&v.$route.path; out.routeQuery=v.$route&&v.$route.query; }catch(e){}
    return out;
  })()`);

  // Walk the component tree to find the TVA component with tabA/tabB
  extracted.tvComponent = await ev(`(function(){
    var root=document.querySelector('#app');
    var v=root&&root.__vue__;
    if(!v) return 'NO_VUE_ROOT';
    var found=null;
    (function walk(c,depth){
      if(!c||found||depth>25) return;
      if(c.tabA||c.tabB){found=c;return;}
      (c.$children||[]).forEach(function(ch){walk(ch,depth+1)});
    })(v,0);
    if(!found) return 'NO_TVA';
    function slim(a){return (a||[]).map(function(x){return {channelName:x.channelName,channelCode:x.channelCode,pid:x.pid,streamId:x.streamId,channelType:x.channelType,dataType:x.dataType,isVip:x.isVip,is4K:x.is4K,isLimitedFree:x.isLimitedFree,tvLogo:x.tvLogo,viewRights:x.viewRights,payType:x.payType,programDates:x.programDates};});}
    return {tabA:slim(found.tabA),tabB:slim(found.tabB),tvIndex:(found.tvIndex&&{channelName:found.tvIndex.channelName,pid:found.tvIndex.pid,streamId:found.tvIndex.streamId})||null,nowPlayItem:found.nowPlayItem,nowDate:found.nowDate,jiemudanInfo:(found.jiemudanInfo||[]).slice(0,6),videoConfig:found.videoConfig};
  })()`);

  fs.writeFileSync(path.join(OUTDIR, 'extracted.json'), JSON.stringify(extracted, null, 1), 'utf8');
  console.log('extracted written; vueProbe=', JSON.stringify(extracted.vueProbe), 'tabA=', extracted.tvComponent && extracted.tvComponent.tabA ? extracted.tvComponent.tabA.length : extracted.tvComponent);

  // Now simulate a channel switch: click a 卫视 (tabB) channel, e.g. index 0
  const before = records.size;
  const clickRes = await ev(`(function(){
     var btns=document.querySelectorAll('.tv-main-con-r-list-left-imgb');
     if(!btns.length) return 'NO_WEISHI_BTN count='+document.querySelectorAll('.tv-main-con-r-list-left').length;
     // first switch the tab to 卫视 (index 1) by clicking the tab icon
     var tabs=document.querySelectorAll('.tv-main-con-r-tab-img');
     if(tabs[1]) tabs[1].click();
     return 'tabs='+tabs.length+' weishiBtns='+btns.length;
  })()`);
  await sleep(1500);
  const clickRes2 = await ev(`(function(){
     var btns=document.querySelectorAll('.tv-main-con-r-list-left-imgb');
     var b=btns[8]||btns[0];
     if(!b) return 'NOBTN';
     b.click();
     return 'clicked '+b.innerText.trim();
  })()`);
  await sleep(15000);
  extracted.afterClick = { clickRes, clickRes2, urlAfter: await ev('location.href') };
  extracted.tvComponentAfter = await ev(`(function(){
    var root=document.querySelector('#app');var v=root&&root.__vue__;var found=null;
    (function walk(c,depth){if(!c||found||depth>25)return;if(c.tabA||c.tabB){found=c;return;}(c.$children||[]).forEach(function(ch){walk(ch,depth+1)});})(v,0);
    if(!found) return 'NO_TVA';
    return {tvIndex:found.tvIndex&&{channelName:found.tvIndex.channelName,pid:found.tvIndex.pid,streamId:found.tvIndex.streamId},nowPlayItem:found.nowPlayItem,jiemudanInfo:(found.jiemudanInfo||[]).slice(0,6),videoConfig:found.videoConfig};
  })()`);
  fs.writeFileSync(path.join(OUTDIR, 'extracted.json'), JSON.stringify(extracted, null, 1), 'utf8');

  // dump bodies
  const BIN = path.join(OUTDIR, 'bin');
  fs.mkdirSync(BIN, { recursive: true });
  const bodies = {}; let bi = 0;
  for (const [rid, r] of records) {
    const interesting = ['XHR', 'Fetch'].includes(r.type) && /yangshipin|cctv|yspepg/i.test(r.url) && r.status >= 200 && r.status < 400;
    if (!interesting) continue;
    if (/image|video\/|font/i.test(r.mimeType || '')) continue;
    if (/\.ts(\?|$)/.test(r.url) || /\.m3u8/.test(r.url) || /\.wasm/.test(r.url)) continue;
    try {
      const b = await send('Network.getResponseBody', { requestId: rid }, S);
      const buf = b.base64Encoded ? Buffer.from(b.body, 'base64') : Buffer.from(b.body, 'utf8');
      const isText = /json|javascript|html|text|xml/i.test(r.mimeType || '');
      if (isText) { const t = buf.toString('utf8'); bodies[rid] = t.length > 500000 ? t.slice(0, 500000) + '...[TRUNC]' : t; }
      else {
        const name = String(bi++).padStart(2, '0') + '_' + r.url.replace(/[^A-Za-z0-9]+/g, '_').slice(-70) + '.bin';
        fs.writeFileSync(path.join(BIN, name), buf);
        bodies[rid] = '<<BINARY file=' + name + ' bytes=' + buf.length + ' mime=' + r.mimeType + '>>';
      }
    } catch (e) { bodies[rid] = '<<ERR ' + e.message + '>>'; }
  }
  const out = {
    url: URL_TO_OPEN, capturedAt: new Date().toISOString(),
    requests: [...records.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0)),
    bodies, logs
  };
  fs.writeFileSync(path.join(OUTDIR, 'net.json'), JSON.stringify(out, null, 1), 'utf8');
  console.log('WROTE', OUTDIR, 'requests:', out.requests.length, 'bodies:', Object.keys(bodies).length);
  try { ws.close(); } catch (e) { }
  await sleep(500); try { chrome.kill(); } catch (e) { }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
