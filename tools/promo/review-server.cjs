// Loopback-only media server with byte ranges for deterministic video seeking.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../dist/promo');
const names=['mefi-work-in-motion'];
const allowed=new Set(['review.html',...names.flatMap(n=>[n+'.mp4',n+'.png'])]);
http.createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)||'review.html';
 if(!allowed.has(name)||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
 const file=path.join(root,name);if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 const size=fs.statSync(file).size;let start=0,end=size-1,status=200;
 const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
 if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;status=206;if(start>end){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}}
 const headers={'Content-Type':name.endsWith('.mp4')?'video/mp4':name.endsWith('.png')?'image/png':'text/html; charset=utf-8','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-cache'};
 if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${size}`;
 res.writeHead(status,headers);if(req.method==='HEAD')res.end();else fs.createReadStream(file,{start,end}).pipe(res);
}).listen(4288,'127.0.0.1',()=>console.log('Media review: http://127.0.0.1:4288/review.html'));
