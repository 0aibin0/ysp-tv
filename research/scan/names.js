const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
const set=new Set();
const re=/["']([a-zA-Z][a-zA-Z0-9_]{2,40})["']/g;
let m;
while((m=re.exec(src))!==null){
  const v=m[1];
  if(/^(get|set|is|on|do|fetch|query|find|load|update|list|post)[A-Z_]/.test(v)) set.add(v);
}
console.log([...set].sort().join('\n'));
