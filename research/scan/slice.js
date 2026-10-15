const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
const start=parseInt(process.argv[3],10), end=parseInt(process.argv[4],10);
console.log(src.slice(start,end));
