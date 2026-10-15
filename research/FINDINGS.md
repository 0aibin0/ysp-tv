# 央视频 (yangshipin.cn) — TV channel lineup, programme API, and in-place channel switching

Reverse-engineered from live traffic (headless Chrome + CDP) and the SPA bundles.
All findings below are backed by raw captures in this directory.

## Evidence artifacts

| File | What it is |
|---|---|
| `home-dom.html` | Saved rendered DOM of `/tv/home` (input) |
| `js/app.40ff9730.js` | SPA app bundle (API layer, protobuf schemas, Vue routes) |
| `js/chunk-1ea03fe6.4dff15d2.js` | **The TV page component** (`tv-home` / `TVA`) — channel switching, EPG rendering |
| `js/chunk-676e57b6.2e3e1313.js` | Shared page chunk (header/footer; no TV logic) |
| `js/chunk-vendors.86ef4b5a.js` | Vendors: player SDK, `getSdkData` signing, `hex_md5` |
| `js/cctvh5-openapi.min.js` | Loader for `cctvh5-openapicore` (WASM signing) |
| `capture/net-tvhome.json` | CDP capture #1 — `/tv/home` traffic, 258 requests |
| `capture2/net.json`, `capture2/bin/*.bin` | CDP capture #2 — incl. **raw protobuf bodies** + a real channel switch |
| `capture2/extracted.json` | **Live Vue component state**: full `tabA`/`tabB` with pid + streamId |
| `capture4/m3u8.json`, `capture4/seg.ts` | Live m3u8 + a real 2 MB TS segment |
| `capture5/xhr-cap.json` | Intercepted player XHRs with exact headers/bodies |
| `capture7/urlforms.json` | Proof both URL forms select the channel |
| `channels-48.json` / `.csv` | **The deliverable 48-entry channel list** |
| `scan/reference-client.js` | **Runnable no-browser client** for channel list + EPG + "now playing" |
| `scan/pb.js` | Dependency-free protobuf decoder used for all schema work |

Reproduce the key results:

```powershell
node research\scan\reference-client.js     # channel list + EPG + current programme, no browser
node research\scan\cdp2.js "https://www.yangshipin.cn/tv/home" research\capture2   # full capture + switch
```

---

## 1. Channel lineup — 48 entries

**Source of truth:** live `Component.tabA` / `Component.tabB` read out of the running Vue instance
(`capture2/extracted.json`), which is the exact array the DOM renders from.

The list is **not** hard-coded in any JS bundle — it is fetched at runtime. Provenance chain:

1. `chunk-676e57b6…js` mounts the `tv-home` route component, which requests page id `PG00000004`.
2. `GET https://capi.yangshipin.cn/api/oms/pc/page/PG00000004` returns **protobuf** (`application/octet-stream`).
3. Module `03ef` in `app.40ff9730.js` decodes it; the schema is declared in the same bundle:
   `ModuleData.dataTvChannelList (id 15) : repeated TvChannelListData`
4. `TvChannelListData = {1:dataType, 2:channelName, 3:channelCode, 4:pid, 5:tvLogo, 6:streamId, 7:isVip, 8:is4K, 9:timeShiftReviewFlag, 10:programDates, 11:channelType, …}`
5. The component splits them: `"yangshi"==t.channelType && i.push(t)`, `"weishi"==t.channelType && s.push(t)`
   → `tabA` (央视) and `tabB` (卫视) — *`chunk-1ea03fe6…js` @~7470*

The live list contains **73 channels: 40 `yangshi` + 33 `weishi`**.
`channels-48.json` holds the 48 requested (CCTV-1…17 + 31 provincial 卫视).

### Notes on composing the 48
- **CCTV-16**: the site offers `CCTV16-HD` (plain, `pid=600098637`) and `CCTV16(4K）` (`pid=600099502`).
  The plain one is used, per the "prefer the plain SD/HD main one" rule.
- **CCTV-5+** exists (`pid=600001817`) but is outside the 1–17 numbering, so it is not one of the 17.
  Other extras present in `tabA`: `CCTV4K` (600002264), `CCTV8K` (600156816), 6× CGTN, 13× CCTV pay channels.
- **`tabB` has 33 entries, not 31.** The 31 provincial 卫视 are all present, plus two that are not provincial:
  - `深圳卫视` (`pid=600002481`) — sub-provincial city channel
  - `中国教育电视台1频道` (`pid=600171827`) — CETV-1, national education channel
  Both are **excluded** from the 31 rather than silently padding the count. For an Android TV app you
  almost certainly want all 33 — they are listed in `channels-raw.json`.

### The 48 entries (`channels-48.json`)

```json
[
 {"no":"CCTV-1","name":"CCTV1","pid":"600001859","streamId":"2024078201","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001859"},
 {"no":"CCTV-2","name":"CCTV2","pid":"600001800","streamId":"2024075401","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001800"},
 {"no":"CCTV-3","name":"CCTV3","pid":"600001801","streamId":"2024068501","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001801"},
 {"no":"CCTV-4","name":"CCTV4","pid":"600001814","streamId":"2029797101","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001814"},
 {"no":"CCTV-5","name":"CCTV5","pid":"600001818","streamId":"2024078401","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001818"},
 {"no":"CCTV-6","name":"CCTV6","pid":"600108442","streamId":"2013693901","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600108442"},
 {"no":"CCTV-7","name":"CCTV7","pid":"600004092","streamId":"2024072001","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600004092"},
 {"no":"CCTV-8","name":"CCTV8","pid":"600001803","streamId":"2029793001","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001803"},
 {"no":"CCTV-9","name":"CCTV9","pid":"600004078","streamId":"2024078601","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600004078"},
 {"no":"CCTV-10","name":"CCTV10","pid":"600001805","streamId":"2024078701","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001805"},
 {"no":"CCTV-11","name":"CCTV11","pid":"600001806","streamId":"2027248701","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001806"},
 {"no":"CCTV-12","name":"CCTV12","pid":"600001807","streamId":"2027248801","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001807"},
 {"no":"CCTV-13","name":"CCTV13","pid":"600001811","streamId":"2029797201","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001811"},
 {"no":"CCTV-14","name":"CCTV14","pid":"600001809","streamId":"2027248901","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001809"},
 {"no":"CCTV-15","name":"CCTV15","pid":"600001815","streamId":"2027249001","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001815"},
 {"no":"CCTV-16","name":"CCTV16-HD","pid":"600098637","streamId":"2027249101","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600098637"},
 {"no":"CCTV-17","name":"CCTV17","pid":"600001810","streamId":"2027249401","channelType":"yangshi","url":"https://www.yangshipin.cn/tv/home?pid=600001810"},
 {"no":"北京","name":"北京卫视","pid":"600002309","streamId":"2024052703","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002309"},
 {"no":"江苏","name":"江苏卫视","pid":"600002521","streamId":"2024171103","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002521"},
 {"no":"东方","name":"东方卫视","pid":"600002483","streamId":"2024054503","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002483"},
 {"no":"浙江","name":"浙江卫视","pid":"600002520","streamId":"2024054703","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002520"},
 {"no":"湖南","name":"湖南卫视","pid":"600002475","streamId":"2024054803","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002475"},
 {"no":"湖北","name":"湖北卫视","pid":"600002508","streamId":"2024171203","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002508"},
 {"no":"广东","name":"广东卫视","pid":"600002485","streamId":"2024060903","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002485"},
 {"no":"广西","name":"广西卫视","pid":"600002509","streamId":"2024060703","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002509"},
 {"no":"黑龙江","name":"黑龙江卫视","pid":"600002498","streamId":"2029797003","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002498"},
 {"no":"海南","name":"海南卫视","pid":"600002506","streamId":"2024055603","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002506"},
 {"no":"重庆","name":"重庆卫视","pid":"600002531","streamId":"2024061103","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002531"},
 {"no":"四川","name":"四川卫视","pid":"600002516","streamId":"2024061403","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002516"},
 {"no":"河南","name":"河南卫视","pid":"600002525","streamId":"2029797303","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002525"},
 {"no":"福建","name":"福建东南卫视","pid":"600002484","streamId":"2024061503","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002484"},
 {"no":"贵州","name":"贵州卫视","pid":"600002490","streamId":"2024061603","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002490"},
 {"no":"江西","name":"江西卫视","pid":"600002503","streamId":"2024061703","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002503"},
 {"no":"辽宁","name":"辽宁卫视","pid":"600002505","streamId":"2024171303","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002505"},
 {"no":"安徽","name":"安徽卫视","pid":"600002532","streamId":"2024171403","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002532"},
 {"no":"河北","name":"河北卫视","pid":"600002493","streamId":"2024171503","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002493"},
 {"no":"山东","name":"山东卫视","pid":"600002513","streamId":"2029787903","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600002513"},
 {"no":"天津","name":"天津卫视","pid":"600152137","streamId":"2019927003","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600152137"},
 {"no":"吉林","name":"吉林卫视","pid":"600190405","streamId":"2025561503","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190405"},
 {"no":"陕西","name":"陕西卫视","pid":"600190400","streamId":"2029795103","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190400"},
 {"no":"甘肃","name":"甘肃卫视","pid":"600190408","streamId":"2025561703","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190408"},
 {"no":"宁夏","name":"宁夏卫视","pid":"600190737","streamId":"2025608503","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190737"},
 {"no":"内蒙古","name":"内蒙古卫视","pid":"600190401","streamId":"2025561203","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190401"},
 {"no":"云南","name":"云南卫视","pid":"600190402","streamId":"2025561303","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190402"},
 {"no":"山西","name":"山西卫视","pid":"600190407","streamId":"2025560803","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190407"},
 {"no":"青海","name":"青海卫视","pid":"600190406","streamId":"2025559103","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190406"},
 {"no":"西藏","name":"西藏卫视","pid":"600190403","streamId":"2025558003","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600190403"},
 {"no":"新疆","name":"新疆卫视","pid":"600152138","streamId":"2019927403","channelType":"weishi","url":"https://www.yangshipin.cn/tv/home?pid=600152138"}
]
```

`streamId` is the **player-level id** (`cnlid`); `pid` is the **channel id**. Both are needed for playback
(see §4). The `url` field is the canonical deep link and is verified working (§3).

---

## 2. Current-programme API

### 2.1 Endpoint

```
GET https://capi.yangshipin.cn/api/yspepg/program/{pid}/{YYYYMMDD}
```

Path-only, no query string. `{pid}` is the channel pid from §1; `{YYYYMMDD}` is the air date.

Derivation, three agreeing sources:
- live capture: `capture2/net.json` → `https://capi.yangshipin.cn/api/yspepg/program/600001859/20261013`
- call site: `app.40ff9730.js` @17431 —
  `function Y(t,e){return x(4,"".concat(t).concat(e?"/"+e:""),"getJiemudanInfo","","cn.yangshipin.omstv.common.proto.epgProgramModel.Response")}`
- base URL: `app.40ff9730.js` @~8186 — prod `A[4] = "https://capi.yangshipin.cn/api/yspepg/program/"`

The base URL is selected from a 5-element array by build mode (`test=on` / `preview=on` /
`prerelease=on` / `vpnpreview=on`); the *4th* slot is the EPG host. Prod = `capi.yangshipin.cn`.

### 2.2 Headers — none required

Verified from a bare PowerShell client (`scan/apitest.ps1`):

```
TEST A: EPG with NO custom headers at all (raw, no Referer) => STATUS: 200 LEN: 2948
```

No cookie, no Referer, no Origin, no `yspappid`, no signature, no login. The only thing the browser
adds is `Referer: https://www.yangshipin.cn/`, and it is **not enforced**.

Response headers show why it is so open — it is a static object on Tencent COS:

```
Content-Type: application/octet-stream
Access-Control-Allow-Origin: https://www.yangshipin.cn
Server: tencent-cos
X-Cache-Lookup: Cache Hit
```

Note the CORS header is pinned to `https://www.yangshipin.cn` — browsers block `fetch` from other
origins, but a native Android client is not subject to CORS.

### 2.3 Response format — protobuf, not JSON

`Content-Type: application/octet-stream`, no JSON layer. Schema declared in `app.40ff9730.js` @126525:

```
omstv.common.proto.epgProgramModel.Response {
  code       uint32   id=1
  dataList   repeated Program id=2
  message    string   id=3
  updateTime uint64   id=4
}
omstv.common.proto.Program {
  programId           string id=1
  name                string id=2   <-- PROGRAMME TITLE
  st                  uint64 id=3   (start, epoch seconds)
  et                  uint64 id=4   (end, epoch seconds)
  startTime           string id=5   ("HH:MM")
  endTime             string id=6   ("HH:MM")
  duration            uint32 id=7   (seconds)
  isVip               bool   id=8
  copyrightFlag       string id=9
  timeShiftReviewFlag string id=10
}
```

**Programme-title field path: `Response.dataList[].name` (proto field 2 of `Program`).**

### 2.4 Real sample

Raw bytes (`capture2/bin/05_…_600001859_20261013.bin`) decoded with `scan/pb.js`:

```
FILE: capture2/bin/05_https_capi_yangshipin_cn_api_yspepg_program_600001859_20261013.bin bytes: 2948
1: 200
2: { message len=94 }
  1: "22555906" (len 8)
  2: "生活早参考-特别节目(生活圈)2026-280" (len 47)
  3: 1791823740
  4: 1791826380
  5: "00:49" (len 5)
  6: "01:33" (len 5)
  7: 2640
  9: "1" (len 1)
  10: "1" (len 1)
...
3: "成功" (len 6)
4: 1791874201
```

As JSON (what the SPA itself holds in `jiemudanInfo`, from `capture2/extracted.json`):

```json
{ "code": 200,
  "dataList": [
    { "programId": "22555906", "name": "生活早参考-特别节目(生活圈)2026-280",
      "st": 1791823740, "et": 1791826380, "startTime": "00:49", "endTime": "01:33",
      "duration": 2640, "copyrightFlag": "1", "timeShiftReviewFlag": "1" },
    { "programId": "22555907", "name": "晚间新闻",
      "st": 1791826380, "et": 1791828195, "startTime": "01:33", "endTime": "02:03",
      "duration": 1815, "copyrightFlag": "1", "timeShiftReviewFlag": "1" }
  ],
  "message": "成功", "updateTime": 1791874201 }
```

### 2.5 "Currently playing" is computed client-side

The API has **no** "is now playing" flag. The SPA computes it. Reproduced verbatim from
`chunk-1ea03fe6.d66fc12e.js` @~7500 (`function u`) and @~11424 (`setPoll`):

```js
function u(t, e, n, a, i) {           // t=dataList, n=selectedDate, a=today, i=nowHHMM
  var s = "";                          // s = the "now playing" programme name
  if (n == a && t.forEach((e, n) => {  // selected day == today
        if (n == t.length - 1) {       // last programme of the day
          i >= d(e) ? (e.sta = 2, s = e.name) : e.sta = 3;
        } else if (i >= d(e) && i < d(t[n + 1])) {
          e.sta = 2; s = e.name;       // sta=2  => currently airing
        } else {
          e.sta = i >= d(e) ? 1 : 3;   // sta=1  => already aired, sta=3 => upcoming
        }
      }),
      n > a) t.forEach(t => { t.sta = 3 });        // future day: all upcoming
  if (n < a) { /* past day: sta=1 or last=2 */ }
  return { arr: t, nowJiemu: s };
}
function d(t) { return parseInt(t.startTime.split(":")[0] + t.startTime.split(":")[1]); }
```

`sta == 2` marks the live programme. `nowJiemu` is the title the UI shows in `.tv-zhan-title`.
`d()` compares `"HH:MM"` as an integer (`"01:33"` → `133`), **not** as minutes — careful when porting.

`nowDate`/`nowTime` come from a server-time endpoint so client clock skew cannot break it:

```
GET https://csapi.yangshipin.cn/voapi/omsot/serverTime

08 c8 01 | 12 07 | 08 e1 b9 a1 a0 93 34 | 1a 06 "成功"
 code=200   data   ts = 1791874325729 (MILLISECONDS)   message="成功"
```

`scan/reference-client.js` implements all of this and was run successfully:

```
serverTime = 1791875059  today = 20261013  nowHHMM = 1504

CCTV1     pid=600001859  code=200 programs=38  NOW PLAYING = "人世间第18集"
CCTV13    pid=600001811  code=200 programs=34  NOW PLAYING = "新闻直播间"
湖南卫视  pid=600002475  code=200 programs=33  NOW PLAYING = "偶像独播剧场:爱情不打烊"
新疆卫视  pid=600152138  code=200 programs=34  NOW PLAYING = "天山剧场:走西口(54)"
```

### 2.6 Supporting APIs (all open, all protobuf)

| Endpoint | Purpose |
|---|---|
| `https://capi.yangshipin.cn/api/oms/pc/page/PG00000004` | The `/tv/home` channel list (`dataTvChannelList`) |
| `https://capi.yangshipin.cn/api/oms/pc/navigation/home_top_nav` | Top nav menu |
| `https://capi.yangshipin.cn/api/oms/pc/config` | PC app config (15 bytes) |
| `https://csapi.yangshipin.cn/voapi/omsot/serverTime` | Server clock |
| `https://csapi.yangshipin.cn/voapi/omsot/live/playinfo?pid=<pid>` | Live play info (returns `直播pid不存在`, unused on this page) |

All five returned **200 with no headers**, including with no `Referer` (`scan/apitest.ps1`).

---

## 3. In-place channel switching

### 3.1 URL format

```
https://www.yangshipin.cn/tv/home?pid={pid}
```

`{pid}` is the channel pid. **Both** these forms work — `/tv?pid=…` 302-equivalents into `/tv/home?pid=…`
via the router's `redirect` (verified, `capture7/urlforms.json`):

```
short /tv?pid        -> {"href":"https://www.yangshipin.cn/tv/home?pid=600002475",
                         "routePath":"/tv/home","routeQuery":{"pid":"600002475"},
                         "channel":"湖南卫视","pid":"600002475",
                         "now":"偶像独播剧场:爱情不打烊","selectIndex":1}
long  /tv/home?pid   -> (identical)
```

`selectIndex: 1` also confirms the app auto-switches to the 卫视 tab when the pid belongs to `tabB`.

Route definition — `app.40ff9730.js` @107877:

```js
{ path: "/tv",
  component: () => Promise.all([n.e("chunk-676e57b6"), n.e("chunk-2f54d17e")]).then(n.bind(null, "a193")),
  redirect: "/tv/home",
  children: [ { path: "home",
                component: () => Promise.all([n.e("chunk-71d9f9a0"), n.e("chunk-1fbb0408"),
                                              n.e("chunk-12d35a28"), n.e("chunk-1ea03fe6")])
                               .then(n.bind(null, "005a")) } ] }
```

So the TV page is chunk **`chunk-1ea03fe6`**, module id `005a`, Vue component name **`tv-home`**
(inner list component is `TVA`, `data-v-29965556`).

### 3.2 The switch function — `changeTV`

`chunk-1ea03fe6.4dff15d2.js` @11424:

```js
changeTV: function (t) {
  t.pid !== this.tvIndex.pid && (
    this.currentIndex = this.selectIndex,
    this.tvIndex = t,
    this.$router.replace({ query: g()(this.$route.query, { pid: t.pid }) }, function () {}, function () {}),
    this.jiemudanInfo = null,
    this.init()
  )
}
```

Mechanism, precisely:

1. **No page reload.** `this.$router.replace(...)` (Vue Router, history mode) swaps only the query
   string; the component instance is reused.
2. Query merged with the lodash-style helper `g()` = `n("7ce2")`, so other query keys survive.
3. `this.tvIndex = t` repoints the component at the new channel object.
4. `this.init()` re-runs: fetches server time, calls `setTvConfig(...)` → replaces `videoConfig`,
   and `getInit(pid, nowDate)` → re-fetches the EPG.

`setTvConfig` @11424 hands a new object to `<live-player :videoConfig>`; the player keys off
`watch: videoConfig (deep)` and re-runs its auth/get_live_info flow — this is why switching is instant
and the `<video>` keeps its `blob:` src.

State fields it drives: `tvIndex`, `currentIndex`, `selectIndex`, `jiemudanInfo`, `videoConfig`,
`nowPlayItem`.

### 3.3 Deep-link entry — `created()`

`chunk-1ea03fe6.4dff15d2.js` @7933:

```js
created: function () {
  n = l(t.sourceData.dataTvChannelList, t.nowDate),   // split into [tabA, tabB]
  t.tvTabs = n, t.tabA = n[0], t.tabB = n[1],
  a = t.$route.query.pid,                              // <-- reads pid from the query
  a ? t.tvTabs.forEach(function (e, n) {
        e.forEach(function (e, i) {
          e.pid == a && (t.currentIndex = n, t.selectIndex = n, t.tvIndex = t.tvTabs[t.currentIndex][i])
        })
      })
    : t.tvIndex = t.tvTabs[t.currentIndex][0],         // default = CCTV1
  t.init()
}
```

The pid is matched by **string equality** against the runtime channel list — it is not resolved
server-side and there is no per-pid route. Consequence for Android TV: `?pid=` is a soft hint.
If a pid is retired from the list, the page silently falls back to `CCTV1` with no error.

**Canonical per-channel URL:** `https://www.yangshipin.cn/tv/home?pid={pid}` (in the `url` field of
`channels-48.json`).

### 3.4 No JSONP and no IPC/JSBridge

Explicitly checked — there is **no** JSONP endpoint and **no** native-bridge channel:

- `jsonp|callback=` → 0 real matches in `app.40ff9730.js`; `callback=?|jsonpCallback` → 0 in vendors.
- `postMessage|JSBridge|webkit|invoke` in `cctvh5-openapi.min.js` → only a Babel/regenerator
  polyfill, no bridge.
- `postMessage|JSBridge|window.CCTV` in `app.40ff9730.js` → **0 matches**.

All data flows over `XMLHttpRequest` (axios) to the REST-ish URLs above. `cctvh5-openapi` is only a
lazy script loader — `cctvh5-openapi.min.js` @13093:

```js
var h="cctvh5-openapicore", d="cctvh5-openapicore-pm";
… t+"/CCTVVideo/cctvh5-openapicore/cctvh5-openapicore.min.js?ts="+e …
```

There is also a legacy `<script>` trio (`zepto.min.js`, `cctvh5-openapi.min.js`, `cctvh5-trace.min.js`)
and a **non-API** telemetry POST to `https://btrace.yangshipin.cn/kvcollect?BossId=8186` — that is
analytics (BossId 3101/8186/8190/8240), not programme data.

---

## 4. What blocks playback from a non-browser client

### 4.1 The two open APIs are genuinely open

Channel list and EPG need **no auth at all** — verified from bare PowerShell with no headers.
You can build the entire channel picker + programme guide with zero reverse-engineered auth.

### 4.2 Playback requires a signature you cannot easily forge

To turn a `pid` into a stream URL the player does a two-step handshake
(`chunk-vendors.86ef4b5a.js` @1430776, `function nu`):

**Step 1 — auth (POST form):**
```
POST https://player-api.yangshipin.cn/v1/player/auth
Content-Type: application/x-www-form-urlencoded;charset=UTF-8
yspappid: 519748109

pid=600001859&guid=<guid>&appid=ysp_pc&rand_str=<10 random chars>&signature=<32 hex>
-> {"code":0,"msg":"ok","data":{"token":"…","ts":"1791874326"}}
```

**Step 2 — get stream (POST JSON):**
```
POST https://player-api.yangshipin.cn/v1/player/get_live_info
yspappid: 519748109
yspPlayerToken: <token from step 1>
yspticket: <32-hex derived from pid+ts+cnlid+guid>
yspsdkinput: <md5 of the JSON body, keys sorted>
yspsdksign: <openapi_signature>-<yspsdkinput>-<guid>-<seqId>-<request-id>
seqId, request-id: <sequence counters>

{"cnlid":"2024078201","livepid":"600001859","stream":"2","guid":"…","cKey":"--01<hex>",
 "adjust":1,"sphttps":"1","platform":"5910204","cmd":"2","encryptVer":"8.1","dtype":"1",
 "devid":"devid","otype":"ojson","appVer":"V1.0.0","app_version":"V1.0.0","channel":"ysp_tx",
 "defn":"fhd","rand_str":"…","signature":"…"}
```

Verified failure modes (no login, no credentials used — `scan/q15.ps1`):

```
auth-nosig  => {"code":10012,"msg":"请求异常","data":{"code":-1}}
auth-badsig => {"code":10012,"msg":"请求异常","data":{"code":-1}}
auth-nohdr  => {"code":10012,"msg":"请求异常","data":{"code":-1}}
live-nohdr  => {"code":10012,"msg":"请求异常","data":{"code":-1}}
```

**Blocking mechanism — plain statement:**

- The `signature` on `/v1/player/auth` is an **MD5-style 32-hex digest over a keyed secret** that is
  assembled by **string-decryption** at runtime: `chunk-vendors.86ef4b5a.js` @444667 and @1416787
  build it with `String.fromCharCode(<const> ^ <charCode>)` loops over XOR-obfuscated literals
  (`"됪"+"…"`, `"ꖮꖿꖿꖁ"+"…"`, `"⊫"+"⊩⊠⊳⊯"`). It is **not** a plain literal anywhere in the bundle.
- I brute-forced the recovered plaintext/ciphertext pairs against md5/sha1/sha256, with and without a
  suffix secret, over ~11 field orderings and ~19 candidate secrets — **0 hits**
  (`scan/crack.js`, `scan/crack2.js`). The secret is not any value that appears literally in the bundles.
- The `yspsdksign` half comes from **WebAssembly**: `cctvh5-openapicore/keygen_bg.wasm`. The JS wrapper
  is `cctvh5-openapi.min.js` (v2.0.1), whose `getSignature({yspappid, input})` is a genuine native
  function. Confirmed **deterministic and pure** (`capture5/sign.json`):

  ```
  sign("HELLO-WORLD-TEST-1") appid=519748109 -> e12c5da7fe5d516f93ce2580ebe838c9-HELLO-WORLD-TEST-1
  sign("HELLO-WORLD-TEST-1") again           -> e12c5da7fe5d516f93ce2580ebe838c9  (identical)
  sign("HELLO-WORLD-TEST-2")                 -> 0fda832b98b33ee2ee5b89ae0af540fd
  sign("HELLO-WORLD-TEST-1") appid=130004109 -> db1c2b2ef5ca06ed0e0eaf282a4abc2c  (appid changes result)
  ```

  So it *is* callable with arbitrary input, but it is **not MD5 of the input** — I tested
  `md5(input)`, `md5(appid+input)`, `md5(input+appid)`, `md5` with `|`/`-`/`&`/`key=value` framings,
  plus HMAC-MD5/SHA1/SHA256 over ~19 keys. **0 hits.** The algorithm lives in the WASM binary.

**Practical consequence:** there is **no browser-free path to a playable stream URL** that I could
establish. A correct implementation needs either
(a) the WASM signing module (`cctvh5-openapicore`) shipped into the app and driven from JS/NDK, or
(b) a WebView that loads the real page and lets its own JS do the handshake, then read the resulting
`playurl`.

### 4.3 Once you HAVE the stream URL, nothing else blocks you

This is the important, non-obvious result. I captured a live m3u8 and replayed it from **plain Node
`https`, with no headers at all** (`scan/cdp4.js`, `scan/ts.js`):

```
=== replay from plain Node https, NO headers ===
status: 200   bytes: 890
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-ALLOW-CACHE:NO
#EXT-X-TARGETDURATION:5
#EXT-X-MEDIA-SEQUENCE:1786111950
#EXTINF:5.000,
2024078203_web-1786111950.ts?from=player&svrtime=1791874610&pid=600001859&cdn=5505&…
```

A full segment fetched the same way:

```
ts status 200  bytes 2037732  ctype application/octet-stream
CORS: *
first 32 bytes hex: 47 40 00 10 00 00 b0 0d 00 01 c1 00 00 00 01 f0 01 2e 70 19 05 ff …
first byte 0x47 (MPEG-TS sync)? true
188-byte sync hits: 10839 of 10839
```

Concretely:

- **No DRM.** `#EXT-X-KEY` / `#EXT-X-SESSION-KEY`: **absent**. `video.mediaKeys`: `none`. No EME
  (`navigator.requestMediaKeySystemAccess` exists as a browser API but is never used by the player).
- **No AES-128 / SAMPLE-AES.** The segment is byte-for-byte a **plain MPEG-TS**: 10 839 of 10 839
  possible 188-byte offsets carry the `0x47` sync byte, and the payload starts with a normal PAT
  (`47 40 00 10 … b0 0d …`). The `"encrypt":2` field in `get_live_info` is the *transport/obfuscation
  flag for the player's own loader*, not container encryption — the bytes on the wire are vanilla TS.
- **No hotlink protection.** Same URL with no `Referer`, no `Origin`, no cookie, no UA → 200.
  `Access-Control-Allow-Origin: *`.
- **URL is not single-use and not short-lived.** Captured at 06:56 UTC, replayed at 07:02 UTC → still
  200, and it was **still live**: the playlist had advanced (`#EXT-X-MEDIA-SEQUENCE` 1786111947 →
  1786112006, `PROGRAM-DATE-TIME` tracking real time). So `ysign`/`ytime` gate URL *issuance*, not
  each fetch.
- The URL is a signed CDN path with an embedded `vkey`: `https://<cdn>/<128-hex vkey>/<cnlid>_web.m3u8
  ?from=player&svrtime=…&pid=…&cdn=…&ysign=…&ytime=…&ytype=1`. `get_live_info` returns it as `playurl`
  plus a `backurl_list[0].url` fallback on a different CDN.

**CORS caveat for a browser-based approach:** the EPG host sends
`Access-Control-Allow-Origin: https://www.yangshipin.cn` (pinned, not `*`), so in-page cross-origin
`fetch` of the EPG is fine but a different web origin is not. The CDN sends `*`. A native Android
client ignores CORS entirely.

### 4.4 Summary of blockers

| Concern | Status |
|---|---|
| Channel list API | ✅ Open — no auth, no headers |
| EPG / programme API | ✅ Open — no auth, no headers |
| Server time API | ✅ Open |
| Deep link `?pid=` | ✅ Works, no login |
| Getting a **stream URL** | ❌ Blocked — WASM + XOR-obfuscated-secret signatures. Not solved here. |
| The stream itself (m3u8/TS) | ✅ Clear MPEG-TS, no DRM, no key, no hotlink check, `ACAO: *` |
| Pay/VIP channels | 13 `tabA` entries are `isVip:true`/`payType:"880"` — expect a paywall |
| Region | Untested; servers reachable from this network without a proxy |

**Honest gap:** I did **not** recover the `player/auth` signature secret or the WASM signing algorithm.
Both are obfuscated (runtime XOR string decryption + WASM), and my brute-force over all plausible
plaintext orderings and candidate secrets produced zero hits. I am reporting this as unresolved rather
than guessing. Everything else above is verified against captured bytes.
