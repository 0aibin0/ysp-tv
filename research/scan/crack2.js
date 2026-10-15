// Systematic attempt to identify the signing function from known (input -> signature) pairs.
const crypto = require('crypto');
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const sha1 = s => crypto.createHash('sha1').update(s, 'utf8').digest('hex');
const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (alg, key, msg) => crypto.createHmac(alg, key).update(msg, 'utf8').digest('hex');

// --- openapi pairs ---
const OPEN = [
  { appid: '519748109', input: 'HELLO-WORLD-TEST-1', sig: 'e12c5da7fe5d516f93ce2580ebe838c9' },
  { appid: '519748109', input: 'HELLO-WORLD-TEST-2', sig: '0fda832b98b33ee2ee5b89ae0af540fd' },
  { appid: '130004109', input: 'HELLO-WORLD-TEST-1', sig: 'db1c2b2ef5ca06ed0e0eaf282a4abc2c' },
];

const SECRETS = [
  '', '519748109', '130004109', 'ysp_pc', 'ysp_h5', '109', '5910204',
  '62fb5e14f246f', 'cejlmorstvxzAEGPVY123789', 'adghjnoswyACMNOQSUZ35689',
  'b42702bf7309a179d102f3d51b1add2fda0bc7ada64cb801', '59306155',
  'ab77d0e1a4a34c16b3f8a3cf2bd52b1f', 'ysp', 'yangshipin', 'cctv', 'cmg',
  'A73004463239C524F37849F42DD267EF', 'ysp_pc_519748109',
];
const ALGS = ['md5', 'sha1', 'sha256'];

let hits = [];
function candidates(appid, input) {
  const c = {};
  c['appid|input'] = appid + '|' + input;
  c['appid-input'] = appid + '-' + input;
  c['appid&input'] = appid + '&' + input;
  c['input|appid'] = input + '|' + appid;
  c['input-appid'] = input + '-' + appid;
  c['input&appid'] = input + '&' + appid;
  c['input'] = input;
  c['appidinput'] = appid + input;
  c['inputappid'] = input + appid;
  c['yspappid=appid&input=input'] = 'yspappid=' + appid + '&input=' + input;
  c['appid=appid&input=input'] = 'appid=' + appid + '&input=' + input;
  return c;
}

for (const p of OPEN) {
  const cands = candidates(p.appid, p.input);
  for (const [name, msg] of Object.entries(cands)) {
    for (const sec of SECRETS) {
      for (const alg of ALGS) {
        if (hmac(alg, sec, msg) === p.sig) hits.push(`HMAC-${alg.toUpperCase()} key="${sec}" msg(${name})="${msg}"`);
        if (hmac(alg, msg, sec) === p.sig) hits.push(`HMAC-${alg.toUpperCase()} key="${msg}" msg="${sec}"`);
      }
      if (md5(msg + sec) === p.sig) hits.push(`md5(${name}+sec) sec="${sec}"`);
      if (md5(sec + msg) === p.sig) hits.push(`md5(sec+${name}) sec="${sec}"`);
      if (sha256(msg + sec) === p.sig) hits.push(`sha256(${name}+sec) sec="${sec}"`);
      if (sha1(msg + sec) === p.sig) hits.push(`sha1(${name}+sec) sec="${sec}"`);
    }
  }
}
console.log('openapi brute-force hits:', hits.length);
hits.slice(0, 20).forEach(h => console.log('  ', h));

// --- player/auth pairs (form-encoded, keys observed in this order in the request body) ---
const AUTH = [
  { f: { pid: '600001859', guid: 'mv6byz1d_63lp77mbj2m', appid: 'ysp_pc', rand_str: '8AFZySOEvg' }, sig: 'd88a05624ff05ee13533899a3470fc20' },
];
// also verify with the earlier captures
const AUTH2 = [
  { f: { pid: '600001859', guid: 'mv6bnu26_6houx3s40ch', appid: 'ysp_pc', rand_str: 'UCYiqMwSxf' }, sig: 'ee232d5d7e54af56930e29558b3e2c48' },
  { f: { pid: '600002498', guid: 'mv6bnu26_6houx3s40ch', appid: 'ysp_pc', rand_str: 'lbcEUMblbS' }, sig: 'b0742f53e8768f77f1cc93dfd4f484f8' },
];

function buildOrders(f) {
  const keys = Object.keys(f);
  const sorted = [...keys].sort();
  const sortedLocale = [...keys].sort((a, b) => a.localeCompare(b));
  const outs = {};
  outs['request-order kv'] = keys.map(k => k + '=' + f[k]).join('&');
  outs['sorted kv'] = sorted.map(k => k + '=' + f[k]).join('&');
  outs['sortedLocale kv'] = sortedLocale.map(k => k + '=' + f[k]).join('&');
  outs['request-order values'] = keys.map(k => f[k]).join('');
  outs['sorted values'] = sorted.map(k => f[k]).join('');
  outs['request-order values &'] = keys.map(k => f[k]).join('&');
  outs['sorted values &'] = sorted.map(k => f[k]).join('&');
  return outs;
}

let hits2 = [];
for (const p of [...AUTH, ...AUTH2]) {
  for (const [name, msg] of Object.entries(buildOrders(p.f))) {
    for (const sec of SECRETS) {
      for (const alg of ['md5']) {
        if (hmac(alg, sec, msg) === p.sig) hits2.push(`HMAC-${alg} key="${sec}" [${name}] "${msg}"`);
      }
      if (md5(msg + sec) === p.sig) hits2.push(`md5([${name}]+sec) sec="${sec}" :: ${msg}${sec}`);
      if (md5(sec + msg) === p.sig) hits2.push(`md5(sec+[${name}]) sec="${sec}" :: ${sec}${msg}`);
    }
  }
}
console.log('\nauth brute-force hits:', hits2.length);
hits2.slice(0, 20).forEach(h => console.log('  ', h));

// Also: is the auth signature possibly unrelated to md5 (e.g. from openapi wasm)?
// Test whether the observed openapi sign function, applied to the auth body, yields the auth signature.
const openFnInputs = [
  'pid=600001859&guid=mv6byz1d_63lp77mbj2m&appid=ysp_pc&rand_str=8AFZySOEvg',
  'appid=ysp_pc&guid=mv6byz1d_63lp77mbj2m&pid=600001859&rand_str=8AFZySOEvg',
];
console.log('\nauth sig lengths:', AUTH.map(a => a.sig.length), '(md5=32 hex)');
