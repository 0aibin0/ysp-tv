package com.dsh.ysptv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fullscreen WebView television for yangshipin.cn.
 *
 * Design notes
 * ------------
 * - The page is loaded once and never reloaded. Channel changes are performed
 *   inside the page by the injected script, so the site's layout never flashes
 *   back into view.
 * - The user agent is a desktop one so the site serves the PC player instead of
 *   its "download the app" page, but the Chrome version inside it is read from
 *   this device's real WebView engine, not hardcoded.
 * - Every remote-control key is handled by the activity, so the page never
 *   scrolls or moves focus while the user is zapping.
 */
public final class MainActivity extends Activity {

    private static final String TAG = "YspTv";

    private static final String HOME_URL = "https://www.yangshipin.cn/tv/home";
    private static final String ASSET_JS = "ysp.js";

    /** Below this Chromium major version we warn before showing a black screen. */
    private static final int MIN_CHROME_MAJOR = 70;
    /** Below this the engine almost certainly cannot play the stream at all. */
    private static final int BROKEN_CHROME_MAJOR = 55;

    private static final long TUNE_TIMEOUT_MS = 20000L;
    /**
     * Poll cadence. Each poll is a round trip onto the page's main thread --
     * the same thread that has to fetch and start the new stream -- so this is
     * deliberately not aggressive. It is only a safety net: the page pushes an
     * event the moment a real frame appears, and that is what normally lifts
     * the cover.
     */
    private static final long POLL_MS = 200L;
    private static final long EPG_REFRESH_MS = 10 * 60 * 1000L;
    private static final long RAIL_HIDE_MS = 6000L;

    private FrameLayout root;
    private WebView web;
    private ChannelRailView rail;
    private OverlayView overlay;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private Epg epg;

    private String injectedJs = "";
    private String chromeVersion = "";
    private StringBuilder uaBuilder = new StringBuilder();

    private int currentIndex = 0;
    private int railIndex = 0;
    private boolean railOpen = false;
    private boolean pageReady = false;
    private boolean firstPictureDone = false;

    /** Live snapshot of the player, refreshed from the injected script. */
    private volatile boolean vReady = false;
    private volatile boolean vPlaying = false;
    private volatile double vTime = 0d;
    /** videoWidth; 0 while the player is still showing its own poster. */
    private volatile int vWidth = 0;
    /** Raw HTMLMediaElement.readyState (0..4). */
    private volatile int vRs = 0;
    /** Bumped by the page when it swaps in a different <video> element. */
    private volatile int vGen = 0;
    private volatile String vSrc = "";
    private volatile String vPid = "";
    private volatile String vNowPlaying = "";

    private long tuneStart = 0L;
    private String tuneSrcBefore = "";
    /** pid we are tuning to; null while using the backup source (which has no pid). */
    private String tunePid = null;
    /**
     * State of the player at the moment tuning began, so we can tell the new
     * stream apart from the one that was already playing.
     */
    private int genAtTuneStart = -1;
    private double timeAtTuneStart = -1d;
    private double prevPollTime = -1d;

    /**
     * Stream the player was showing when tuning began, so a later poll can tell
     * the new channel apart from the one that was already playing.
     */
    private String srcAtTuneStart = "";

    /** Snapshot the player so a later poll can tell what has changed. */
    private void markTuneBaseline() {
        genAtTuneStart = vGen;
        timeAtTuneStart = vTime;
        srcAtTuneStart = vSrc;
        prevPollTime = -1d;
    }

    private boolean tuning = false;
    private boolean triedFallback = false;
    private int digits = 0;
    private long digitsAt = 0L;

    private final Runnable poller = new Runnable() {
        @Override public void run() {
            pollVideo();
            if (tuning || !firstPictureDone) {
                ui.postDelayed(this, POLL_MS);
            }
        }
    };

    private final Runnable epgRefresher = new Runnable() {
        @Override public void run() {
            loadAllPrograms();
            ui.postDelayed(this, EPG_REFRESH_MS);
        }
    };

    /** Watches for the player page being replaced by the website's own pages. */
    private final Runnable pageWatchdog = new Runnable() {
        @Override public void run() {
            try {
                final String[] out = new String[1];
                web.evaluateJavascript("location.href", new android.webkit.ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) {
                        out[0] = unquote(value);
                    }
                });
                String u = out[0] == null ? "" : out[0].toLowerCase();
                if (u.length() > 0
                        && (u.startsWith("http://") || u.startsWith("https://"))
                        && !u.contains("/tv/home") && !u.contains("/tv?")
                        && !u.contains("tv.cctv.com/live/")) {
                    Log.w(TAG, "watchdog: off the player (" + u + "), restoring");
                    sawPlayerPage = false;
                    restorePlayer();
                }
            } catch (Throwable t) {
                // ignore
            }
            ui.postDelayed(this, 3000L);
        }
    };

    private final Runnable railHider = new Runnable() {
        @Override public void run() {
            if (railOpen) setRailOpen(false);
        }
    };

    // ------------------------------------------------------------------ setup

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        epg = new Epg();
        injectedJs = readAsset(ASSET_JS);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        buildWebView();
        buildRail();
        buildOverlay();

        setContentView(root);

        // Only safe once the decor view exists.
        goImmersive();

        // Engine sanity check before anything is asked of it.
        ui.post(new Runnable() {
            @Override public void run() {
                goImmersive();
                checkEngineThenLoad();
            }
        });
    }

    private void buildWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        web.setLayoutParams(lp);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        }
        s.setUserAgentString(desktopUserAgent());

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return handleNavigation(req.getUrl() == null ? "" : req.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return handleNavigation(url);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                pageReady = true;
                String u = url == null ? "" : url.toLowerCase();
                if (u.contains("/tv/home") || u.contains("/tv?")) {
                    sawPlayerPage = true;
                    restoring = false;
                }
                injectFor(url);
            }

            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req != null && req.isForMainFrame()) {
                    showError("网络错误", "无法打开页面：" + err.getDescription()
                            + "\n请检查电视的网络连接后重试。");
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, "console: " + m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "YspBridge");
        // All touch input is handled here rather than by the page: it keeps the
        // site from hijacking a swipe, and it is what makes the app usable on a
        // phone, where there is no D-pad.
        web.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent e) {
                return handleScreenTouch(e);
            }
        });
        root.addView(web);
    }

    private void buildRail() {
        rail = new ChannelRailView(this);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                railWidthPx(), ViewGroup.LayoutParams.MATCH_PARENT);
        lp.gravity = Gravity.START;
        rail.setLayoutParams(lp);
        rail.setVisibility(View.GONE);
        rail.setSelected(currentIndex, false);
        rail.setOnChannelPickedListener(new ChannelRailView.OnChannelPicked() {
            @Override public void onChannelPicked(int index) {
                // Tapping a row is a complete choice: tune and get out of the way.
                Log.d(TAG, "rail pick index=" + index + " -> " + Channels.ALL[index].name);
                ui.removeCallbacks(railHider);
                tune(index);
                setRailOpen(false);
            }
        });
        // Touching the list must not fight the auto-hide timer: hold it open
        // while a finger is down, then restart the countdown on release.
        rail.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent e) {
                if (e.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    ui.removeCallbacks(railHider);
                } else if (e.getActionMasked() == MotionEvent.ACTION_UP
                        || e.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                    ui.removeCallbacks(railHider);
                    ui.postDelayed(railHider, RAIL_HIDE_MS);
                }
                return false; // let the rail's own handler do the work
            }
        });
        root.addView(rail);
    }

    /**
     * Rail width. Televisions get a fixed comfortable column; phones get most
     * of the screen so the rows are wide enough to read and hit with a thumb.
     *
     * The test is in density-independent pixels, because some TVs report a
     * high density and would otherwise be mistaken for phones.
     */
    private int railWidthPx() {
        android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
        int widthDp = Math.round(dm.widthPixels / dm.density);
        boolean narrow = widthDp < 900;
        if (narrow) {
            return Math.min((int) (dm.widthPixels * 0.88f), (int) (460f * dm.density));
        }
        return (int) (430f * dm.density);
    }

    private void buildOverlay() {
        overlay = new OverlayView(this);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        overlay.setLayoutParams(lp);
        root.addView(overlay);
    }

    // ------------------------------------------------------------- user agent

    /**
     * A desktop UA, but carrying this device's real Chromium version.
     *
     * The version is taken from the installed WebView engine at runtime so the
     * site sees a browser that actually matches what is rendering the page.
     */
    private String desktopUserAgent() {
        String engine = "";
        try {
            engine = WebSettings.getDefaultUserAgent(this);
        } catch (Throwable t) {
            Log.w(TAG, "getDefaultUserAgent failed", t);
        }
        Matcher m = Pattern.compile("Chrome/([0-9]+(?:\\.[0-9]+)*)").matcher(engine);
        if (m.find()) {
            chromeVersion = m.group(1);
        } else {
            // Fall back to the WebView package version before giving up on
            // reporting a real engine version.
            String pkg = webViewPackageVersion();
            if (pkg != null) chromeVersion = pkg;
        }
        if (chromeVersion == null || chromeVersion.length() == 0) {
            // Last resort only; the normal path always resolves a real version.
            chromeVersion = "120.0.0.0";
        }

        uaBuilder.setLength(0);
        uaBuilder.append("Mozilla/5.0 (Windows NT 10.0; Win64; x64) ")
                .append("AppleWebKit/537.36 (KHTML, like Gecko) ")
                .append("Chrome/").append(effectiveChromeVersion()).append(" ")
                .append("Safari/537.36");
        return uaBuilder.toString();
    }

    private String webViewPackageVersion() {
        try {
            PackageInfo pi = WebView.getCurrentWebViewPackage();
            if (pi != null && pi.versionName != null) return pi.versionName;
        } catch (Throwable t) {
            Log.w(TAG, "getCurrentWebViewPackage failed", t);
        }
        return null;
    }

    private int chromeMajor() {
        try {
            int dot = chromeVersion.indexOf('.');
            String head = dot > 0 ? chromeVersion.substring(0, dot) : chromeVersion;
            return Integer.parseInt(head.trim());
        } catch (Throwable t) {
            return -1;
        }
    }

    // ------------------------------------------------------------ engine gate

    /**
     * Diagnostic overrides, settable from adb so a TV whose engine or network
     * cannot be reproduced elsewhere can still be reasoned about:
     *
     *   adb shell am start -n com.dsh.ysptv/.MainActivity --ei fakeChrome 40
     *   adb shell am start -n com.dsh.ysptv/.MainActivity --ei startChannel 30
     *   adb shell am start -n com.dsh.ysptv/.MainActivity --ez forceFallback true
     */
    public static final String EXTRA_FAKE_CHROME = "fakeChrome";
    public static final String EXTRA_START_CHANNEL = "startChannel";
    public static final String EXTRA_FORCE_FALLBACK = "forceFallback";

    /** Version reported in the UA, honouring the diagnostic override. */
    private String effectiveChromeVersion() {
        int fake = getIntent() == null ? 0
                : getIntent().getIntExtra(EXTRA_FAKE_CHROME, 0);
        if (fake > 0) return fake + ".0.0.0";
        return chromeVersion;
    }

    private int effectiveChromeMajor() {
        int fake = getIntent() == null ? 0
                : getIntent().getIntExtra(EXTRA_FAKE_CHROME, 0);
        if (fake > 0) return fake;
        return chromeMajor();
    }

    /**
     * Show the rendering engine details on screen.
     *
     * The app contains no browser engine of its own: it drives whatever
     * System WebView the device ships. This panel reports exactly which
     * package and version that is, plus the Chromium version placed in the
     * desktop user agent.
     */
    private void showEngineInfo() {
        PackageInfo pi = null;
        try {
            pi = WebView.getCurrentWebViewPackage();
        } catch (Throwable t) {
            Log.w(TAG, "package lookup failed", t);
        }
        desktopUserAgent();
        int major = effectiveChromeMajor();

        StringBuilder sb = new StringBuilder();
        if (pi == null) {
            sb.append("未找到系统 WebView");
        } else {
            sb.append("内核包名：").append(pi.packageName).append("\n");
            sb.append("内核版本：").append(pi.versionName).append("\n");
        }
        sb.append("Chromium 主版本：").append(major > 0 ? String.valueOf(major) : "未知").append("\n");
        sb.append("UA 中的 Chrome：").append(effectiveChromeVersion()).append("\n\n");
        sb.append("本 App 不含浏览器内核，用的是系统 WebView。\n");
        if (major > 0 && major < MIN_CHROME_MAJOR) {
            sb.append("当前版本低于建议的 ").append(MIN_CHROME_MAJOR)
              .append("，播放可能不稳定，建议升级 Android System WebView。");
        } else {
            sb.append("版本满足要求（建议 ").append(MIN_CHROME_MAJOR).append(" 以上）。");
        }
        overlay.showMessage("网页内核信息", sb.toString(), "按返回键关闭");
    }

    private void checkEngineThenLoad() {
        PackageInfo pi = null;
        try {
            pi = WebView.getCurrentWebViewPackage();
        } catch (Throwable t) {
            Log.w(TAG, "package lookup failed", t);
        }

        // Force the UA to resolve now so chromeVersion is populated.
        desktopUserAgent();
        int major = effectiveChromeMajor();

        if (pi == null) {
            overlay.showMessage("未找到系统网页内核",
                    "这台设备没有可用的 Android System WebView，无法播放网页视频。\n"
                            + "请在应用商店安装或启用“Android System WebView”后重试。",
                    "按返回键退出");
            return;
        }

        String engine = pi.packageName + " " + pi.versionName;

        if (major > 0 && major < BROKEN_CHROME_MAJOR) {
            overlay.showMessage("网页内核版本过旧",
                    "本机网页内核为 Chromium " + major + "（" + engine + "），"
                            + "央视频的播放器需要 Chromium " + MIN_CHROME_MAJOR + " 以上，"
                            + "继续打开很可能是黑屏。\n"
                            + "请先升级电视上的“Android System WebView”。",
                    "按 OK 仍然尝试 · 按返回键退出");
            engineBlocked = true;
            return;
        }

        if (major > 0 && major < MIN_CHROME_MAJOR) {
            overlay.showMessage("网页内核偏旧",
                    "本机网页内核为 Chromium " + major + "（" + engine + "），"
                            + "建议升级到 " + MIN_CHROME_MAJOR + " 以上以保证播放稳定。\n"
                            + "仍可继续使用。",
                    "按 OK 继续");
            engineWarned = true;
            return;
        }

        startPlayback();
    }

    private boolean engineBlocked = false;
    private boolean engineWarned = false;

    private void startPlayback() {
        // Diagnostic: jump straight to a channel, or straight to the backup
        // source, without touching the remote.
        int start = getIntent() == null ? 0 : getIntent().getIntExtra(EXTRA_START_CHANNEL, 0);
        boolean forceFallback = getIntent() != null
                && getIntent().getBooleanExtra(EXTRA_FORCE_FALLBACK, false);

        if (start > 0 && start <= Channels.ALL.length) {
            currentIndex = start - 1;
            railIndex = currentIndex;
            rail.setSelected(currentIndex, false);
        }

        if (forceFallback) {
            Channel ch = Channels.ALL[safeIndex(currentIndex)];
            String url = ch.fallbackUrl();
            if (url != null) {
                overlay.showFallbackNotice(ch.name);
                tuning = true;
                triedFallback = true;
                tuneStart = System.currentTimeMillis();
                tunePid = null;
                markTuneBaseline();
                ui.removeCallbacks(poller);
                ui.postDelayed(poller, POLL_MS);
                web.loadUrl(url);
                return;
            }
        }

        overlay.showMessage("央视频", "正在启动，请稍候…", "");
        web.loadUrl(HOME_URL);
        firstPictureDone = false;
        tuning = true;
        tuneStart = System.currentTimeMillis();
        triedFallback = false;
        tuneSrcBefore = "";
        tunePid = Channels.ALL[safeIndex(currentIndex)].pid;
        markTuneBaseline();
        ui.removeCallbacks(poller);
        ui.postDelayed(poller, POLL_MS);
    }

    // ----------------------------------------------------------- page bridge

    /** Receives progress reports from the injected script. */
    private final class Bridge {
        @JavascriptInterface
        public void onState(String json) {
            try {
                JSONObject o = new JSONObject(json);
                vReady = o.optBoolean("videoReady", false);
                vNowPlaying = o.optString("nowPlaying", "");
                String pid = o.optString("currentPid", "");
                if (vNowPlaying != null && vNowPlaying.length() > 0) {
                    final int idx = Channels.indexOfPid(pid);
                    if (idx >= 0) {
                        ui.post(new Runnable() {
                            @Override public void run() {
                                rail.setProgram(idx, vNowPlaying);
                            }
                        });
                    }
                }
            } catch (Throwable t) {
                Log.w(TAG, "bad bridge payload", t);
            }
        }

        /**
         * Pushed as soon as the page has adopted a new channel -- long before
         * the picture arrives.
         *
         * Moving the dial position here, rather than when the picture appears,
         * is what makes rapid zapping work: the next press is then relative to
         * the channel we just moved to, instead of re-requesting the one we
         * already left.
         */
        @JavascriptInterface
        public void onSwitched(String pid) {
            if (pid == null) return;
            final int idx = Channels.indexOfPid(pid);
            if (idx < 0) return;
            ui.post(new Runnable() {
                @Override public void run() {
                    currentIndex = idx;
                    railIndex = idx;
                    rail.setSelected(idx, false);
                }
            });
        }

        /**
         * Pushed by the page the instant a real frame is on screen.
         *
         * This is the fast path for uncovering: the media element's own events
         * fire the moment decoding starts, which is well before the next poll
         * would have noticed. Same conditions as the polling check, so a poster
         * still cannot slip through -- videoWidth is 0 for a poster.
         */
        @JavascriptInterface
        public void onFrame(String gen, String width, String src) {
            if (!tuning) return;
            try {
                int w = Integer.parseInt(width);
                if (w <= 0) return;
                if (src == null || src.length() == 0 || src.equals(srcAtTuneStart)) return;
                ui.post(new Runnable() {
                    @Override public void run() {
                        if (tuning) finishTune(true);
                    }
                });
            } catch (Throwable t) {
                // Fall back to polling.
            }
        }
    }

    // ------------------------------------------------------------------- Java

    private void inject() {
        injectFor(null);
    }

    /** Inject the isolation script, choosing the mode that matches the page. */
    private void injectFor(String url) {
        if (injectedJs == null || injectedJs.length() == 0) return;
        try {
            web.evaluateJavascript(injectedJs, null);
            boolean fallback = url != null && url.toLowerCase().contains("tv.cctv.com/live/");
            if (fallback) {
                web.evaluateJavascript("window.__YSP && window.__YSP.bootFallback();", null);
            } else {
                web.evaluateJavascript("window.__YSP && window.__YSP.boot();", null);
            }
        } catch (Throwable t) {
            Log.w(TAG, "inject failed", t);
        }
    }

    private void js(String code) {
        try {
            web.evaluateJavascript(code, null);
        } catch (Throwable t) {
            Log.w(TAG, "js failed: " + code, t);
        }
    }

    private void pollVideo() {
        try {
            web.evaluateJavascript(
                    "(function(){try{var s=(window.__YSP&&window.__YSP.videoState)?window.__YSP.videoState():null;" +
                            "var n=(window.__YSP&&window.__YSP.nowPlaying)?window.__YSP.nowPlaying():'';" +
                            "var p=(window.__YSP&&window.__YSP.currentPid)?window.__YSP.currentPid():'';" +
                            "return JSON.stringify({v:s,n:n,p:p});}catch(e){return '';}})()",
                    new android.webkit.ValueCallback<String>() {
                        @Override public void onReceiveValue(String value) {
                            onVideoState(value);
                        }
                    });
        } catch (Throwable t) {
            // WebView still booting; the poller retries.
        }
    }

    private void onVideoState(String raw) {
        if (raw == null || raw.length() < 4 || "null".equals(raw)) return;
        String json = unquote(raw);
        try {
            JSONObject o = new JSONObject(json);
            JSONObject v = o.optJSONObject("v");
            if (v == null) return;
            vReady = v.optBoolean("found", false) && v.optInt("readyState", 0) >= 2;
            vPlaying = v.optBoolean("playing", false);
            vTime = v.optDouble("currentTime", 0d);
            vWidth = v.optInt("vw", 0);
            vRs = v.optInt("readyState", 0);
            vGen = v.optInt("gen", 0);
            String src = v.optString("src", "");
            if (src != null && src.length() > 0) vSrc = src;
            String pid = o.optString("p", "");
            if (pid != null && pid.length() > 0) vPid = pid;
            if (tuning) {
                Log.d(TAG, "poll t=" + (System.currentTimeMillis() - tuneStart)
                        + " gen=" + vGen + " vw=" + vWidth + " rs=" + v.optInt("readyState", -1)
                        + " paused=" + v.optBoolean("paused", true)
                        + " ct=" + Math.round(vTime * 100) / 100.0
                        + " pid=" + vPid + " want=" + tunePid
                        + " src=" + (vSrc.length() > 16 ? vSrc.substring(vSrc.length() - 16) : vSrc));
            }
            String np = o.optString("n", "");
            if (np != null && np.length() > 0 && !np.equals(vNowPlaying)) {
                vNowPlaying = np;
                int idx = tuning ? railIndex : currentIndex;
                if (idx >= 0 && idx < Channels.ALL.length) rail.setProgram(idx, np);
            }
        } catch (Throwable t) {
            // Ignore malformed snapshots.
        }

        if (!tuning) return;

        long elapsed = System.currentTimeMillis() - tuneStart;

        // Deciding when the picture is real is the whole game here.
        //
        // The trap: during a channel change the OLD stream keeps playing, so
        // "a video is playing with currentTime > 0" is already true the instant
        // we start tuning. Uncovering then shows the new player's own poster --
        // the grey card with the big play triangle. Measured on device, that
        // poster state is exactly videoWidth 0, readyState 0, currentTime 0.
        //
        // A picture counts as real only when all of these hold:
        //   swapped  - the player is on a genuinely different stream than the
        //              one playing when tuning began. The site plays through a
        //              blob: URL and builds a fresh one per stream; comparing
        //              startsWith is not enough because every URL shares a
        //              prefix, so the whole string is compared.
        //   decoded  - videoWidth > 0. The engine only reports a width once it
        //              has produced real frames; the player's own poster -- the
        //              grey card with the big play triangle -- never sets it.
        //   rolling  - the new stream's playhead has left the start. A stream
        //              that has just been swapped in sits at ~0 while it fills
        //              its buffer, and that gap is exactly when the poster shows.
        boolean swapped = vSrc.length() > 0 && !vSrc.equals(srcAtTuneStart);
        boolean decoded = vWidth > 0 && vRs >= 3;
        boolean rolling = vTime > 0.30d;

        if (swapped && decoded && rolling && vPlaying) {
            finishTune(true);
            return;
        }

        // Fallback pages are heavier (new document, third-party player), so
        // give them a longer budget before declaring failure.
        long deadline = triedFallback ? 35000L : TUNE_TIMEOUT_MS;

        if (elapsed > deadline) {
            if (!triedFallback) {
                if (tryFallback()) return;
                // No backup source for this channel: retry the primary once.
                overlay.showMessage(Channels.ALL[safeIndex(railIndex)].name,
                        "20 秒内没有画面。该频道没有备用源，正在重试…", "");
                triedFallback = true;
                tuneStart = System.currentTimeMillis();
                doSwitch(safeIndex(railIndex));
                return;
            }
            // Both sources failed. Say so plainly instead of leaving a blank
            // screen, and give the user the two things that actually help.
            overlay.showMessage(Channels.ALL[safeIndex(railIndex)].name,
                    "主源和央视网备用源都没有出画面。\n"
                            + "请检查电视网络，或在设置里升级 “Android System WebView”，"
                            + "然后按 OK 重试。",
                    "按 OK 重试 · 按 ▲▼ 换台");
            tuning = false;
        }
    }

    private static String unquote(String s) {
        if (s == null) return "";
        s = s.trim();
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            s = s.substring(1, s.length() - 1);
            s = s.replace("\\\"", "\"").replace("\\\\", "\\")
                 .replace("\\n", "\n").replace("\\/", "/");
        }
        return s;
    }

    private int safeIndex(int i) {
        if (i < 0) return 0;
        if (i >= Channels.ALL.length) return Channels.ALL.length - 1;
        return i;
    }

    // ---------------------------------------------------------- tuning flow

    private void finishTune(boolean ok) {
        tuning = false;
        ui.removeCallbacks(poller);
        if (ok) {
            overlay.hide();
            firstPictureDone = true;
            currentIndex = safeIndex(railIndex);
            rail.setSelected(currentIndex, false);
            if (railOpen) setRailOpen(false);
        }
    }

    /** Switch to a channel, showing the black tune-in cover first. */
    private void tune(int index) {
        index = safeIndex(index);
        railIndex = index;
        Channel ch = Channels.ALL[index];
        Log.d(TAG, "tune -> " + ch.no + " " + ch.name + " (pid " + ch.pid + ")");

        overlay.showSwitching(ch, rail.getProgram(index));
        tuning = true;
        triedFallback = false;
        tuneStart = System.currentTimeMillis();
        tuneSrcBefore = vSrc;
        tunePid = ch.pid;
        markTuneBaseline();
        ui.removeCallbacks(poller);
        ui.postDelayed(poller, POLL_MS);

        doSwitch(index);
    }

    private void doSwitch(int index) {
        Channel ch = Channels.ALL[safeIndex(index)];
        String alt = ch.shortName;
        js("window.__YSP && window.__YSP.switchTo(" + quote(ch.pid) + ","
                + quote(ch.name) + "," + quote(alt) + ");");
    }

    /** @return true when a backup source was actually started. */
    private boolean tryFallback() {
        triedFallback = true;
        Channel ch = Channels.ALL[safeIndex(railIndex)];
        String url = ch.fallbackUrl();
        if (url == null) return false;

        overlay.showFallbackNotice(ch.name);
        tuning = true;
        tuneStart = System.currentTimeMillis();
        tuneSrcBefore = "";
        tunePid = null; // the backup source has no pid to match against
        markTuneBaseline();
        firstPictureDone = false;
        ui.removeCallbacks(poller);
        ui.postDelayed(poller, POLL_MS);
        web.loadUrl(url);
        return true;
    }

    private static String quote(String s) {
        if (s == null) return "''";
        return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    // -------------------------------------------------------- screen gestures

    private float touchDownX, touchDownY, touchLastY;
    private long touchDownAt;
    private boolean touchMoved;
    private boolean touchFlinging;

    /**
     * Gestures on the video surface, for devices without a remote:
     *
     *   tap              show the channel list (or dismiss a message)
     *   swipe up / down  next / previous channel
     *   swipe right      open the channel list
     *
     * Every touch is consumed, so nothing reaches the web page. That matters
     * because the site's own controls would otherwise scroll the page or
     * navigate away from the player.
     */
    private boolean handleScreenTouch(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                touchDownX = e.getX();
                touchDownY = touchLastY = e.getY();
                touchDownAt = System.currentTimeMillis();
                touchMoved = false;
                touchFlinging = false;
                ui.removeCallbacks(railHider); // don't yank the rail away mid-touch
                return true;

            case MotionEvent.ACTION_MOVE: {
                float dx = e.getX() - touchDownX;
                float dy = e.getY() - touchDownY;
                if (!touchMoved && (Math.abs(dx) > touchSlopPx() || Math.abs(dy) > touchSlopPx())) {
                    touchMoved = true;
                }
                // Recognise the gesture as soon as it is unambiguous, so the
                // channel changes under the finger instead of after release.
                if (!touchFlinging && Math.abs(dy) > touchSlopPx() * 6
                        && Math.abs(dy) > Math.abs(dx) * 1.5f) {
                    touchFlinging = true;
                    zap(dy < 0 ? 1 : -1);
                }
                touchLastY = e.getY();
                return true;
            }

            case MotionEvent.ACTION_UP: {
                long held = System.currentTimeMillis() - touchDownAt;
                float dx = e.getX() - touchDownX;
                float dy = e.getY() - touchDownY;

                if (!touchMoved && held < 600) {
                    onScreenTap();
                } else if (!touchFlinging
                        && Math.abs(dx) > touchSlopPx() * 3
                        && Math.abs(dx) > Math.abs(dy) * 1.5f
                        && dx > 0) {
                    // Swipe right opens the list.
                    if (!railOpen) setRailOpen(true);
                } else if (railOpen) {
                    // Re-arm the auto-hide after any interaction.
                    ui.postDelayed(railHider, RAIL_HIDE_MS);
                }
                return true;
            }

            case MotionEvent.ACTION_CANCEL:
                if (railOpen) ui.postDelayed(railHider, RAIL_HIDE_MS);
                return true;
        }
        return true;
    }

    /** A tap on the picture: open the list, or clear a message. */
    private void onScreenTap() {
        if (engineBlocked || engineWarned) {
            engineBlocked = false;
            engineWarned = false;
            startPlayback();
            return;
        }
        if (railOpen) {
            tune(railIndex);
            setRailOpen(false);
            return;
        }
        if (tuning) {
            tune(safeIndex(railIndex));
            return;
        }
        if (overlay.isShowing()) {
            overlay.hide();
            return;
        }
        setRailOpen(true);
    }

    private int touchSlopPx() {
        if (cachedTouchSlop == 0) {
            cachedTouchSlop = android.view.ViewConfiguration.get(this).getScaledTouchSlop();
        }
        return cachedTouchSlop;
    }

    private int cachedTouchSlop = 0;

    // ------------------------------------------------------------ navigation

    /**
     * Keep the WebView on the live-TV player.
     *
     * This is a single-purpose appliance: if a stray tap or a site redirect
     * takes us to the website's home page, news section or an app-store link,
     * the viewer would be stranded in a web browser. We allow only the player
     * itself and the tv.cctv.com backup source, and put the player back for
     * anything else.
     */
    private boolean handleNavigation(String url) {
        if (url == null || url.length() == 0) return false;
        String u = url.toLowerCase();

        if (u.startsWith("http://") || u.startsWith("https://")) {
            boolean isTvPlayer = (u.contains("yangshipin.cn/tv/home") || u.contains("yangshipin.cn/tv?"))
                    && !u.contains("/video") && !u.contains("/live/detail");
            boolean isCctvBackup = u.contains("tv.cctv.com/live/");
            if (isTvPlayer || isCctvBackup) {
                return false; // allow
            }
            Log.d(TAG, "blocked navigation: " + url);
            // If we are no longer on the player, restore it.
            restorePlayer();
            return true;
        }

        // market://, intent://, tel: and friends are all attempts to leave.
        Log.d(TAG, "blocked scheme: " + url);
        return true;
    }

    /** Re-assert the live player for the channel we believe is selected. */
    private void restorePlayer() {
        if (restoring) return;
        restoring = true;
        final int idx = safeIndex(tuning ? railIndex : currentIndex);
        ui.post(new Runnable() {
            @Override public void run() {
                Channel ch = Channels.ALL[idx];
                web.loadUrl(HOME_URL + "?pid=" + ch.pid);
                tuneStart = System.currentTimeMillis();
                tunePid = ch.pid;
                markTuneBaseline();
                tuning = true;
                triedFallback = false;
                ui.removeCallbacks(poller);
                ui.postDelayed(poller, POLL_MS);
            }
        });
        // Never stay latched: if the reload does not land, allow another try.
        ui.postDelayed(new Runnable() {
            @Override public void run() { restoring = false; }
        }, 15000L);
    }

    private boolean restoring = false;
    private boolean sawPlayerPage = false;

    // ----------------------------------------------------------- channel rail

    private void setRailOpen(boolean open) {
        if (railOpen == open) return;
        railOpen = open;
        ui.removeCallbacks(railHider);
        if (open) {
            railIndex = currentIndex;
            rail.setSelected(railIndex, false);
            rail.setHeader("频道 · " + Channels.ALL.length + " 个台");
            rail.setVisibility(View.VISIBLE);
            rail.setAlpha(0f);
            rail.animate().alpha(1f).translationX(0f).setDuration(180).start();
            ui.postDelayed(railHider, RAIL_HIDE_MS);
        } else {
            rail.animate().alpha(0f).setDuration(140).withEndAction(new Runnable() {
                @Override public void run() { rail.setVisibility(View.GONE); }
            }).start();
        }
    }

    private void moveRail(int delta) {
        int next = railIndex + delta;
        if (next < 0) next = 0;
        if (next >= Channels.ALL.length) next = Channels.ALL.length - 1;
        if (next != railIndex) {
            railIndex = next;
            rail.setSelected(railIndex, false);
            ui.removeCallbacks(railHider);
            ui.postDelayed(railHider, RAIL_HIDE_MS);
            ensureProgram(railIndex);
        }
    }

    /**
     * Zap to the next/previous channel by dial position.
     *
     * The reference point is railIndex, which the page updates the moment it
     * adopts a channel. Using currentIndex instead would make rapid presses
     * cancel each other out, because currentIndex only advances once a picture
     * has been confirmed.
     */
    private void zap(int delta) {
        int next = railIndex + delta;
        if (next < 0) next = Channels.ALL.length - 1;
        if (next >= Channels.ALL.length) next = 0;
        tune(next);
    }

    // ------------------------------------------------------------- input

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        int action = e.getAction();

        // The engine gate owns the screen until it is dismissed.
        if (engineBlocked || engineWarned) {
            if (action == KeyEvent.ACTION_DOWN) {
                if (isOk(code)) {
                    if (engineBlocked) {
                        engineBlocked = false;
                        engineWarned = false;
                        startPlayback();
                    } else {
                        engineWarned = false;
                        startPlayback();
                    }
                    return true;
                }
                if (code == KeyEvent.KEYCODE_BACK) {
                    finish();
                    return true;
                }
            }
            return true;
        }

        // While the tune cover is up, the only useful keys are retry/back.
        if (overlay.getMode() == OverlayView.MODE_MESSAGE && tuning) {
            if (action == KeyEvent.ACTION_DOWN && isOk(code)) {
                tune(safeIndex(railIndex));
                return true;
            }
        }

        switch (code) {
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_CHANNEL_UP:
                if (action == KeyEvent.ACTION_DOWN) {
                    if (railOpen) moveRail(-1); else zap(-1);
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
                if (action == KeyEvent.ACTION_DOWN) {
                    if (railOpen) moveRail(1); else zap(1);
                }
                return true;

            case KeyEvent.KEYCODE_MEDIA_NEXT:
                if (action == KeyEvent.ACTION_DOWN) zap(1);
                return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                if (action == KeyEvent.ACTION_DOWN) zap(-1);
                return true;

            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_SPACE:
                if (action == KeyEvent.ACTION_DOWN) {
                    if (railOpen) {
                        tune(railIndex);
                        setRailOpen(false);
                    } else if (tuning) {
                        tune(safeIndex(railIndex));
                    } else {
                        setRailOpen(true);
                    }
                }
                return true;

            case KeyEvent.KEYCODE_DPAD_LEFT:
                if (action == KeyEvent.ACTION_DOWN && railOpen) {
                    setRailOpen(false);
                    return true;
                }
                return false;

            case KeyEvent.KEYCODE_MENU:
                if (action == KeyEvent.ACTION_DOWN) setRailOpen(!railOpen);
                return true;

            // Show which engine is actually rendering the page. Handy on a TV,
            // where there is no easy way to read the WebView version otherwise.
            case KeyEvent.KEYCODE_INFO:
            case KeyEvent.KEYCODE_HELP:
                if (action == KeyEvent.ACTION_DOWN) showEngineInfo();
                return true;

            case KeyEvent.KEYCODE_BACK:
                if (action == KeyEvent.ACTION_DOWN) {
                    if (railOpen) { setRailOpen(false); return true; }
                    if (overlay.isShowing()) { overlay.hide(); return true; }
                }
                return super.dispatchKeyEvent(e);
        }

        // Direct dial: type a channel number, briefly wait, then tune.
        int digit = digitFor(code);
        if (digit >= 0 && action == KeyEvent.ACTION_DOWN) {
            long now = System.currentTimeMillis();
            if (now - digitsAt > 1200L) digits = 0;
            digitsAt = now;
            digits = digits * 10 + digit;
            if (digits > Channels.ALL.length) digits = digit;
            final int target = digits - 1;
            rail.setHeader("输入 " + digits);
            if (!railOpen) {
                // Show the rail so the number the user typed is visible.
                setRailOpen(true);
            }
            railIndex = safeIndex(target);
            rail.setSelected(railIndex, true);
            ui.removeCallbacks(railHider);
            ui.removeCallbacks(dialConfirm);
            ui.postDelayed(dialConfirm, 1100L);
            return true;
        }

        return super.dispatchKeyEvent(e);
    }

    private final Runnable dialConfirm = new Runnable() {
        @Override public void run() {
            int target = digits - 1;
            digits = 0;
            if (target >= 0 && target < Channels.ALL.length) {
                tune(target);
                setRailOpen(false);
            }
        }
    };

    private static boolean isOk(int code) {
        return code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER || code == KeyEvent.KEYCODE_BUTTON_A
                || code == KeyEvent.KEYCODE_SPACE;
    }

    private static int digitFor(int code) {
        if (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9) {
            return code - KeyEvent.KEYCODE_0;
        }
        if (code >= KeyEvent.KEYCODE_NUMPAD_0 && code <= KeyEvent.KEYCODE_NUMPAD_9) {
            return code - KeyEvent.KEYCODE_NUMPAD_0;
        }
        return -1;
    }

    // ------------------------------------------------------------------- EPG

    private void loadAllPrograms() {
        for (int i = 0; i < Channels.ALL.length; i++) {
            ensureProgram(i);
        }
    }

    private void ensureProgram(int index) {
        if (index < 0 || index >= Channels.ALL.length) return;
        if (rail.getProgram(index) != null) return;
        epg.requestNowPlaying(index, Channels.ALL[index], new Epg.Listener() {
            @Override public void onNowPlaying(int idx, String title) {
                rail.setProgram(idx, title);
            }
        });
    }

    // -------------------------------------------------------------- messages

    private void showError(String title, String body) {
        tuning = false;
        ui.removeCallbacks(poller);
        overlay.showMessage(title, body, "按 OK 重新加载");
    }

    // ------------------------------------------------------------ immersive

    private void goImmersive() {
        try {
            Window w = getWindow();
            if (w == null) return;

            // The decor view does not exist until the content is attached, and
            // asking for the insets controller before that throws on some
            // ROMs, so every step here is guarded.
            View decor = w.getDecorView();
            if (decor != null) {
                decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                                | View.SYSTEM_UI_FLAG_FULLSCREEN
                                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                w.setDecorFitsSystemWindows(false);
                if (decor != null) {
                    WindowInsetsController c = w.getInsetsController();
                    if (c != null) {
                        c.hide(WindowInsets.Type.systemBars());
                        c.setSystemBarsBehavior(
                                WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "immersive mode unavailable", t);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goImmersive();
    }

    // -------------------------------------------------------------- lifecycle

    @Override
    protected void onResume() {
        super.onResume();
        goImmersive();
        if (pageReady) {
            inject();
            if (firstPictureDone) {
                // Coming back from the background: make sure the stream resumes.
                js(JOIN_AND_NUDGE);
            }
        }
        // Some players wait for a user gesture even with the setting enabled;
        // a synthetic click and play() cost nothing and rescue those pages.
        ui.postDelayed(new Runnable() {
            @Override public void run() { js(JOIN_AND_NUDGE); }
        }, 6000L);
        if (epg != null) ui.postDelayed(epgRefresher, 2500L);
        ui.removeCallbacks(pageWatchdog);
        ui.postDelayed(pageWatchdog, 4000L);
    }

    /**
     * Nudge every player on the page into playing. Used on resume and as a
     * periodic rescue, because some embedded players require a gesture.
     */
    private static final String JOIN_AND_NUDGE =
            "(function(){try{"
            + "var vs=document.getElementsByTagName('video');"
            + "for(var i=0;i<vs.length;i++){var v=vs[i];"
            + "try{if(v.paused){var p=v.play();if(p&&p['catch'])p['catch'](function(){});}}catch(e){}"
            + "}"
            + "if(window.__YSP&&window.__YSP.nudge)window.__YSP.nudge();"
            + "}catch(e){}})();";

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(epgRefresher);
        ui.removeCallbacks(pageWatchdog);
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (epg != null) epg.shutdown();
        if (web != null) {
            try {
                root.removeView(web);
                web.destroy();
            } catch (Throwable t) {
                Log.w(TAG, "webview destroy", t);
            }
        }
        super.onDestroy();
    }

    // ----------------------------------------------------------------- utils

    private String readAsset(String name) {
        InputStream in = null;
        try {
            in = getAssets().open(name);
            ByteArrayOutputStream bos = new ByteArrayOutputStream(32768);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            Log.e(TAG, "cannot read asset " + name, t);
            return "";
        } finally {
            if (in != null) try { in.close(); } catch (Throwable ignored) { }
        }
    }
}
