package com.dsh.ysptv;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Fetches "what is on right now" for every channel.
 *
 * <p>The site's own PC client asks
 * {@code https://capi.yangshipin.cn/api/yspepg/program/<pid>/<yyyyMMdd>} and gets
 * a protobuf schedule back. We read the same endpoint and decode it here: each
 * record carries the programme name and its start/end as epoch seconds, so the
 * current programme is simply the record whose window contains "now". That is
 * the same data the web page renders into its programme strip, obtained without
 * scraping the DOM.
 */
public final class Epg {

    private static final String TAG = "YspEpg";
    private static final String ENDPOINT = "https://capi.yangshipin.cn/api/yspepg/program/";
    private static final String SERVER_TIME = "https://csapi.yangshipin.cn/voapi/omsot/serverTime";
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    + "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final long CACHE_TTL_MS = 20 * 60 * 1000L;
    private static final long TIME_TTL_MS = 10 * 60 * 1000L;

    /** Correction applied to the device clock, taken from the site's own server. */
    private volatile long clockOffsetMs = 0L;
    private volatile long clockFetchedAt = 0L;

    /** A single programme slot. */
    public static final class Prog {
        public String name;
        public long start;   // epoch seconds
        public long end;     // epoch seconds
        public String startText;
        public String endText;
    }

    /** Callback for a resolved "now playing" title. */
    public interface Listener {
        /** @param title the programme on air, or null when unknown. */
        void onNowPlaying(int channelIndex, String title);
    }

    private static final class Entry {
        List<Prog> progs;
        long fetchedAt;
        String title;
    }

    private final Map<String, Entry> cache = new ConcurrentHashMap<String, Entry>();
    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile boolean stopped;

    /** Forget everything; used when the day rolls over so titles stay correct. */
    public void invalidateAll() {
        cache.clear();
    }

    public void shutdown() {
        stopped = true;
        pool.shutdownNow();
    }

    /**
     * Resolve the current programme for one channel and report it on the main thread.
     * Cached values are delivered immediately.
     */
    public void requestNowPlaying(final int index, final Channel ch, final Listener listener) {
        if (stopped || ch == null) return;

        Entry cached = cache.get(ch.pid);
        if (cached != null && System.currentTimeMillis() - cached.fetchedAt < CACHE_TTL_MS
                && cached.title != null) {
            final String t = cached.title;
            main.post(new Runnable() {
                @Override public void run() { listener.onNowPlaying(index, t); }
            });
            return;
        }

        pool.execute(new Runnable() {
            @Override public void run() {
                String title = null;
                try {
                    title = fetchNowPlaying(ch.pid);
                } catch (Throwable t) {
                    Log.w(TAG, "epg failed for " + ch.pid + ": " + t);
                }
                Entry e = new Entry();
                e.fetchedAt = System.currentTimeMillis();
                e.title = title;
                cache.put(ch.pid, e);

                if (title != null && !stopped) {
                    final String t = title;
                    main.post(new Runnable() {
                        @Override public void run() { listener.onNowPlaying(index, t); }
                    });
                }
            }
        });
    }

    /** Blocking: download + decode the schedule and pick the slot covering now. */
    private String fetchNowPlaying(String pid) throws Exception {
        refreshClockOffset();
        long now = correctedNowSeconds();
        // Try today, then yesterday and tomorrow so the answer stays right
        // across midnight and across timezone edges.
        long[] days = { 0L, -86400L, 86400L };
        for (long delta : days) {
            String day = new SimpleDateFormat("yyyyMMdd", Locale.US)
                    .format(new Date((now + delta) * 1000L));
            List<Prog> progs = fetchDay(pid, day);
            if (progs.isEmpty()) continue;
            for (Prog p : progs) {
                if (p.name == null || p.name.length() == 0) continue;
                if (p.start > 0 && p.end > p.start && now >= p.start && now < p.end) {
                    return p.name;
                }
            }
            // Schedule came back but nothing matched "now" (clock skew): fall back
            // to the last slot that has already started.
            Prog best = null;
            for (Prog p : progs) {
                if (p.start > 0 && p.start <= now && (best == null || p.start > best.start)) best = p;
            }
            if (best != null && best.name != null) return best.name;
        }
        return null;
    }

    private long correctedNowSeconds() {
        return (System.currentTimeMillis() + clockOffsetMs) / 1000L;
    }

    /**
     * Align with the site's own clock.
     *
     * The schedule is absolute epoch time, so a TV whose clock is wrong would
     * otherwise show the wrong programme. The endpoint is open and returns
     * protobuf {code=1, data=2{ts=1}} with the timestamp in milliseconds.
     */
    private void refreshClockOffset() {
        long age = System.currentTimeMillis() - clockFetchedAt;
        if (clockFetchedAt != 0 && age < TIME_TTL_MS) return;
        HttpURLConnection c = null;
        try {
            long t0 = System.currentTimeMillis();
            c = (HttpURLConnection) new URL(SERVER_TIME).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(8000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Referer", "https://www.yangshipin.cn/");
            if (c.getResponseCode() != 200) return;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream(256);
            byte[] buf = new byte[512];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            long ts = parseServerTime(bos.toByteArray());
            if (ts > 100000000000L) { // looks like milliseconds
                long t1 = System.currentTimeMillis();
                clockOffsetMs = ts - ((t0 + t1) / 2);
                clockFetchedAt = t1;
                Log.d(TAG, "clock offset " + clockOffsetMs + " ms");
            }
        } catch (Throwable t) {
            Log.w(TAG, "serverTime failed: " + t);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Pull the ms timestamp out of {code=1, data=2{ts=1}}. */
    static long parseServerTime(byte[] data) {
        if (data == null) return 0L;
        int[] pos = { 0 };
        while (pos[0] < data.length) {
            long tag;
            try {
                tag = readVarint(data, pos);
            } catch (Exception e) {
                break;
            }
            int field = (int) (tag >>> 3);
            int wire = (int) (tag & 7);
            if (wire == 0) {
                readVarint(data, pos);
            } else if (wire == 2) {
                long len = readVarint(data, pos);
                int l = (int) len;
                if (l < 0 || pos[0] + l > data.length) break;
                if (field == 2) {
                    // Nested {ts=1}
                    int[] p2 = { pos[0] };
                    int end = pos[0] + l;
                    while (p2[0] < end) {
                        long t2;
                        try {
                            t2 = readVarint(data, p2);
                        } catch (Exception e) {
                            break;
                        }
                        int f2 = (int) (t2 >>> 3);
                        int w2 = (int) (t2 & 7);
                        if (w2 == 0) {
                            long v = readVarint(data, p2);
                            if (f2 == 1) return v;
                        } else if (w2 == 2) {
                            long l2 = readVarint(data, p2);
                            p2[0] += (int) l2;
                        } else if (w2 == 5) {
                            p2[0] += 4;
                        } else if (w2 == 1) {
                            p2[0] += 8;
                        } else break;
                    }
                }
                pos[0] += l;
            } else if (wire == 5) {
                pos[0] += 4;
            } else if (wire == 1) {
                pos[0] += 8;
            } else {
                break;
            }
        }
        return 0L;
    }

    private List<Prog> fetchDay(String pid, String day) throws Exception {
        HttpURLConnection c = null;
        try {
            URL url = new URL(ENDPOINT + pid + "/" + day);
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Referer", "https://www.yangshipin.cn/");
            c.setRequestProperty("Accept", "*/*");
            int code = c.getResponseCode();
            if (code != 200) return new ArrayList<Prog>();
            InputStream in = c.getInputStream();
            ByteArrayOutputStream bos = new ByteArrayOutputStream(8192);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
            return parse(bos.toByteArray());
        } finally {
            if (c != null) c.disconnect();
        }
    }

    // ------------------------------------------------------------------
    // Minimal protobuf reader for the schedule payload.
    //
    // Top level : 1=varint(code)  2=repeated message(programme)  3=string(msg)
    // Programme : 1=string(id) 2=string(name) 3=varint(start epoch s)
    //             4=varint(end epoch s) 5/6=string(HH:mm) 7=varint(seconds)
    // ------------------------------------------------------------------

    static List<Prog> parse(byte[] data) {
        List<Prog> out = new ArrayList<Prog>();
        if (data == null) return out;
        int[] pos = { 0 };
        while (pos[0] < data.length) {
            long tag;
            try {
                tag = readVarint(data, pos);
            } catch (Exception e) {
                break;
            }
            int field = (int) (tag >>> 3);
            int wire = (int) (tag & 7);
            if (wire == 0) {
                readVarint(data, pos);
            } else if (wire == 2) {
                long len = readVarint(data, pos);
                int l = (int) len;
                if (l < 0 || pos[0] + l > data.length) break;
                if (field == 2) {
                    Prog p = parseRecord(data, pos[0], pos[0] + l);
                    if (p != null && p.name != null && p.name.length() > 0) out.add(p);
                }
                pos[0] += l;
            } else if (wire == 5) {
                pos[0] += 4;
            } else if (wire == 1) {
                pos[0] += 8;
            } else {
                break;
            }
        }
        return out;
    }

    private static Prog parseRecord(byte[] b, int start, int end) {
        Prog p = new Prog();
        int[] pos = { start };
        while (pos[0] < end) {
            long tag;
            try {
                tag = readVarint(b, pos);
            } catch (Exception e) {
                break;
            }
            int field = (int) (tag >>> 3);
            int wire = (int) (tag & 7);
            if (wire == 0) {
                long v = readVarint(b, pos);
                if (field == 3) p.start = v;
                else if (field == 4) p.end = v;
            } else if (wire == 2) {
                long len = readVarint(b, pos);
                int l = (int) len;
                if (l < 0 || pos[0] + l > end) break;
                String s = new String(b, pos[0], l, java.nio.charset.Charset.forName("UTF-8"));
                if (field == 2) p.name = s.trim();
                else if (field == 5) p.startText = s;
                else if (field == 6) p.endText = s;
                pos[0] += l;
            } else if (wire == 5) {
                pos[0] += 4;
            } else if (wire == 1) {
                pos[0] += 8;
            } else {
                break;
            }
        }
        return p;
    }

    private static long readVarint(byte[] b, int[] pos) {
        long result = 0;
        int shift = 0;
        while (pos[0] < b.length) {
            int x = b[pos[0]++] & 0xFF;
            result |= ((long) (x & 0x7F)) << shift;
            if ((x & 0x80) == 0) break;
            shift += 7;
            if (shift > 63) break;
        }
        return result;
    }
}
