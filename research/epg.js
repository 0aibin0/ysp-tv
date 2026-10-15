// Decode the yangshipin EPG protobuf to see if start/end are epoch ms,
// which would let the app resolve "now playing" for any channel directly.
const https = require('https');

const PID = process.argv[2] || '600001859';
const DAY = process.argv[3] || new Date().toISOString().slice(0, 10).replace(/-/g, '');

function fetchBuf(url) {
  return new Promise((res, rej) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: 'https://www.yangshipin.cn/',
      },
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, body: Buffer.concat(chunks), headers: r.headers }));
    }).on('error', rej);
  });
}

function readVarint(buf, pos) {
  let result = 0n, shift = 0n, start = pos;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7n;
  }
  return { value: result, pos, bytes: pos - start };
}

// Generic protobuf walk: yields fields of a message
function walk(buf, start, end, depth = 0) {
  const out = [];
  let pos = start;
  while (pos < end) {
    const tag = readVarint(buf, pos); pos = tag.pos;
    const fieldNo = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    if (wire === 0) {
      const v = readVarint(buf, pos); pos = v.pos;
      out.push({ fieldNo, wire, value: v.value, raw: v.value });
    } else if (wire === 2) {
      const len = readVarint(buf, pos); pos = len.pos;
      const slice = buf.subarray(pos, pos + Number(len.value));
      pos += Number(len.value);
      out.push({ fieldNo, wire, buf: slice, str: tryUtf8(slice) });
    } else if (wire === 5) { pos += 4; out.push({ fieldNo, wire, skip: 4 }); }
    else if (wire === 1) { pos += 8; out.push({ fieldNo, wire, skip: 8 }); }
    else { out.push({ fieldNo, wire, error: 'unsupported wire ' + wire }); break; }
  }
  return out;
}

function tryUtf8(buf) {
  const s = buf.toString('utf8');
  // reject if it contains replacement chars / control chars => probably binary
  if (/[\uFFFD]/.test(s)) return null;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) return null;
  return s;
}

(async () => {
  const url = `https://capi.yangshipin.cn/api/yspepg/program/${PID}/${DAY}`;
  console.log('GET', url);
  const r = await fetchBuf(url);
  console.log('status', r.status, 'ctype', r.headers['content-type'], 'bytes', r.body.length);

  const top = walk(r.body, 0, r.body.length);
  console.log('top-level fields:', top.map(f => `#${f.fieldNo}/w${f.wire}${f.str ? '="' + f.str.slice(0, 20) + '"' : ''}${f.value !== undefined ? '=' + f.value : ''}`).join(', '));

  const records = top.filter(f => f.wire === 2 && f.buf);
  console.log('record count:', records.length);

  const parsed = records.map((rec) => {
    const fields = walk(rec.buf, 0, rec.buf.length);
    const o = {};
    fields.forEach((f) => {
      if (f.wire === 0) o['v' + f.fieldNo] = f.value.toString();
      else if (f.wire === 2) {
        if (f.str !== null && f.str !== undefined) o['s' + f.fieldNo] = f.str;
        else o['b' + f.fieldNo] = f.buf.length + 'B';
      }
    });
    return o;
  });

  console.log('\n--- first 6 records ---');
  parsed.slice(0, 6).forEach((p, i) => console.log(i, JSON.stringify(p)));

  // Try interpreting the big varints as epoch ms
  const key = Object.keys(parsed[0] || {}).filter(k => k.startsWith('v'));
  console.log('\n--- varint fields present:', key.join(', '));
  key.forEach((k) => {
    const vals = parsed.map(p => p[k]).filter(Boolean);
    if (!vals.length) return;
    const sample = BigInt(vals[0]);
    console.log(`${k}: first=${sample}  as-ms-date=${new Date(Number(sample)).toISOString()}  as-sec-date=${new Date(Number(sample) * 1000).toISOString()}`);
  });

  console.log('\nnow =', new Date().toISOString(), ' epochMs =', Date.now());

  // Which record contains now, if any varint is epoch ms?
  key.forEach((k) => {
    const hit = parsed.find((p) => {
      const a = BigInt(p[k] || -1);
      return a > 1000000000000n && a <= BigInt(Date.now()) && BigInt(Date.now()) < a + 86400000n;
    });
    if (hit) console.log(`field ${k} looks like epoch-ms-ish:`, JSON.stringify(hit).slice(0, 200));
  });
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
