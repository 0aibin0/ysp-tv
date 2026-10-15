# 央视频电视直播 (YspTv)

把央视频网页直播页 `https://www.yangshipin.cn/tv/home` 做成一个安卓电视直播 App。

**成品**：`dist/YspTv-live.apk`（62 KB，已签名，可直接安装）

---

## 一、怎么装到电视上

APK 已经用 v1 + v2 + v3 三种方式签名，Android 5.0（API 21）到 Android 14 都能装。

### 方法 A：U 盘安装（最省事，推荐）

1. 把 `YspTv-live.apk` 拷到 U 盘根目录。
2. U 盘插到电视上，用电视自带的「文件管理 / 媒体中心」找到这个文件。
3. 点它安装。第一次会提示「禁止安装未知来源应用」，去 **设置 → 安全 → 未知来源** 允许一下再装。

### 方法 B：adb 安装（电脑和电视在同一个 WiFi）

```powershell
# 电视上先打开「开发者选项 → USB 调试 / 网络调试」
adb connect 192.168.1.xxx:5555      # 换成电视的 IP
adb install -r YspTv-live.apk
```

### 方法 C：当贝/沙发管家等应用市场 → 本地安装

把 APK 放进电视能访问的共享目录，用市场里的「本地安装」打开。

> **装不上怎么办？** 如果提示「应用未安装」，多半是电视上已经有一个同包名的旧版本。
> 先卸载旧的（包名 `com.dsh.ysptv`）再装。本 APK 和电视上已有的「央视频电视」
> （包名 `com.wb.ysptv`）是两个不同的 App，互不影响。

### 装完在哪找

桌面 / 应用列表里叫 **「央视频电视直播」**。它同时注册了电视（Leanback）和普通桌面两种入口，
所以电视和手机桌面都能看到图标。

---

## 二、遥控器怎么用

| 按键 | 作用 |
|---|---|
| **OK** | 从左边滑出频道列表；再按一次切到高亮那个台 |
| **▲ / ▼** | 直接换台（列表打开时则在列表里移动） |
| **◀** | 收起频道列表 |
| **数字键 0-9** | 直接输入频道号，约 1 秒后自动切过去 |
| **菜单键** | 打开/关闭频道列表 |
| **返回** | 关列表 / 关提示；再按退出 |
| **频道 +/-** | 换台（部分遥控器） |

频道表共 **48 个台**：CCTV-1 ~ CCTV-17，加 31 个省级卫视。

---

## 三、手机 / 触摸屏怎么用

在手机或触摸屏上直接用手指操作，不需要遥控器：

| 手势 | 作用 |
|---|---|
| **点一下画面** | 打开频道列表 |
| **在列表里点某一台** | 立刻切到那个台，列表自动收起 |
| **在列表里上下拖动** | 滚动列表，右侧有滚动条 |
| **快速滑动列表** | 惯性滚动，可以快速掠过很多台 |
| **在画面上向上滑** | 下一个台 |
| **在画面上向下滑** | 上一个台 |
| **在画面上向右滑** | 打开频道列表 |

两点说明：

- **所有触摸都由 App 自己处理，不会传给网页**。这不只是为了手势——网页上有导航栏和
  各种可点区域，手指一碰就可能把页面带到别的分区去。所以触摸事件被 App 全部接管。
- **手机竖屏时频道列表会自动变成两行布局**：第一行台名、第二行正在播的节目，
  这样窄屏上也读得清；横屏和电视上仍是左右一排的布局。列表宽度也按屏幕自适应。
  手指按住列表时，列表不会自动收起，松手后重新计时。

---

## 四、换台速度：实测数据与天花板

**先说结论**：App 自己那部分已经压到 **约 20–70 毫秒**，但换台总耗时仍然是 **约 3 秒**，
因为剩下 98% 的时间是央视频自己的播放器在拉流起播，App 改不动。

### 实测：桌面 Chrome 里测网页自己的速度

在桌面 Chrome 里用网页自己的 `performance.now()` 计时，**完全不注入我们的脚本**，
测 `changeTV()` 到第一帧解码完成：

```
+0ms     CALL              ← 调 changeTV()
+23ms    src=...           ← 旧流开始拆除
+572ms   src=  WIDTH=0     ← 播放器把旧流拆干净
+591ms   src=...           ← 新流地址赋值
+2899ms  WIDTH>0           ← 第一帧真正解码出来
```

三次测量：**2899ms / 2855ms / 3070ms**。

| 阶段 | 耗时 | 谁的代码 |
|---|---|---|
| `changeTV()` → 开始拆旧流 | ~380 ms | 央视频 |
| 拆流 → 新流地址赋值 | ~200 ms | 央视频 |
| 新流赋值 → 第一帧解码 | ~2300 ms | 央视频 + CDN |
| **按键 → 派发 `changeTV()`** | **13–53 ms** | **本 App** |
| **第一帧 → 撤掉黑遮罩** | **6–13 ms** | **本 App** |

也就是说：**3 秒里只有约 20–70 毫秒是我们的**。剩下的拉流时间是网页播放器自身的开销，
而 App 是嵌网页的，动不了它。

### 为什么做不到 1 秒

要进 1 秒就得自己接管播放、直接播流地址。但央视频取流要过 `POST /v1/player/auth` 的
签名握手：一个签名密钥是运行时 XOR 解出来的，另一个来自 WebAssembly 模块
（详见第八节）。**拿不到流地址，就没法绕过网页播放器**，也就没法消掉这 2.3 秒。

### 已经优化掉的部分（3.8–5.0s → 稳定约 3.0s）

1. **不再和播放器抢主线程**。注入脚本原来在 700ms 定时器 + MutationObserver 上跑三轮
   全文档扫描，每次都强制同步布局，而主线程正是启动新流的那条线程
   （光 `suppressFurniture` 一次最多走 4000 个元素）。现在换台期间整段跳过。
2. **钉全屏改成增量**。`releaseAncestors` 原来每秒 4 次遍历整条祖先链、每层写 15 个属性；
   现在只在 video 元素变化时做一次，且换台期间完全不做——因为改写
   `transform/filter/contain` 可能让 video 掉出硬件合成层，重新提升的代价更大。
3. **缓存 Vue 组件查找**。`findScheduleHost` 原来每次扫全文档，而它被扫描循环和换台
   路径同时调用。
4. **缓存节目名**（900ms），DOM 兜底从 600 个候选降到 120 个，并把 `innerText`
   换成 `textContent`（前者会强制布局）。
5. **撤遮罩改成事件驱动**。网页在 `loadeddata`/`playing`/`canplay` 时主动推送，
   第一帧后 **6–13ms** 就撤掉，不用等下一次轮询。轮询降级为兜底，放宽到 200ms。
6. **修好了连按换台**。原来只有确认出画面才推进台号，导致连按时每次都在重切同一个台；
   现在网页一接受新频道就立刻回报。

完整测量方法见 [research/SWITCH-TIMING.md](research/SWITCH-TIMING.md)，
可用 `node research/timing-probe.js` 复现。

---

## 五、十条要求是怎么实现的

| 要求 | 实现方式 |
|---|---|
| ① 系统 WebView 全屏，无地址栏 | 只有一个 `WebView`，`AppTheme` 继承 `Theme.Material.NoActionBar.Fullscreen`，并调用沉浸式 API 隐藏状态栏/导航栏。没有任何浏览器控件。 |
| ② 伪装电脑浏览器，Chrome 版本号读真实内核 | `WebSettings.getDefaultUserAgent()` 取出本机 WebView 真实 UA，正则抓出 `Chrome/xxx` 再拼成 Windows 桌面 UA。**版本号是运行时读出来的，没有写死**。取不到时才退到 `WebView.getCurrentWebViewPackage().versionName`。 |
| ③ 注入脚本只留画面 | `assets/ysp.js`。**全程不写死任何 class 名**：播放器按「面积最大 + 有 src」挑，钉成 `position:fixed; inset:0`，并解除所有祖先的 `overflow/clip/transform/filter`；其余浮层按**几何 + 层级**判断（宽度 > 45% 屏宽且 `z-index ≥ 5`、贴顶/贴底、右侧竖条、居中大块），再用「下载/登录/注册/扫码/同意」等文案兜底清掉。 |
| ④ 48 个台 | `Channels.java`。每个台的 `pid` 都是**驱动真实网页点出来的**，不是猜的。 |
| ⑤ OK 滑出列表，▲▼ 换台 | `ChannelRailView`（自绘 Canvas，低端盒子也流畅）。`MainActivity.dispatchKeyEvent` 拦截所有按键；触摸则由 `onTouchEvent`（列表）和 `web.setOnTouchListener`（画面手势）处理，所以遥控器和手指都能用。 |
| ⑥ 显示每个台正在播什么 | 三条路：优先读页面自己 Vue 组件里的 `sta === 2` 状态（最准）；否则用**官方节目单接口** `capi.yangshipin.cn/api/yspepg/program/{pid}/{日期}`——它是 protobuf，`Epg.java` 里手写了最小 protobuf 解析器，按 start/end 时间戳算当前节目；再不行才按 DOM 时间标签兜底。 |
| ⑦ 换台快、不整页刷新 | 直接调页面自己的 `changeTV()`（`$router.replace` 只换 query，文档不重载），失败再退回「点它自己的频道元素」。全程**零次页面重载**，所以网页原貌永远不会闪出来。 |
| ⑧ 黑遮罩 + 频道号名，出画面立刻撤 | `OverlayView` 全屏纯黑，显示台号、台名、正在播的节目。**撤除条件是播放进度真的在往前走**（连续两次轮询 `currentTime` 增长），不是「有个 video 在 playing」——否则会把播放器自带的灰色海报露出来。 |
| ⑨ 20 秒无画面切 tv.cctv.com | 主源 20 秒没出画面就自动 `loadUrl` 到 `tv.cctv.com/live/<台>/`，并注入 `bootFallback()` 同样只留画面。CCTV 系列有备用源；31 个卫视没有，会提示并重试主源。两个源都失败时会**明确告诉你**「主源和备用源都没出画面，请检查网络或升级 WebView」，而不是留一块黑板。 |
| ⑩ 启动检查内核版本 | 用 `WebView.getCurrentWebViewPackage()` 读真实内核。低于 **55** 直接黑底提示「内核过旧，请升级 Android System WebView」并说明继续大概率黑屏；55–69 提示建议升级但可继续；没有内核则明确告知去装。 |

### 顺带做掉的两个坑

- **页面跑偏自愈**：这是单用途电视 App，如果误触把页面带到央视频首页/新闻页，
  或站点跳转去应用商店，会被 `shouldOverrideUrlLoading` 拦掉；万一还是跑偏了，
  3 秒一次的看门狗会检测 `location.href` 并自动把播放器拉回来。
- **电视时间不准**：节目单是绝对时间戳，电视时钟错就会显示错节目。
  所以先取官网自己的 `csapi.yangshipin.cn/voapi/omsot/serverTime` 算出时钟偏移再判断。

---

## 六、目录结构

```
yangshipin-tv/
├── dist/YspTv-live.apk              ← 成品（已签名）
├── keystore/ysptv.jks               ← 签名密钥（口令 ysptv2026，别名 ysptv）
│                                      注意：本目录已加入 .gitignore，不会上传。
│                                      缺了它 build.ps1 会自动重新生成一把。
├── app/src/main/
│   ├── AndroidManifest.xml
│   ├── assets/ysp.js                ← 注入页面的脚本
│   ├── java/com/dsh/ysptv/
│   │   ├── MainActivity.java        ← WebView、遥控器、换台与兜底逻辑
│   │   ├── Channels.java            ← 48 个台（自动生成）
│   │   ├── Channel.java
│   │   ├── Epg.java                 ← 节目单 protobuf 解析 + 时钟校正
│   │   ├── ChannelRailView.java     ← 左侧频道列表
│   │   └── OverlayView.java         ← 黑色换台遮罩 / 提示
│   └── res/                         ← 图标、横幅、主题、网络安全配置
├── tools/
│   ├── build.ps1                    ← 一键编译+对齐+签名
│   ├── gen-channels.js              ← 由抓取结果生成 Channels.java
│   ├── make_icons.py                ← 生成图标和电视横幅
│   ├── setup-sdk.ps1                ← 下载安装 Android SDK 命令行工具
│   └── CheckApi.java                ← 校验用到的系统 API 是否真实存在
└── research/                        ← 逆向分析的过程产物与证据
    ├── FINDINGS.md                  ← 站点 API / 频道 pid / 播放链路的完整分析
    ├── SWITCH-TIMING.md             ← 换台耗时实测与天花板分析
    ├── channels-*.json / .csv       ← 抓到的频道表
    └── *.js                         ← 抓取与测量脚本
```

**未上传的内容**（`.gitignore` 已排除，需要时可自行复现）：

| 排除项 | 原因 | 如何复现 |
|---|---|---|
| `keystore/` | 含私钥，上传等于让别人能签出可覆盖安装的 APK | `tools/build.ps1` 自动生成 |
| `research/js/` | 央视频自己的 JS bundle | `node research/harvest.js` |
| `research/home-dom.html` | 站点自己的页面 markup | `node research/harvest.js` |
| `research/chrome-*/` | headless Chrome 缓存，单个几百 MB | 跑探测脚本时自动生成 |
| 截图 / `.ts` 流片段 | 体积大，且含央视播出画面 | 运行 App 自行截图 |
| `build/` | 编译中间产物 | `tools/build.ps1` |

仓库里实际只有 **110 个文件、约 3.4 MB**。


## 七、重新编译

```powershell
pwsh -File tools/build.ps1
```

脚本用 `aapt2 → javac → d8 → zipalign → apksigner` 直接构建，**不依赖 Gradle**，
所以不需要联网拉依赖，几秒钟就编译完。

---

## 八、出问题怎么自己查（诊断开关）

App 内置了几个只在 adb 启动时生效的诊断参数，方便在电视上定位问题而不用改代码：

```powershell
# 假装内核是 Chromium 40，强制触发「内核过旧」启动提示
adb shell am start -n com.dsh.ysptv/.MainActivity --ei fakeChrome 40

# 直接开机就跳到第 30 个台
adb shell am start -n com.dsh.ysptv/.MainActivity --ei startChannel 30

# 直接走 tv.cctv.com 备用源（用来单独验证备用源）
adb shell am start -n com.dsh.ysptv/.MainActivity --ez forceFallback true

# 看 App 的运行日志
adb logcat -s YspTv:D
```

正常情况下这些参数都不会生效，只有你显式传了才有作用。

---

## 九、已知限制（说实话的部分）

1. **拿不到播放地址**。央视频取流要先过 `POST /v1/player/auth` 的签名握手：签名密钥是运行时
   XOR 解出来的常量，另一个签名来自 WebAssembly 模块。所以本 App **不能**直接播流，
   只能让 WebView 去跑网页自己的握手——这也是为什么方案必须是「WebView + 注入」而不是原生播放器。
2. **13 个付费频道**（CCTV 风云剧场、第一剧场等，`isVip=true`）在网页上本来就要会员，
   本 App 不破解，所以没放进 48 个台里。
3. **卫视没有备用源**。`tv.cctv.com` 只提供 CCTV 系列，所以 31 个卫视在 20 秒超时后
   只能提示并重试主源。
4. **备用源本身也可能不出画面**。实测 `tv.cctv.com/live/cctv1/` 在桌面 Chrome 里
   会请求到 m3u8，但 `<video>` 始终停在 `readyState=0`、`videoWidth=0` 不播放
   （它内嵌的是同一个 CMG 播放器，仍然要过那套签名握手）。所以备用源是「多一次机会」，
   不是「保底一定有画面」——两个源都失败时 App 会明确告诉你，而不是留一块黑板。
5. **网页改版可能影响注入**。脚本刻意不写死 class 名，靠几何和页面自己的 Vue 数据，
   所以抗改版能力比选择器方案强，但如果央视频把播放器换成 `<canvas>` 或放进跨域 iframe，
   仍然需要调整 `ysp.js`。
6. 本项目仅用于个人在自己设备上观看公开的直播页面，请遵守央视频的服务条款。

---

## 十、真机验证记录

在一台 Android 12 设备（WebView 141）上逐项实测：

| 验证项 | 结果 |
|---|---|
| 冷启动 | 直接出 CCTV-1 画面，页面上方导航、右侧节目单、登录浮层全部不可见 |
| ▼ 换台 | 黑遮罩显示台号/台名/正在播节目，画面出来即撤除（实测 1 秒内） |
| 连按换台 | 逐个正常切换，遮罩撤除条件按「播放进度真的在走」判断，不会露出播放器灰海报 |
| 换到第 48 台 | 遮罩正确显示「48 新疆卫视 / 天山剧场:走西口(54) / 正在切换…」 |
| OK 滑出列表 | 列表从左侧滑出，▲▼ 在列表内移动，OK 确认换台 |
| 节目单 | 列表里每个台显示真实在播节目，且随时间自动更新（实测 CCTV-1 从「人世间第18集」变成第19集） |
| 无整页刷新 | 换台全程 `Page.frameNavigated` 计数为 **0** |
| 内核过旧提示 | 用 `--ei fakeChrome 40` 强制触发，正确显示「内核过旧」并说明需升到 70 以上；按 OK 可继续并正常播放 |
| 备用源超时 | 用 `--ez forceFallback true` 强制走备用源，超时后明确提示「主源和备用源都没有出画面」，不再出现无提示黑板 |
| **触摸：点画面开列表** | 点屏幕中央，频道列表从左侧滑出，显示「频道 · 48 个台」与「点按选择」提示 |
| **触摸：点某台切台** | 点第 4 行 → 日志 `rail pick index=3 -> CCTV-4 中文国际` / `tune -> 4 CCTV-4 中文国际`，画面切到 CCTV-4；再点第 7 行 → 正确切到 CCTV-7，列表自动收起 |
| **触摸：拖动列表** | 单次拖动从第 1 台滚到第 10–16 台，右侧滚动条同步；高亮仍停在真正在播的台上 |
| **触摸：上下滑换台** | 画面上向上滑 → 下一台（CCTV-7→CCTV-8），向下滑 → 上一台（CCTV-8→CCTV-7） |
| **触摸：竖屏两行布局** | 窄面板自动改为「台名一行 + 节目名一行」，不再挤在一行里 |

测试用的手机在验证完成后已卸载干净。
