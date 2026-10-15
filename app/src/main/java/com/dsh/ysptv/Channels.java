package com.dsh.ysptv;

/**
 * The 48-channel lineup: CCTV-1..17 followed by 31 provincial satellites.
 *
 * Every pid below was captured from the live site by driving its own channel
 * list and reading the resulting /tv/home?pid=... route, so each entry is
 * ground truth rather than a guess.
 *
 * GENERATED FILE - edit tools/gen-channels.js and re-run to regenerate.
 */
public final class Channels {

    private Channels() { }

    public static final Channel[] ALL = {
        new Channel(1, "CCTV-1 综合", "CCTV-1", "600001859", "cctv1", "央视"),
        new Channel(2, "CCTV-2 财经", "CCTV-2", "600001800", "cctv2", "央视"),
        new Channel(3, "CCTV-3 综艺", "CCTV-3", "600001801", "cctv3", "央视"),
        new Channel(4, "CCTV-4 中文国际", "CCTV-4", "600001814", "cctv4", "央视"),
        new Channel(5, "CCTV-5 体育", "CCTV-5", "600001818", "cctv5", "央视"),
        new Channel(6, "CCTV-6 电影", "CCTV-6", "600108442", "cctv6", "央视"),
        new Channel(7, "CCTV-7 国防军事", "CCTV-7", "600004092", "cctv7", "央视"),
        new Channel(8, "CCTV-8 电视剧", "CCTV-8", "600001803", "cctv8", "央视"),
        new Channel(9, "CCTV-9 纪录", "CCTV-9", "600004078", "cctvjilu", "央视"),
        new Channel(10, "CCTV-10 科教", "CCTV-10", "600001805", "cctv10", "央视"),
        new Channel(11, "CCTV-11 戏曲", "CCTV-11", "600001806", "cctv11", "央视"),
        new Channel(12, "CCTV-12 社会与法", "CCTV-12", "600001807", "cctv12", "央视"),
        new Channel(13, "CCTV-13 新闻", "CCTV-13", "600001811", "cctv13", "央视"),
        new Channel(14, "CCTV-14 少儿", "CCTV-14", "600001809", "cctvchild", "央视"),
        new Channel(15, "CCTV-15 音乐", "CCTV-15", "600001815", "cctv15", "央视"),
        new Channel(16, "CCTV-16 奥林匹克", "CCTV-16", "600098637", "cctv16", "央视"),
        new Channel(17, "CCTV-17 农业农村", "CCTV-17", "600001810", "cctv17", "央视"),
        new Channel(18, "北京卫视", "北京卫视", "600002309", null, "卫视"),
        new Channel(19, "东方卫视", "东方卫视", "600002483", null, "卫视"),
        new Channel(20, "天津卫视", "天津卫视", "600152137", null, "卫视"),
        new Channel(21, "重庆卫视", "重庆卫视", "600002531", null, "卫视"),
        new Channel(22, "河北卫视", "河北卫视", "600002493", null, "卫视"),
        new Channel(23, "山西卫视", "山西卫视", "600190407", null, "卫视"),
        new Channel(24, "内蒙古卫视", "内蒙古卫视", "600190401", null, "卫视"),
        new Channel(25, "辽宁卫视", "辽宁卫视", "600002505", null, "卫视"),
        new Channel(26, "吉林卫视", "吉林卫视", "600190405", null, "卫视"),
        new Channel(27, "黑龙江卫视", "黑龙江卫视", "600002498", null, "卫视"),
        new Channel(28, "江苏卫视", "江苏卫视", "600002521", null, "卫视"),
        new Channel(29, "浙江卫视", "浙江卫视", "600002520", null, "卫视"),
        new Channel(30, "安徽卫视", "安徽卫视", "600002532", null, "卫视"),
        new Channel(31, "福建东南卫视", "福建东南卫视", "600002484", null, "卫视"),
        new Channel(32, "江西卫视", "江西卫视", "600002503", null, "卫视"),
        new Channel(33, "山东卫视", "山东卫视", "600002513", null, "卫视"),
        new Channel(34, "河南卫视", "河南卫视", "600002525", null, "卫视"),
        new Channel(35, "湖北卫视", "湖北卫视", "600002508", null, "卫视"),
        new Channel(36, "湖南卫视", "湖南卫视", "600002475", null, "卫视"),
        new Channel(37, "广东卫视", "广东卫视", "600002485", null, "卫视"),
        new Channel(38, "广西卫视", "广西卫视", "600002509", null, "卫视"),
        new Channel(39, "海南卫视", "海南卫视", "600002506", null, "卫视"),
        new Channel(40, "四川卫视", "四川卫视", "600002516", null, "卫视"),
        new Channel(41, "贵州卫视", "贵州卫视", "600002490", null, "卫视"),
        new Channel(42, "云南卫视", "云南卫视", "600190402", null, "卫视"),
        new Channel(43, "西藏卫视", "西藏卫视", "600190403", null, "卫视"),
        new Channel(44, "陕西卫视", "陕西卫视", "600190400", null, "卫视"),
        new Channel(45, "甘肃卫视", "甘肃卫视", "600190408", null, "卫视"),
        new Channel(46, "青海卫视", "青海卫视", "600190406", null, "卫视"),
        new Channel(47, "宁夏卫视", "宁夏卫视", "600190737", null, "卫视"),
        new Channel(48, "新疆卫视", "新疆卫视", "600152138", null, "卫视"),
    };

    public static int indexOfPid(String pid) {
        if (pid == null) return -1;
        for (int i = 0; i < ALL.length; i++) {
            if (pid.equals(ALL[i].pid)) return i;
        }
        return -1;
    }
}
