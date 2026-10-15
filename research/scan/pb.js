// Minimal dependency-free protobuf wire-format decoder (generic, no schema)
const fs = require('fs');

function readVarint(buf, pos) {
  let result = 0n, shift = 0n, b;
  do { b = buf[pos++]; result |= BigInt(b & 0x7f) << shift; shift += 7n; } while (b & 0x80);
  return [result, pos];
}
function tryUtf8(buf) {
  const s = buf.toString('utf8');
  // re-encode to check validity
  if (Buffer.from(s, 'utf8').equals(buf) && /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(s)) return s;
  return null;
}
function looksLikeMessage(buf) {
  // heuristics: first byte is a plausible tag
  if (buf.length === 0) return false;
  let pos = 0, fields = 0;
  try {
    while (pos < buf.length) {
      const [tag, p1] = readVarint(buf, pos);
      const wt = Number(tag & 7n), fn = Number(tag >> 3n);
      if (fn === 0 || wt === 6 || wt === 7) return false;
      pos = p1;
      if (wt === 0) { const [, p] = readVarint(buf, pos); pos = p; }
      else if (wt === 2) { const [len, p] = readVarint(buf, pos); pos = p + Number(len); }
      else if (wt === 5) pos += 4;
      else if (wt === 1) pos += 8;
      else return false;
      if (pos > buf.length) return false;
      fields++;
    }
    return fields > 0;
  } catch (e) { return false; }
}

function decode(buf, indent, depth, lines, maxDepth) {
  let pos = 0;
  const pad = '  '.repeat(indent);
  while (pos < buf.length) {
    let tag, p1;
    try { [tag, p1] = readVarint(buf, pos); } catch (e) { lines.push(pad + '<decode error at ' + pos + '>'); return; }
    const wt = Number(tag & 7n), fn = Number(tag >> 3n);
    pos = p1;
    if (wt === 0) {
      const [v, p] = readVarint(buf, pos); pos = p;
      lines.push(pad + fn + ': ' + v.toString() + (v > 2147483647n ? '' : ''));
    } else if (wt === 2) {
      const [len, p] = readVarint(buf, pos); pos = p;
      const slice = buf.subarray(pos, pos + Number(len)); pos += Number(len);
      const s = tryUtf8(slice);
      if (s !== null && (s.length === 0 || !looksLikeMessage(slice) || /[\u4e00-\u9fa5]/.test(s) || /^https?:/.test(s) || /^[A-Za-z0-9_.\-\/ :]+$/.test(s))) {
        lines.push(pad + fn + ': "' + s.replace(/\n/g, '\\n') + '" (len ' + slice.length + ')');
      } else if (depth < maxDepth && looksLikeMessage(slice)) {
        lines.push(pad + fn + ': { message len=' + slice.length + ' }');
        // check if repeated: try decoding as many sequential messages
        decode(slice, indent + 1, depth + 1, lines, maxDepth);
      } else {
        lines.push(pad + fn + ': <bytes len=' + slice.length + '> ' + slice.subarray(0, 32).toString('hex'));
      }
    } else if (wt === 5) {
      const v = buf.readFloatLE(pos); pos += 4;
      lines.push(pad + fn + ': float ' + v);
    } else if (wt === 1) {
      const v = buf.readDoubleLE(pos); pos += 8;
      lines.push(pad + fn + ': double ' + v);
    } else {
      lines.push(pad + '<unknown wiretype ' + wt + ' field ' + fn + '>');
      return;
    }
  }
}

const f = process.argv[2];
const maxDepth = parseInt(process.argv[3] || '6', 10);
const buf = fs.readFileSync(f);
console.log('FILE:', f, 'bytes:', buf.length);
const lines = [];
decode(buf, 0, 0, lines, maxDepth);
console.log(lines.slice(0, parseInt(process.argv[4] || '400', 10)).join('\n'));
console.log('... total lines:', lines.length);
