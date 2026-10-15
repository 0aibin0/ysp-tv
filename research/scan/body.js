const fs = require('fs');
const f = process.argv[2];
const want = process.argv[3];
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
for (const [rid, body] of Object.entries(d.bodies)) {
  const r = d.requests.find(x => x.requestId === rid);
  if (!r) continue;
  if (want && !r.url.includes(want)) continue;
  console.log('==================================================');
  console.log('URL   :', r.url);
  console.log('STATUS:', r.status, r.mimeType, 'bytes=', r.encodedDataLength);
  console.log('REQHDR:', JSON.stringify(r.headers));
  if (r.postData) console.log('POST  :', r.postData.slice(0, 2000));
  console.log('RESPHDR:', JSON.stringify(r.responseHeaders));
  console.log('BODY  :');
  console.log(body.slice(0, 6000));
  console.log();
}
