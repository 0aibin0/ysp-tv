const fs = require('fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const want = process.argv[3] || '';
for (const [rid, body] of Object.entries(d.bodies)) {
  const r = d.requests.find(x => x.requestId === rid);
  if (!r) continue;
  if (want && !r.url.includes(want)) continue;
  console.log('==================================================');
  console.log('URL   :', r.url);
  console.log('STATUS:', r.status, r.mimeType, 'bytes=', r.encodedDataLength);
  console.log('REQHDR:', JSON.stringify(r.headers));
  if (r.postData) console.log('POST  :', r.postData.slice(0, 3000));
  console.log('RESPHDR:', JSON.stringify(r.responseHeaders));
  console.log('BODY  :');
  console.log(body.length > 8000 ? body.slice(0, 8000) + '\n...[TRUNC total ' + body.length + ']' : body);
  console.log();
}
