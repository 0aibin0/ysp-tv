#!/usr/bin/env node
/**
 * Yangshipin (央视频) current-programme reference client — NO browser required.
 *
 * Evidence base (see ../research for raw captures):
 *  - Channel list : GET https://capi.yangshipin.cn/api/oms/pc/page/PG00000004 -> protobuf
 *                   PageModel.ModuleData.dataTvChannelList (tvChannelListModel)
 *  - EPG          : GET https://capi.yangshipin.cn/api/yspepg/program/{pid}/{YYYYMMDD} -> protobuf
 *                   omstv.common.proto.epgProgramModel.Response
 *  - Server time  : GET https://csapi.yangshipin.cn/voapi/omsot/serverTime -> protobuf
 *  - Both open APIs answer 200 with NO cookies, NO Referer and NO signature.
 *
 * The "currently playing" flag is the site's own logic
 * (chunk-1ea03fe6.d66fc12e.js, function `u`), reproduced in pickNowPlaying().
 */
const http = require('http');
const https = require('https');

const EPG_BASE = 'https://capi.yangshipin.cn/api/yspepg/program/';
const TIME_URL = 'https://csapi.yangshipin.cn/voapi/omsot/serverTime';
const PAGE_URL = 'https://capi.yangshipin.cn/api/oms/pc/page/PG00000004';

// ---------- minimal protobuf wire reader (no deps) ----------
function readVarint(b, p) { let r = 0n, s = 0n, x; do { x = b[p++]; r |= BigInt(x & 0x7f) << s; s += 7n; } while (x & 0x80); return [r, p]; }
function fields(b) {
  const out = []; let p = 0;
  while (p < b.length) {
    let tag; [tag, p] = readVarint(b, p);
    const wt = Number(tag & 7n), fn = Number(tag >> 3n);
    if (wt === 0) { let v; [v, p] = readVarint(b, p); out.push({ fn, wt, v }); }
    else if (wt === 2) { let l; [l, p] = readVarint(b, p); out.push({ fn, wt, v: b.subarray(p, p + Number(l)) }); p += Number(l); }
    else if (wt === 5) { out.push({ fn, wt, v: b.readFloatLE(p) }); p += 4; }
    else if (wt === 1) { out.push({ fn, wt, v: b.readDoubleLE(p) }); p += 8; }
    else throw new Error('bad wiretype ' + wt + ' at ' + p);
  }
  return out;
}
const num = (fs, n) => { const f = fs.find(x => x.fn === n); return f ? Number(f.v) : undefined; };
const str = (fs, n) => { const f = fs.find(x => x.fn === n); return f ? f.v.toString('utf8') : undefined; };
const all = (fs, n) => fs.filter(x => x.fn === n);

// ---------- HTTP ----------
function getBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET' }, r => {
      const c = []; r.on('data', d => c.push(d));
      r.on('end', () => resolve({ status: r.statusCode, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// ---------- API ----------
async function getServerTime() {
  // serverTime.Response { code=1(uint32), data=2(Data), message=3(string) }
  // data.Data { ts=1(uint64) } -- MILLISECONDS, verified against the captured frame
  // 08 c8 01 | 12 07 | 08 e1 b9 a1 a0 93 34 | 1a 06 "成功"
  const r = await getBuffer(TIME_URL);
  const top = fields(r.body);
  const data = all(top, 2)[0];
  return Math.floor(Number(num(fields(data.v), 1)) / 1000); // -> seconds
}
async function getEpg(pid, yyyymmdd) {
  const r = await getBuffer(EPG_BASE + pid + '/' + yyyymmdd);
  if (r.status !== 200) throw new Error('EPG HTTP ' + r.status + ' for pid ' + pid);
  const top = fields(r.body);
  return { code: num(top, 1), message: str(top, 3), updateTime: num(top, 4),
    programs: all(top, 2).map(p => {
      const g = fields(p.v);
      return { programId: str(g, 1), name: str(g, 2), st: num(g, 3), et: num(g, 4),
        startTime: str(g, 5), endTime: str(g, 6), duration: num(g, 7),
        isVip: num(g, 8) === 1, copyrightFlag: str(g, 9), timeShiftReviewFlag: str(g, 10) };
    }) };
}
async function getChannelList() {
  const r = await getBuffer(PAGE_URL);
  const top = fields(r.body);
  const data = fields(all(top, 2)[0].v);
  const channels = [];
  for (const mod of all(data, 2)) {            // ModuleData
    const m = fields(mod.v);
    for (const c of all(m, 15)) {              // dataTvChannelList (TvChannelListData)
      const g = fields(c.v);
      channels.push({ dataType: str(g, 1), channelName: str(g, 2), channelCode: str(g, 3),
        pid: str(g, 4), tvLogo: str(g, 5), streamId: str(g, 6), isVip: num(g, 7) === 1,
        is4K: num(g, 8) === 1, programDates: all(g, 10).map(x => x.v.toString('utf8')),
        channelType: str(g, 11) });
    }
  }
  return channels;
}

// ---------- site's own "currently playing" logic (chunk-1ea03fe6, function `u`) ----------
const hhmm = prog => parseInt(prog.startTime.split(':')[0] + prog.startTime.split(':')[1], 10);
function pickNowPlaying(programs, selectedDate, today, nowHHMM) {
  let nowName = '';
  if (selectedDate === today) {
    programs.forEach((p, i) => {
      if (i === programs.length - 1) { if (nowHHMM >= hhmm(p)) { p.sta = 2; nowName = p.name; } else p.sta = 3; }
      else if (nowHHMM >= hhmm(p) && nowHHMM < hhmm(programs[i + 1])) { p.sta = 2; nowName = p.name; }
      else p.sta = nowHHMM >= hhmm(p) ? 1 : 3;
    });
  } else if (selectedDate > today) { programs.forEach(p => p.sta = 3); }
  else { programs.forEach(p => p.sta = nowHHMM >= hhmm(programs[0]) ? 1 : 3); }
  return nowName;
}
const todayStr = epochSec => { const d = new Date(epochSec * 1000); const z = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`; };

// ---------- demo ----------
(async () => {
  const serverNow = await getServerTime();
  const today = todayStr(serverNow);
  const d = new Date(serverNow * 1000);
  const nowHHMM = (d.getHours() < 10 ? '0' : '') + d.getHours() + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  console.log(`serverTime = ${serverNow}  today = ${today}  nowHHMM = ${nowHHMM}`);

  const list = await getChannelList();
  console.log(`channel list from page/PG00000004 : ${list.length} entries`);
  console.log('  sample:', JSON.stringify(list.find(c => c.channelName === 'CCTV1')));

  for (const name of ['CCTV1', 'CCTV13', '湖南卫视', '新疆卫视']) {
    const ch = list.find(c => c.channelName === name);
    if (!ch) { console.log(`\n${name}: NOT IN LIST`); continue; }
    const epg = await getEpg(ch.pid, today);
    const now = pickNowPlaying(epg.programs, today, today, nowHHMM);
    console.log(`\n${name}  pid=${ch.pid}  streamId=${ch.streamId}  url=https://www.yangshipin.cn/tv/home?pid=${ch.pid}`);
    console.log(`  code=${epg.code} programs=${epg.programs.length}  NOW PLAYING = "${now}"`);
    console.log(`  programme title field path: Response.dataList[].name  (proto field 2 of Program)`);
  }
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
