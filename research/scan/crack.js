// Try to crack ysign / player-auth signature from known plaintext/ciphertext pairs (md5 hypothesis)
const crypto = require('crypto');
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// --- Pair 1: m3u8 ysign ---
const vkey = 'F2C7D0BEFEF4BA7547D49E48BB460346AB239340FB866F5516387FBA16D290D86E97AAACEF4A39FDAE9D92112A28A894C06747563616B00275E6B5D50A0071D30409A91511C1EBC2BC531D35FFB81F8223C731625B3AD6960D4455ECE9E00ECDC2235403B479C2CACB26CA34FC2A1533';
const ytime = '1791874216';
const ysign = 'd22ae1da02870677913ec6379f4d8d19';
const pid = '600001859';
const guid = 'mv6bhwa6_o472ay0pntl';
const appid = '519748109';

const fixed = { vkey, ytime, ysign, pid, guid, appid };

// Known candidate secrets seen in the codebase / common in this product
const secrets = ['', 'ab77d0e1a4a34c16b3f8a3cf2bd52b1f', '62fb5e14f246f', 'cejlmorstvxzAEGPVY123789',
  'adghjnoswyACMNOQSUZ35689', 'b42702bf7309a179d102f3d51b1add2fda0bc7ada64cb801'];

const orders = [
  ['vkey', 'ytime'],
  ['ytime', 'vkey'],
  ['vkey', 'ytime', 'pid'],
  ['pid', 'vkey', 'ytime'],
  ['vkey', 'guid', 'ytime'],
  ['vkey', 'ytime', 'pid', 'guid'],
  ['vkey', 'ytime', 'app_id'],
  ['app_id', 'vkey', 'ytime'],
  ['ytime', 'vkey', 'app_id', 'guid'],
  ['vkey'],
  ['ytime'],
];
const seps = ['', '&', '|', '-'];

let found = [];
function test(label, str) {
  if (md5(str) === ysign) found.push(label + '  =>  "' + str + '"');
}
for (const sec of secrets) {
  for (const order of orders) {
    const parts = order.map(k => fixed[k] !== undefined ? fixed[k] : (k === 'app_id' ? appid : ''));
    for (const sep of seps) {
      const body = parts.join(sep);
      test(`sec=${sec} order=${order} sep="${sep}" pre`, body + sec);
      test(`sec=${sec} order=${order} sep="${sep}" post`, sec + body);
      // key=value style
      const kv = order.map(k => k + '=' + (fixed[k] !== undefined ? fixed[k] : (k === 'app_id' ? appid : ''))).join(sep);
      test(`sec=${sec} kv order=${order} sep="${sep}" pre`, kv + sec);
      test(`sec=${sec} kv order=${order} sep="${sep}" post`, sec + kv);
    }
  }
}
console.log('ysign md5 cracks found:', found.length);
found.forEach(f => console.log('  ', f));

// --- Pair 2: player/auth signature (form-encoded, keys sorted) ---
// POST pid=600001859&guid=mv6bnu26_6houx3s40ch&appid=ysp_pc&rand_str=UCYiqMwSxf&signature=ee232d5d7e54af56930e29558b3e2c48
const authPairs = [
  { pid: '600001859', guid: 'mv6bnu26_6houx3s40ch', appid: 'ysp_pc', rand_str: 'UCYiqMwSxf', sig: 'ee232d5d7e54af56930e29558b3e2c48' },
  { pid: '600002498', guid: 'mv6bnu26_6houx3s40ch', appid: 'ysp_pc', rand_str: 'lbcEUMblbS', sig: 'b0742f53e8768f77f1cc93dfd4f484f8' },
];
const secrets2 = ['', '62fb5e14f246f', 'cejlmorstvxzAEGPVY123789', 'adghjnoswyACMNOQSUZ35689',
  'b42702bf7309a179d102f3d51b1add2fda0bc7ada64cb801', 'ysp_pc', '519748109'];
const found2 = [];
for (const ap of authPairs) {
  const keys = ['appid', 'guid', 'pid', 'rand_str']; // sorted
  const body = keys.map(k => k + '=' + ap[k]).join('&');
  for (const sec of secrets2) {
    if (md5(body + sec) === ap.sig) found2.push('AUTH pre sec="' + sec + '" : ' + body + sec);
    if (md5(sec + body) === ap.sig) found2.push('AUTH post sec="' + sec + '" : ' + sec + body);
  }
}
console.log('\nauth md5 cracks found:', found2.length);
found2.forEach(f => console.log('  ', f));

// Sanity: confirm the md5 impl matches the site's hex_md5 on a known string
console.log('\nsanity md5("abc") =', md5('abc'));
