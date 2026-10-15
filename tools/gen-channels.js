// Generate the 48-channel lineup (CCTV-1..17 + 31 provincial satellites) from
// the harvested ground-truth data, and emit Channels.java.
const fs = require('fs');
const path = require('path');

const DIR = 'D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\research';
const raw = JSON.parse(fs.readFileSync(path.join(DIR, 'channels-raw.json'), 'utf8'));

const pidOf = (row) => {
  const m = /pid=(\d+)/.exec(row ? (row.href || '') : '');
  return m ? m[1] : null;
};
const byName = {};
raw.forEach((r) => { if (r.name) byName[r.name] = r; });

// ---- CCTV-1 .. CCTV-17 ----------------------------------------------------
// CCTV1's pid never appears in the page URL (it is the default route), so it is
// taken from the page's own EPG request for the default channel.
const CCTV = [
  { no: 1,  show: 'CCTV-1 综合',      key: 'CCTV1',      pid: '600001859', cctv: 'cctv1'     },
  { no: 2,  show: 'CCTV-2 财经',      key: 'CCTV2',      cctv: 'cctv2'     },
  { no: 3,  show: 'CCTV-3 综艺',      key: 'CCTV3',      cctv: 'cctv3'     },
  { no: 4,  show: 'CCTV-4 中文国际',  key: 'CCTV4',      cctv: 'cctv4'     },
  { no: 5,  show: 'CCTV-5 体育',      key: 'CCTV5',      cctv: 'cctv5'     },
  { no: 6,  show: 'CCTV-6 电影',      key: 'CCTV6',      cctv: 'cctv6'     },
  { no: 7,  show: 'CCTV-7 国防军事',  key: 'CCTV7',      cctv: 'cctv7'     },
  { no: 8,  show: 'CCTV-8 电视剧',    key: 'CCTV8',      cctv: 'cctv8'     },
  { no: 9,  show: 'CCTV-9 纪录',      key: 'CCTV9',      cctv: 'cctvjilu'  },
  { no: 10, show: 'CCTV-10 科教',     key: 'CCTV10',     cctv: 'cctv10'    },
  { no: 11, show: 'CCTV-11 戏曲',     key: 'CCTV11',     cctv: 'cctv11'    },
  { no: 12, show: 'CCTV-12 社会与法', key: 'CCTV12',     cctv: 'cctv12'    },
  { no: 13, show: 'CCTV-13 新闻',     key: 'CCTV13',     cctv: 'cctv13'    },
  { no: 14, show: 'CCTV-14 少儿',     key: 'CCTV14',     cctv: 'cctvchild' },
  { no: 15, show: 'CCTV-15 音乐',     key: 'CCTV15',     cctv: 'cctv15'    },
  { no: 16, show: 'CCTV-16 奥林匹克', key: 'CCTV16-HD',  cctv: 'cctv16'    },
  { no: 17, show: 'CCTV-17 农业农村', key: 'CCTV17',     cctv: 'cctv17'    },
];

// ---- 31 provincial satellites, conventional dial order --------------------
const SAT = [
  '北京卫视', '东方卫视', '天津卫视', '重庆卫视', '河北卫视', '山西卫视',
  '内蒙古卫视', '辽宁卫视', '吉林卫视', '黑龙江卫视', '江苏卫视', '浙江卫视',
  '安徽卫视', '福建东南卫视', '江西卫视', '山东卫视', '河南卫视', '湖北卫视',
  '湖南卫视', '广东卫视', '广西卫视', '海南卫视', '四川卫视', '贵州卫视',
  '云南卫视', '西藏卫视', '陕西卫视', '甘肃卫视', '青海卫视', '宁夏卫视',
  '新疆卫视',
];

if (SAT.length !== 31) { console.error('SAT must be 31, got', SAT.length); process.exit(1); }

const out = [];
CCTV.forEach((c) => {
  const pid = c.pid || pidOf(byName[c.key]);
  if (!pid) { console.error('MISSING pid for', c.show, '(key', c.key + ')'); process.exitCode = 1; return; }
  out.push({ no: c.no, name: c.show, short: 'CCTV-' + c.no, pid, cctv: c.cctv, group: '央视' });
});

SAT.forEach((name, i) => {
  const pid = pidOf(byName[name]);
  if (!pid) { console.error('MISSING pid for', name); process.exitCode = 1; return; }
  out.push({ no: 18 + i, name, short: name, pid, cctv: null, group: '卫视' });
});

if (out.length !== 48) { console.error(`FATAL: expected 48 channels, built ${out.length}`); process.exit(1); }
const uniquePids = new Set(out.map((c) => c.pid));
if (uniquePids.size !== 48) { console.error(`FATAL: ${uniquePids.size} unique pids, expected 48`); process.exit(1); }

fs.writeFileSync(path.join(DIR, 'channels.json'), JSON.stringify(out, null, 2), 'utf8');

// ---- emit Java -----------------------------------------------------------
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const rows = out.map((c) =>
  `        new Channel(${c.no}, "${esc(c.name)}", "${esc(c.short)}", "${c.pid}", ${c.cctv ? '"' + c.cctv + '"' : 'null'}, "${esc(c.group)}"),`
).join('\n');

const java = `package com.dsh.ysptv;

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
${rows}
    };

    public static int indexOfPid(String pid) {
        if (pid == null) return -1;
        for (int i = 0; i < ALL.length; i++) {
            if (pid.equals(ALL[i].pid)) return i;
        }
        return -1;
    }
}
`;
fs.writeFileSync('D:\\Desktop\\deepseek-dsh\\yangshipin-tv\\app\\src\\main\\java\\com\\dsh\\ysptv\\Channels.java', java, 'utf8');

console.log('OK: 48 channels, 48 unique pids\n');
console.log('no  name                 short           pid          cctv');
out.forEach((c) => console.log(
  String(c.no).padStart(2) + '  ' + c.name.padEnd(20) + ' ' + c.short.padEnd(15) + ' ' + c.pid.padEnd(12) + ' ' + (c.cctv || '-')
));
