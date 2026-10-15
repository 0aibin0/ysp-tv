const fs = require('fs');
const d = JSON.parse(fs.readFileSync('D:/Desktop/deepseek-dsh/yangshipin-tv/research/capture2/net.json', 'utf8'));
for (const [rid, body] of Object.entries(d.bodies)) {
  const r = d.requests.find(x => x.requestId === rid);
  if (!r) continue;
  if (/player\/auth|get_live_info|open\/token|CMGPlayer/.test(r.url)) {
    console.log('#####', r.method, r.url);
    console.log(body.slice(0, 3000));
    console.log();
  }
}
