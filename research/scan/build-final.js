// Build the final 48-entry channel list from the live-extracted Vue state.
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('D:/Desktop/deepseek-dsh/yangshipin-tv/research/channels-raw.json', 'utf8'));

const BASE = 'https://www.yangshipin.cn/tv/home?pid=';
const byName = {};
for (const c of [...raw.tabA, ...raw.tabB]) byName[c.channelName] = c;

// --- 17 CCTV main channels: prefer the plain SD/HD one for each number ---
// tabA order confirms: CCTV16-HD is the plain one; CCTV16(4K）is the 4K variant.
// CCTV5+ is a separate channel outside the 1..17 numbering -> reported as an extra, not one of the 17.
const cctv = [
  ['CCTV-1', 'CCTV1'], ['CCTV-2', 'CCTV2'], ['CCTV-3', 'CCTV3'], ['CCTV-4', 'CCTV4'],
  ['CCTV-5', 'CCTV5'], ['CCTV-6', 'CCTV6'], ['CCTV-7', 'CCTV7'],
  ['CCTV-8', 'CCTV8'], ['CCTV-9', 'CCTV9'], ['CCTV-10', 'CCTV10'], ['CCTV-11', 'CCTV11'],
  ['CCTV-12', 'CCTV12'], ['CCTV-13', 'CCTV13'], ['CCTV-14', 'CCTV14'], ['CCTV-15', 'CCTV15'],
  ['CCTV-16', 'CCTV16-HD'], ['CCTV-17', 'CCTV17'],
];

// --- 31 provincial-level satellite channels (卫视) ---
// tabB carries 33 entries: these 31 provincial 卫视, plus 深圳卫视 (sub-provincial city
// channel, not provincial) and 中国教育电视台1频道 (CETV-1, national education, not a 卫视).
// Both extras are reported separately rather than padded into the 31.
const weishi = [
  ['北京', '北京卫视'], ['江苏', '江苏卫视'], ['东方', '东方卫视'], ['浙江', '浙江卫视'],
  ['湖南', '湖南卫视'], ['湖北', '湖北卫视'], ['广东', '广东卫视'], ['广西', '广西卫视'],
  ['黑龙江', '黑龙江卫视'], ['海南', '海南卫视'], ['重庆', '重庆卫视'], ['四川', '四川卫视'],
  ['河南', '河南卫视'], ['福建', '福建东南卫视'], ['贵州', '贵州卫视'], ['江西', '江西卫视'],
  ['辽宁', '辽宁卫视'], ['安徽', '安徽卫视'], ['河北', '河北卫视'], ['山东', '山东卫视'],
  ['天津', '天津卫视'], ['吉林', '吉林卫视'], ['陕西', '陕西卫视'], ['甘肃', '甘肃卫视'],
  ['宁夏', '宁夏卫视'], ['内蒙古', '内蒙古卫视'], ['云南', '云南卫视'], ['山西', '山西卫视'],
  ['青海', '青海卫视'], ['西藏', '西藏卫视'], ['新疆', '新疆卫视'],
];

const out = [];
let missing = [];
for (const [no, siteName] of cctv) {
  const c = byName[siteName];
  if (!c) { missing.push(no + '/' + siteName); continue; }
  out.push({ no, name: c.channelName, pid: c.pid, streamId: c.streamId, channelType: c.channelType, url: BASE + c.pid });
}
for (const [no, siteName] of weishi) {
  const c = byName[siteName];
  if (!c) { missing.push(siteName); continue; }
  out.push({ no, name: c.channelName, pid: c.pid, streamId: c.streamId, channelType: c.channelType, url: BASE + c.pid });
}

if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
if (out.length !== 48) { console.error('COUNT MISMATCH', out.length); process.exit(1); }

fs.writeFileSync('D:/Desktop/deepseek-dsh/yangshipin-tv/research/channels-48.json', JSON.stringify(out, null, 1), 'utf8');
console.log('WROTE 48 entries. tabB extras present but excluded:');
raw.tabB.filter(c => !weishi.some(w => w[1] === c.channelName)).forEach(c => console.log('   -', c.channelName, c.pid));

// CSV for convenience
const csv = ['no,name,pid,streamId,channelType,url'].concat(out.map(e => [e.no, e.name, e.pid, e.streamId, e.channelType, e.url].join(','))).join('\n');
fs.writeFileSync('D:/Desktop/deepseek-dsh/yangshipin-tv/research/channels-48.csv', csv, 'utf8');
console.log('\nfirst 6:'); out.slice(0, 6).forEach(e => console.log('  ', JSON.stringify(e)));
console.log('last 4:'); out.slice(-4).forEach(e => console.log('  ', JSON.stringify(e)));
