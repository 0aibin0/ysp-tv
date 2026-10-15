const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
const set=new Set();
const re=/["'`]([^"'`\n]{2,60})["'`]/g;
let m;
while((m=re.exec(src))!==null){
  const v=m[1];
  if(/[\/\?&=\u4e00-\u9fa5]/.test(v) && !/^[\s]/.test(v)) set.add(v);
}
console.log([...set].join('\n'));
