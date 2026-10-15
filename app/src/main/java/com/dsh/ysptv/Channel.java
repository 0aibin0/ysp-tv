package com.dsh.ysptv;

/** One channel in the lineup. */
public final class Channel {

    /** Dial position, 1-based (1..48). */
    public final int no;
    /** Display name, e.g. "CCTV-5 体育" or "湖南卫视". */
    public final String name;
    /** Short label for the rail, e.g. "CCTV-5". */
    public final String shortName;
    /** yangshipin programme id, used for /tv/home?pid= and for the EPG query. */
    public final String pid;
    /** tv.cctv.com URL slug for the backup source, or null for satellite channels. */
    public final String cctvSlug;
    /** "央视" or "卫视". */
    public final String group;

    public Channel(int no, String name, String shortName, String pid, String cctvSlug, String group) {
        this.no = no;
        this.name = name;
        this.shortName = shortName;
        this.pid = pid;
        this.cctvSlug = cctvSlug;
        this.group = group;
    }

    /** Backup-source URL on tv.cctv.com, or null when there is no backup for this channel. */
    public String fallbackUrl() {
        return cctvSlug == null ? null : "https://tv.cctv.com/live/" + cctvSlug + "/";
    }

    @Override
    public String toString() {
        return no + " " + name;
    }
}
