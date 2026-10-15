const fs=require('fs');
const file=process.argv[2];
const pat=process.argv[3];
const ctx=parseInt(process.argv[4]||'160',10);
const src=fs.readFileSync(file,'utf8');
const re=new RegExp(pat,'gi');
let m,n=0;
while((m=re.exec(src))!==null){
  n++;
  const a=Math.max(0,m.index-ctx), b=Math.min(src.length,m.index+m[0].length+ctx);
  console.log('=== #'+n+' @'+m.index+' ===');
  console.log(src.slice(a,b).replace(/\n/g,'\\n'));
  if(n>=parseInt(process.argv[5]||'40',10)){console.log('...more truncated');break;}
}
console.log('TOTAL MATCHES: '+n);
