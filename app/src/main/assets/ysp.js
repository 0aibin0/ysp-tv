/*
 * ysp.js - injected into the yangshipin TV page.
 *
 * Rules this file follows, per the product requirements:
 *   - NO hardcoded CSS class names from the site. Everything is decided by
 *     geometry (position/size/stacking) or by the page's own Vue data.
 *   - Keep only the video picture: pin it fullscreen and cover the rest.
 *   - Switch channels in place, never by reloading the document.
 *
 * Written in ES5 on purpose: Android TV boxes often ship an old WebView and
 * ES6 syntax would be a syntax error there.
 */
(function () {
    'use strict';

    if (window.__YSP && window.__YSP.installed) return;

    var MAX_Z = 2147483000;
    var VIDEO_Z = MAX_Z;
    var SHIELD_Z = MAX_Z - 1;

    var state = {
        installed: true,
        videoFound: false,
        videoReady: false,
        readyState: -1,
        nowPlaying: '',
        currentPid: '',
        currentName: '',
        switching: false,
        lastSwitchOk: null,
        lastSwitchMs: 0,
        furnitureHidden: 0,
        lastError: '',
        fallbackMode: false,
        shielding: false
    };

    var shield = null;
    var video = null;
    var observer = null;
    var scanTimer = null;
    var switchToken = 0;
    var hiddenNodes = [];
    /** False on the backup page until a picture exists, so furniture is kept. */
    var hideFurniture = true;
    /**
     * Incremented every time we adopt a different <video> element. A change
     * means the page rebuilt its player, so any previous "it is playing"
     * conclusion is stale and the native side must wait again.
     */
    var videoGen = 0;

    /**
     * Fast mode: set while a channel change is in flight.
     *
     * Everything here is about the page's main thread, which is also the thread
     * that has to start the new stream. The full-page passes below walk
     * thousands of elements and force synchronous layout on each one, so
     * running them during a switch directly delays the picture. In fast mode we
     * keep the video pinned (cheap, a handful of nodes) and drop the rest.
     */
    var fastMode = false;

    /** Cached Vue component that owns the schedule; see findScheduleHost(). */
    var scheduleHost = null;

    /** Short-lived cache for the on-air title, which is read very often. */
    var nameCacheAt = 0;
    var nameCacheVal = '';

    /** The element we have already wired frame events onto. */
    var observedVideo = null;

    /** Last time the full pin was re-applied; see pinVideo(). */
    var lastPinAt = 0;

    /**
     * Tell the native side that a real frame is on screen.
     *
     * Called straight from the media element's own events so the black cover
     * can come off the moment the picture appears instead of on the next poll.
     * The native side decides whether it is currently tuning; this only reports
     * a fact it could not otherwise learn without asking.
     */
    function announceFrame() {
        var v = observedVideo;
        if (!v) return;
        if (v.paused || v.readyState < 2 || v.videoWidth <= 0) return;
        try {
            if (window.YspBridge && window.YspBridge.onFrame) {
                window.YspBridge.onFrame(String(videoGen),
                        String(v.videoWidth),
                        String(v.currentSrc || v.src || ''));
            }
        } catch (e) { /* bridge absent when running outside the app */ }
    }

    // ---------------------------------------------------------------- bridge

    function report() {
        try {
            if (window.YspBridge && window.YspBridge.onState) {
                window.YspBridge.onState(JSON.stringify(state));
            }
        } catch (e) { /* bridge absent when running outside the app */ }
    }

    function fail(where, e) {
        state.lastError = where + ': ' + (e && e.message ? e.message : String(e));
        report();
    }

    // ------------------------------------------------------------ video hunt

    /** The element that is actually playing, not a thumbnail or an ad slot. */
    function pickVideo() {
        var vs = document.getElementsByTagName('video');
        // The common case by far is a single player element; skip the layout
        // reads (getBoundingClientRect forces reflow) when there is no choice.
        if (vs.length === 1) return vs[0];
        var best = null, bestArea = -1;
        for (var i = 0; i < vs.length; i++) {
            var v = vs[i];
            var r = v.getBoundingClientRect();
            var area = Math.max(0, r.width) * Math.max(0, r.height);
            // Prefer a video that has a real source and real size.
            var score = area + (v.src || v.currentSrc ? 1000000 : 0);
            if (score > bestArea) { bestArea = score; best = v; }
        }
        return best;
    }

    function findScrollRoot() {
        var de = document.documentElement;
        if (de && de.scrollHeight > de.clientHeight) return de;
        var b = document.body;
        if (b && b.scrollHeight > b.clientHeight) return b;
        return de || b;
    }

    /** Stop ancestors from clipping or repositioning the video. */
    function releaseAncestors(v) {
        var p = v.parentNode;
        var guard = 0;
        while (p && p.nodeType === 1 && guard++ < 200) {
            try {
                var s = p.style;
                if (s) {
                    s.overflow = 'visible';
                    s.overflowX = 'visible';
                    s.overflowY = 'visible';
                    s.clip = 'auto';
                    s.clipPath = 'none';
                    s.transform = 'none';
                    s.webkitTransform = 'none';
                    s.filter = 'none';
                    s.webkitFilter = 'none';
                    s.perspective = 'none';
                    s.contain = 'none';
                    s.willChange = 'auto';
                    s.maxHeight = 'none';
                    s.maxWidth = 'none';
                    s.opacity = '1';
                }
            } catch (e) { /* keep going */ }
            p = p.parentNode;
        }
    }

    /** Show or hide the black seam-hider that sits just under the video. */
    function setShield(on) {
        if (on === state.shielding && shield && shield.parentNode) return;
        state.shielding = !!on;
        if (!on) {
            if (shield && shield.parentNode) {
                shield.parentNode.removeChild(shield);
            }
            shield = null;
            return;
        }
        ensureShield();
    }

    function ensureShield() {
        if (shield && shield.parentNode) return shield;
        shield = document.getElementById('ysp-shield');
        if (!shield) {
            shield = document.createElement('div');
            shield.id = 'ysp-shield';
            shield.setAttribute('aria-hidden', 'true');
            (document.body || document.documentElement).appendChild(shield);
        }
        shield.style.cssText =
            'position:fixed!important;left:0!important;top:0!important;' +
            'width:100vw!important;height:100vh!important;margin:0!important;' +
            'padding:0!important;border:0!important;background:#000!important;' +
            'z-index:' + SHIELD_Z + '!important;pointer-events:none!important;';
        return shield;
    }

    /** Pin the video to the viewport, above everything, letterboxed on black. */
    function pinVideo() {
        var v = pickVideo();
        if (!v) {
            // Nothing playing yet: hide the shield so the page's own poster,
            // spinner or message is visible instead of a dead black screen.
            if (!state.fallbackMode) setShield(false);
            state.videoFound = false;
            state.videoReady = false;
            return;
        }

        var changed = (v !== video);
        if (changed) {
            video = v;
            state.videoFound = true;
            // A different element means the player was rebuilt (typical right
            // after a channel change), so anything we concluded about the old
            // one no longer applies.
            videoGen++;
        }

        // Releasing ancestors walks the whole chain and writes ~15 properties
        // per level. That is far too expensive to repeat on a timer, and it is
        // the page's main thread -- the same one starting the new stream -- so
        // it only runs when the element actually changes, plus an occasional
        // re-assert in case the site rewrote our inline styles.
        //
        // It is also skipped entirely during a channel change: rewriting
        // transform/filter/contain on the video's ancestors can knock the
        // element out of its hardware-composited layer, and re-promoting it
        // costs far more than the styling is worth at that moment.
        var now = Date.now();
        if (!fastMode && (changed || (now - lastPinAt) > 3000)) {
            lastPinAt = now;
            releaseAncestors(v);
            applyPin(v);
        } else if (!fastMode && !state.shielding && !state.fallbackMode) {
            setShield(true);
        }

        // Only black out the page once there is a real picture to replace it.
        var hasPicture = !v.paused && v.readyState >= 2 && v.videoWidth > 0;
        if (hasPicture || !state.fallbackMode) setShield(true);

        // Push the moment the first frame of a new stream is on screen, rather
        // than making the native side wait for its next poll. This is what
        // keeps a channel change feeling instant.
        if (observedVideo !== v) {
            observedVideo = v;
            v.addEventListener('loadeddata', announceFrame);
            v.addEventListener('playing', announceFrame);
            v.addEventListener('canplay', announceFrame);
        }
    }

    /** Write the fullscreen pin onto the element. */
    function applyPin(v) {
        var s = v.style;
        s.setProperty('position', 'fixed', 'important');
        s.setProperty('left', '0', 'important');
        s.setProperty('top', '0', 'important');
        s.setProperty('right', 'auto', 'important');
        s.setProperty('bottom', 'auto', 'important');
        s.setProperty('width', '100vw', 'important');
        s.setProperty('height', '100vh', 'important');
        s.setProperty('max-width', 'none', 'important');
        s.setProperty('max-height', 'none', 'important');
        s.setProperty('min-width', '0', 'important');
        s.setProperty('min-height', '0', 'important');
        s.setProperty('margin', '0', 'important');
        s.setProperty('padding', '0', 'important');
        s.setProperty('border', '0', 'important');
        s.setProperty('transform', 'none', 'important');
        s.setProperty('object-fit', 'contain', 'important');
        s.setProperty('background', '#000', 'important');
        s.setProperty('visibility', 'visible', 'important');
        s.setProperty('opacity', '1', 'important');
        s.setProperty('z-index', String(VIDEO_Z), 'important');
        s.setProperty('pointer-events', 'auto', 'important');

        // Keep the page scrolled to the top so nothing slides under the video.
        try {
            var root = findScrollRoot();
            if (root && (root.scrollTop || 0) !== 0) root.scrollTop = 0;
            if (window.scrollY) window.scrollTo(0, 0);
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------- furniture suppression

    function isAncestorOfVideo(el) {
        if (!video) return false;
        if (el === video) return true;
        return el.contains ? el.contains(video) : false;
    }

    function hide(el) {
        if (!el || el === shield || el === video) return;
        if (isAncestorOfVideo(el)) return;
        try {
            el.style.setProperty('display', 'none', 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            hiddenNodes.push(el);
            state.furnitureHidden = hiddenNodes.length;
        } catch (e) { /* ignore */ }
    }

    /**
     * Decide purely from geometry and stacking whether a node is page furniture
     * sitting on top of the player (login modal, app-download banner, the
     * channel/programme rail, transport bar) rather than part of the picture.
     */
    function looksLikeFurniture(el, vw, vh) {
        if (!el || el.nodeType !== 1) return false;
        if (el === shield || el === video) return false;
        if (el.id === 'ysp-shield') return false;
        if (isAncestorOfVideo(el)) return false;

        var r;
        try { r = el.getBoundingClientRect(); } catch (e) { return false; }
        if (r.width < 40 || r.height < 24) return false;

        var s;
        try { s = getComputedStyle(el); } catch (e) { return false; }
        if (s.display === 'none' || s.visibility === 'hidden') return false;

        var pos = s.position;
        if (pos !== 'fixed' && pos !== 'absolute' && pos !== 'sticky') return false;

        var z = parseInt(s.zIndex, 10);
        if (isNaN(z)) z = 0;

        // Anything that visually floats above the page and is big enough to be
        // furniture. The real picture is already pinned above all of it.
        var coversWide = r.width > vw * 0.45;
        var coversTall = r.height > vh * 0.28;
        var floats = z >= 5;

        if (coversWide && floats) return true;               // banners, rails, bars
        if (coversTall && r.width > vw * 0.25 && floats) return true; // side panels, modals
        return false;
    }

    /** Text that means "install our app" / "sign in", used to kill modals early. */
    var PROMPT = /(下载|立即下载|打开\s*APP|打开央视频|客户端|扫码|登录|注册|同意|隐私|我知道了)/;

    function suppressFurniture() {
        var vw = window.innerWidth || 1280;
        var vh = window.innerHeight || 720;
        var nodes = document.body ? document.body.getElementsByTagName('*') : [];
        var scanned = 0;
        for (var i = 0; i < nodes.length && scanned < 4000; i++) {
            var el = nodes[i];
            scanned++;
            if (!looksLikeFurniture(el, vw, vh)) continue;

            var txt = '';
            try { txt = (el.innerText || el.textContent || '').slice(0, 400); } catch (e) { txt = ''; }
            var r = el.getBoundingClientRect();
            var top = r.top < vh * 0.16 && r.width > vw * 0.5;
            var bottom = r.bottom > vh * 0.84 && r.width > vw * 0.5;
            var rightRail = r.left > vw * 0.62 && r.height > vh * 0.35;
            var centreModal = (r.width > vw * 0.25 && r.height > vh * 0.25 &&
                               r.left > vw * 0.12 && r.right < vw * 0.88);

            if (top || bottom || rightRail || centreModal || PROMPT.test(txt)) {
                hide(el);
            }
        }
    }

    // -------------------------------------------------- now-playing programme

    /** Find the Vue component that owns the channel/schedule data. */
    function findScheduleHost() {
        // Reuse the previous answer while it is still attached and valid; the
        // scan below walks every element in the document and is far too
        // expensive to repeat on a timer.
        if (scheduleHost) {
            var h = scheduleHost;
            if (h.$el && h.$el.parentNode && h.$data && h.$data.currentJiemu) return h;
            scheduleHost = null;
        }
        var all = document.getElementsByTagName('*');
        var seen = [];
        for (var i = 0; i < all.length; i++) {
            var v = all[i].__vue__;
            if (!v || seen.indexOf(v) >= 0) continue;
            seen.push(v);
            var d = v.$data;
            if (d && d.currentJiemu && d.currentJiemu.length) {
                scheduleHost = v;
                return v;
            }
        }
        return null;
    }

    function scheduleNowPlaying() {
        var host = findScheduleHost();
        if (!host) return '';
        var list = host.currentJiemu;
        if (!list || !list.length) return '';
        var now = Math.floor(Date.now() / 1000);
        var i, p;

        // The page flags the on-air slot with sta === 2.
        for (i = 0; i < list.length; i++) {
            p = list[i];
            if (p && Number(p.sta) === 2 && p.name) return String(p.name);
        }
        // Otherwise use the slot whose time window contains now.
        for (i = 0; i < list.length; i++) {
            p = list[i];
            var st = Number(p.st), et = Number(p.et);
            if (p && p.name && st && et && now >= st && now < et) return String(p.name);
        }
        return '';
    }

    /**
     * DOM fallback for the on-air title, without relying on class names: the
     * page renders a strip of programme slots where the current one is marked.
     *
     * This is a last resort. Reading innerText forces synchronous layout, so
     * doing it over hundreds of candidates is expensive; it only runs when the
     * page's own data did not answer, and never while a channel change is in
     * flight.
     */
    function domNowPlaying() {
        if (fastMode) return '';
        var cands = document.querySelectorAll('[class*="cur"],[class*="sel"],[class*="active"],[class*="on"]');
        var timeRe = /\d{1,2}:\d{2}/;
        for (var i = 0; i < cands.length && i < 120; i++) {
            var el = cands[i];
            if (isAncestorOfVideo(el)) continue;
            // textContent is far cheaper than innerText: it does not need
            // layout, and we only need a rough read to reject candidates.
            var t = '';
            try { t = (el.textContent || '').trim(); } catch (e) { continue; }
            if (!t || t.length > 120) continue;
            if (!timeRe.test(t)) continue;
            var lines = t.split('\n');
            for (var j = 0; j < lines.length; j++) {
                var ln = lines[j].trim();
                if (ln && !timeRe.test(ln) && ln.length > 1) return ln;
            }
        }
        return '';
    }

    function currentName() {
        // currentName() is polled several times a second by the native side,
        // and the DOM fallback queries the whole document. A short cache keeps
        // that off the main thread while a stream is starting up.
        var t = Date.now();
        if (nameCacheVal && (t - nameCacheAt) < 900) return nameCacheVal;
        var v = scheduleNowPlaying();
        if (!v) v = domNowPlaying();
        if (v) {
            nameCacheVal = v;
            nameCacheAt = t;
        }
        return v || nameCacheVal;
    }

    // -------------------------------------------------------- channel switch

    /** Direct text of an element, ignoring child elements' text. */
    function ownText(el) {
        var out = '';
        for (var i = 0; i < el.childNodes.length; i++) {
            var n = el.childNodes[i];
            if (n.nodeType === 3) out += n.nodeValue;
        }
        return out.replace(/\s+/g, ' ').trim();
    }

    function depthOf(el) {
        var d = 0;
        while (el && el.parentNode) { d++; el = el.parentNode; }
        return d;
    }

    function norm(s) {
        return String(s == null ? '' : s).replace(/\s+/g, '').toUpperCase();
    }

    /**
     * Find the clickable element that selects a channel.
     * Matches on visible text, then prefers the most deeply nested candidate,
     * because that is the one carrying the site's click handler.
     */
    function findChannelEl(name, altName) {
        var want = norm(name);
        var wantAlt = altName ? norm(altName) : '';
        var all = document.getElementsByTagName('*');
        var hits = [];
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.children.length > 3) continue;
            var t = norm(ownText(el));
            if (!t) continue;
            if (t === want || (wantAlt && t === wantAlt)) {
                hits.push(el);
            }
        }
        if (!hits.length) return null;
        hits.sort(function (a, b) { return depthOf(b) - depthOf(a); });
        // Prefer a candidate that has siblings shaped like it (a real list).
        for (var k = 0; k < hits.length; k++) {
            var p = hits[k].parentNode;
            if (p && p.children && p.children.length >= 2) return hits[k];
        }
        return hits[0];
    }

    /** Click the tab that reveals the satellite channel list, by shape not name. */
    function findGroupTab() {
        var all = document.getElementsByTagName('*');
        var best = null, bestArea = -1;
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            var t = norm(ownText(el));
            // The two group tabs are labelled with the two list kinds; we only
            // need the second one, so look for anything that is a small,
            // clickable sibling pair above the channel list.
            if (el.children.length > 2) continue;
            var r;
            try { r = el.getBoundingClientRect(); } catch (e) { continue; }
            if (r.width < 16 || r.height < 12) continue;
            var p = el.parentNode;
            if (!p || !p.children || p.children.length !== 2) continue;
            var idx = 0, sib = null;
            for (var j = 0; j < p.children.length; j++) {
                if (p.children[j] === el) { idx = j; } else { sib = p.children[j]; }
            }
            if (idx !== 1) continue;
            var area = r.width * r.height;
            if (area > bestArea) { bestArea = area; best = el; }
        }
        return best;
    }

    function pidFromUrl() {
        var m = /[?&]pid=([0-9A-Za-z]+)/.exec(location.search || '');
        return m ? m[1] : '';
    }

    /**
     * The pid the player is actually showing.
     *
     * The URL only carries a pid once a channel has been chosen explicitly;
     * on a cold start the site renders CCTV-1 with no query string at all, so
     * fall back to the pid held by the page's own channel state.
     */
    function livePid() {
        var fromUrl = pidFromUrl();
        if (fromUrl) return fromUrl;
        try {
            var host = findScheduleHost();
            if (host) {
                if (host.tvIndex && host.tvIndex.pid) return String(host.tvIndex.pid);
                var idx = Number(host.selectIndex);
                if (host.tabA && host.tabA[idx] && host.tabA[idx].pid) {
                    return String(host.tabA[idx].pid);
                }
                if (host.tvTabs && host.tvTabs[0] && host.tvTabs[0][0] && host.tvTabs[0][0].pid) {
                    return String(host.tvTabs[0][0].pid);
                }
            }
        } catch (e) { /* fall through */ }
        return state.currentPid || '';
    }

    /**
     * Fastest path: drive the page's own channel-switch function.
     *
     * The list component exposes its channel tables and a switch method that
     * repoints the player and re-initialises it in place (the site's router
     * replaces only the query string, so the document is never reloaded).
     * Reaching this directly avoids a synthetic click entirely.
     */
    function nativeSwitch(pid) {
        try {
            var host = findScheduleHost();
            if (!host || typeof host.changeTV !== 'function') return false;
            var tables = [host.tabA, host.tabB, host.tvTabs];
            for (var t = 0; t < tables.length; t++) {
                var arr = tables[t];
                if (!arr || !arr.length) continue;
                for (var i = 0; i < arr.length; i++) {
                    var ch = arr[i];
                    if (!ch || String(ch.pid) !== String(pid)) continue;
                    try { host.selectIndex = i; } catch (e) { }
                    if (host.tvIndex && String(host.tvIndex.pid) === String(pid)) {
                        return true; // already there
                    }
                    try {
                        host.changeTV(ch);
                        return true;
                    } catch (e) {
                        fail('changeTV', e);
                        return false;
                    }
                }
            }
        } catch (e) {
            fail('nativeSwitch', e);
        }
        return false;
    }

    function videoSignature() {
        var v = video && video.parentNode ? video : pickVideo();
        if (!v) return '';
        return (v.currentSrc || v.src || '') + '|' + v.readyState;
    }

    function syncUrl(pid) {
        try {
            if (history.replaceState) {
                var u = location.pathname + (pid ? ('?pid=' + pid) : '') + location.hash;
                history.replaceState(history.state || {}, '', u);
            }
        } catch (e) { /* ignore */ }
    }

    /**
     * Switch channel without reloading the page.
     *
     * We drive the page's own channel list (the same path a mouse click takes)
     * rather than pushing a route, because the app only re-initialises the
     * player from its list handler. Success is verified by watching the URL and
     * the video element, and the whole thing is retried against alternate
     * candidates so a stale node cannot leave us on the wrong channel.
     */
    function switchTo(pid, name, altName, done) {
        var token = ++switchToken;
        var mySig = videoSignature();
        var started = Date.now();
        state.switching = true;
        state.lastSwitchOk = null;
        // Hand the main thread to the player until the new stream is up.
        fastMode = true;
        report();

        var triedTab = false;
        var triedNative = false;
        var attempts = 0;

        function finish(ok) {
            if (token !== switchToken) return;
            state.switching = false;
            state.lastSwitchOk = ok;
            state.lastSwitchMs = Date.now() - started;
            fastMode = false;
            // Re-assert the pin now that the main thread is free again; it was
            // deliberately left alone while the stream was starting. Done on
            // failure too, so a switch that did not land still leaves the
            // picture pinned rather than half-styled.
            lastPinAt = 0;
            try { pinVideo(); } catch (e) { /* ignore */ }
            if (ok) {
                state.currentPid = pid;
                state.currentName = name || '';
                syncUrl(pid);
                // Tell the native side which channel we are now on. It needs
                // this immediately -- not when the picture finally appears --
                // so the next zap is relative to the right channel instead of
                // re-targeting the one we just left.
                try {
                    if (window.YspBridge && window.YspBridge.onSwitched) {
                        window.YspBridge.onSwitched(String(pid));
                    }
                } catch (e) { /* bridge absent */ }
            }
            state.nowPlaying = currentName();
            report();
            if (done) { try { done(ok); } catch (e) { /* ignore */ } }
        }

        function check() {
            if (token !== switchToken) return;
            var urlPid = pidFromUrl();
            var moved = videoSignature() !== mySig;
            // The page adopts the new channel quickly; recognise that and stop
            // waiting, so the native side learns the new position at once.
            if (urlPid === String(pid) || moved) {
                pinVideo();
                finish(true);
                return;
            }
            if (Date.now() - started > 12000) { finish(false); return; }
            setTimeout(check, 60);
        }

        function step() {
            if (token !== switchToken) return;
            attempts++;

            // Fastest: call the page's own switcher directly.
            if (attempts === 1 || !triedNative) {
                triedNative = true;
                if (nativeSwitch(pid)) {
                    setTimeout(check, 120);
                    return;
                }
            }

            var el = findChannelEl(name, altName);
            if (!el) {
                if (!triedTab) {
                    triedTab = true;
                    var tab = findGroupTab();
                    if (tab) {
                        try { tab.click(); } catch (e) { /* ignore */ }
                        setTimeout(step, 900);
                        return;
                    }
                }
                if (attempts < 6) { setTimeout(step, 500); return; }
                finish(false);
                return;
            }

            try {
                el.scrollIntoView({ block: 'center' });
            } catch (e) { /* ignore */ }
            try {
                el.click();
            } catch (e) {
                fail('click', e);
                finish(false);
                return;
            }
            // Give the SPA a moment, then start verifying.
            setTimeout(check, 350);
        }

        step();
    }

    // ------------------------------------------------------------- lifecycle

    function survey() {
        try {
            pinVideo();
            // Never blank the backup page before it has produced a picture:
            // hiding its furniture would leave the viewer staring at nothing.
            // Skipped in fast mode: this is the single most expensive thing we
            // do, and during a channel change the main thread belongs to the
            // player that is trying to start.
            if (hideFurniture && !fastMode) suppressFurniture();
            if (video) {
                state.videoFound = true;
                state.readyState = video.readyState;
                var playing = !video.paused && !video.ended && video.readyState >= 2 &&
                              video.currentTime > 0.15;
                if (playing && !state.videoReady) state.videoReady = true;
                if (!playing && state.videoReady && video.readyState < 2) {
                    // Stream dropped; let the native side decide about fallback.
                    state.videoReady = false;
                }
                if (video.paused) {
                    try {
                        var pr = video.play();
                        if (pr && pr['catch']) pr['catch'](function () { });
                    } catch (e) { /* autoplay may be blocked until a gesture */ }
                }
            }
            var np = currentName();
            if (np && np !== state.nowPlaying) state.nowPlaying = np;
            var pu = pidFromUrl();
            if (pu && pu !== state.currentPid) state.currentPid = pu;
            report();
        } catch (e) {
            fail('survey', e);
        }
    }

    function attachObserver() {
        if (observer || !window.MutationObserver) return;
        var pending = false;
        observer = new MutationObserver(function () {
            // While a channel change is in flight the SPA rebuilds a large part
            // of the page, so this would fire back to back and keep the main
            // thread busy exactly when the new stream needs it.
            if (fastMode) return;
            if (pending) return;
            pending = true;
            setTimeout(function () { pending = false; survey(); }, 250);
        });
        try {
            observer.observe(document.documentElement, {
                childList: true, subtree: true, attributes: false
            });
        } catch (e) { /* ignore */ }
    }

    function boot() {
        state.fallbackMode = false;
        pinVideo();
        survey();
        attachObserver();
        if (scanTimer) clearInterval(scanTimer);
        // Steady state needs no polling at all: pinVideo() is event-driven via
        // the media element's own events and the mutation observer. The timer
        // exists only as a slow safety net for a page that rewrites our inline
        // styles, and it does the cheap pin only -- never the full survey.
        scanTimer = setInterval(function () {
            if (fastMode) return;
            try { pinVideo(); } catch (e) { /* ignore */ }
        }, 1500);
        // Try to start playback as soon as we have data.
        if (video) {
            video.addEventListener('loadeddata', function () { pinVideo(); });
            video.addEventListener('playing', function () { pinVideo(); });
            video.addEventListener('emptied', function () { state.videoReady = false; });
        }
        report();
    }

    /**
     * The backup source (tv.cctv.com) is a normal page, not a TV layout, so it
     * gets the same treatment: find the player, pin it, hide everything else.
     * Its player may live in an iframe, so we also try to reach into one.
     */
    function bootFallback() {
        state.fallbackMode = true;
        hideFurniture = false; // never hide page furniture before a picture exists
        pinVideo();
        survey();

        // tv.cctv.com sometimes renders its player inside an iframe. If we can
        // reach the frame's document (same-origin or permissive), pin the video
        // found there instead.
        try {
            var frames = document.getElementsByTagName('iframe');
            for (var i = 0; i < frames.length; i++) {
                var d = null;
                try { d = frames[i].contentDocument; } catch (e) { d = null; }
                if (!d) continue;
                var inner = d.querySelector && d.querySelector('video');
                if (inner) {
                    adopt(inner);
                    break;
                }
            }
        } catch (e) { /* cross-origin: fall back to the outer page */ }

        attachObserver();
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = setInterval(survey, 700);
        report();
    }

    /** Point the module at a specific video element and pin it. */
    function adopt(v) {
        if (!v) return;
        video = v;
        state.videoFound = true;
        pinVideo();
    }

    // ------------------------------------------------------------- public API

    window.__YSP = {
        installed: true,
        version: 1,

        boot: function () { try { boot(); return true; } catch (e) { fail('boot', e); return false; } },

        bootFallback: function () {
            try { bootFallback(); return true; } catch (e) { fail('bootFallback', e); return false; }
        },

        switchTo: function (pid, name, altName) {
            try { switchTo(pid, name, altName, null); return true; }
            catch (e) { fail('switchTo', e); return false; }
        },

        nowPlaying: function () { return currentName(); },

        currentPid: function () { return livePid(); },

        videoState: function () {
            var v = video && video.parentNode ? video : pickVideo();
            if (!v) return { found: false };
            return {
                found: true,
                readyState: v.readyState,
                paused: v.paused,
                ended: v.ended,
                currentTime: v.currentTime,
                duration: v.duration,
                error: v.error ? v.error.code : 0,
                src: (v.currentSrc || v.src || '').slice(0, 120),
                // videoWidth stays 0 until the engine has really decoded a
                // frame, which is what separates a live picture from the
                // player's own poster (the grey frame with the play triangle).
                vw: v.videoWidth,
                // Bumped when the page swaps in a different <video> element, so
                // the native side can tell a rebuilt player from the old one.
                gen: videoGen,
                playing: (!v.paused && !v.ended && v.readyState >= 2 && v.currentTime > 0.15)
            };
        },

        state: function () { return state; },

        nudge: function () { try { survey(); return true; } catch (e) { return false; } }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    }
    boot();
})();
