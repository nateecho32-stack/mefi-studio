// Three deterministic 30-second advertisements. Synthetic app captures only.
// Requires @napi-rs/canvas (set PROMO_NODE_MODULES) and ffmpeg on PATH.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {once}=require('node:events');
const modules=process.env.PROMO_NODE_MODULES;
const {createCanvas,loadImage,GlobalFonts}=require(modules?path.join(modules,'@napi-rs/canvas'):'@napi-rs/canvas');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'dist/promo');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf','Studio');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf','Studio Bold');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuil.ttf','Studio Light');
GlobalFonts.registerFromPath('C:/Windows/Fonts/consola.ttf','Studio Mono');
const FPS=30,DURATION=30;
const C={ink:'#101716',paper:'#f0f0e8',muted:'#5d6c66',mint:'#a8f5d1',green:'#18866a',line:'#d0d8cd',night:'#0d111b',lavender:'#b8a9ff',lime:'#d8fc84',white:'#f4f6ef'};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return 1-Math.pow(1-v,3);};
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
const lerp=(a,b,t)=>a+(b-a)*t;
let canvas,ctx,W,H,assets={};
function rr(x,y,w,h,r=16,fill,stroke,lw=1){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}}
function text(s,x,y,size=32,color=C.ink,font='Studio',align='left'){ctx.font=`${size}px "${font}"`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(s,x,y);}
function line(x1,y1,x2,y2,color,width=2){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
function pill(s,x,y,color=C.mint,bg=C.ink,size=21){ctx.font=`${size}px "Studio Bold"`;const w=ctx.measureText(s).width+36;rr(x,y,w,44,22,bg);text(s,x+18,y+29,size,color,'Studio Bold');return w;}
function brand(x=80,y=72,light=false){rr(x,y-34,43,43,11,light?C.mint:C.ink);text('M+',x+6,y-5,23,light?C.ink:C.paper,'Studio Bold');text("Mefi’s Studio AI+",x+60,y,26,light?C.white:C.ink,'Studio Bold');}
function bg(dark=false){ctx.fillStyle=dark?C.night:C.paper;ctx.fillRect(0,0,W,H);}
function dots(t,color='rgba(25,50,42,.08)',step=44){ctx.fillStyle=color;for(let x=22;x<W;x+=step)for(let y=24;y<H;y+=step){ctx.fillRect(x,y,2,2);} }
function wrap(s,x,y,max,size=32,color=C.ink,font='Studio',leading=1.35){ctx.font=`${size}px "${font}"`;let row='',yy=y;for(const word of s.split(' ')){if(ctx.measureText(row+word).width>max&&row){text(row.trim(),x,yy,size,color,font);row='';yy+=size*leading;}row+=word+' ';}if(row)text(row.trim(),x,yy,size,color,font);return yy;}
function photo(key,x,y,w,h,{crop=null,progress=0,round=18,zoom=1,fit='cover'}={}){const im=assets[key];if(!im)return;ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,round);ctx.clip();ctx.fillStyle='#0c1820';ctx.fillRect(x,y,w,h);let sx=0,sy=0,sw=im.width,sh=im.height;if(crop)[sx,sy,sw,sh]=crop;const scale=(fit==='contain'?Math.min:Math.max)(w/sw,h/sh)*zoom;const dw=sw*scale,dh=sh*scale;const dx=x-(dw-w)/2+Math.sin(progress*Math.PI)*3,dy=y-(dh-h)/2;ctx.drawImage(im,sx,sy,sw,sh,dx,dy,dw,dh);ctx.restore();}
function check(x,y,r=18,color=C.green){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.beginPath();ctx.moveTo(x-r*.45,y);ctx.lineTo(x-r*.1,y+r*.32);ctx.lineTo(x+r*.48,y-r*.35);ctx.strokeStyle=C.white;ctx.lineWidth=3;ctx.lineCap='round';ctx.stroke();}
function orb(x,y,r,color,t,label='',scale=1){ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);const g=ctx.createRadialGradient(-r*.2,-r*.4,0,0,0,r*2.4);g.addColorStop(0,color+'aa');g.addColorStop(.42,color+'25');g.addColorStop(1,color+'00');ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,r*2.4,0,Math.PI*2);ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,r*1.35,r*.65,t*.25,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fillStyle='#151e27';ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();if(label)text(label,0,8,r*.5,C.white,'Studio Bold','center');else{ctx.fillStyle=color;ctx.beginPath();ctx.arc(-r*.23,-r*.05,3.5,0,7);ctx.arc(r*.23,-r*.05,3.5,0,7);ctx.fill();ctx.beginPath();ctx.arc(0,r*.03,r*.25,.2,Math.PI-.2);ctx.stroke();}ctx.restore();}
function footer(t,dark=false,label='SAMPLE PROJECT · CURRENT UI'){const col=dark?'#879794':'#69776f';text(label,80,H-42,17,col,'Studio Mono');text('SINCE 0.3.0',W-80,H-42,18,col,'Studio Mono','right');rr(80,H-20,W-160,3,1,dark?'#283330':'#ced6cc');rr(80,H-20,(W-160)*t/30,3,1,dark?C.mint:C.green);}
const chapters=[
 {start:3,end:7,num:'01',title:['Your project.','In view.'],copy:'A redesigned Home and an explorable map of your systems.',tag:'HOME + PROJECT MAP',screen:'map',crop:[250,70,1330,850]},
 {start:7,end:11,num:'02',title:['Watch the','work unfold.'],copy:'Follow agent pipelines, parallel steps and reports as they come home.',tag:'THE AGENT BRAIN',screen:'pipeline',crop:[555,173,1020,540]},
 {start:11,end:15,num:'03',title:['Good work','gets a recipe.'],copy:'The Playbook saves pipeline patterns for the next task.',tag:'PLAYBOOK + BRAIN MAPS',screen:'playbook',crop:[250,90,1280,690]},
 {start:15,end:19,num:'04',title:['Your models.','Your choice.'],copy:'OpenRouter joins your connected providers. Keep routing and usage together.',tag:'OPENROUTER + MODEL CONTROLS',screen:'routing',crop:[260,120,1270,720]},
 {start:19,end:23,num:'05',title:['Stay in','your flow.'],copy:'Music, radio and links in one dropdown. Video can float across the studio.',tag:'MUSIC + FLOATING MEDIA',screen:'music',crop:[660,80,920,900]},
 {start:23,end:26,num:'06',title:['Know what’s','really done.'],copy:'Clear task activity, recorded checks and fewer repeat questions.',tag:'TASKS + VERIFICATION',screen:'tasks',crop:[650,120,940,700]},
];
function main(t){bg();brand();text('THE STUDIO, EVOLVED',W-80,72,21,C.muted,'Studio Mono','right');
 if(t<3){dots(t);const p=ease(t/.85);ctx.save();ctx.globalAlpha=p;ctx.translate(0,50*(1-p));pill('THE AGENT BRAIN UPDATE',80,205,C.ink,C.mint);text('Your idea.',80,435,112,C.ink,'Studio Bold');text('A whole studio.',80,565,112,C.ink,'Studio Bold');text('Plan it. Watch it. Verify it.',86,653,35,C.muted);ctx.restore();
  for(let i=0;i<6;i++){const a=i*Math.PI/3+t*.1;const q=ease((t-.45-i*.1)/.8),x=1390+Math.cos(a)*225*q,y=485+Math.sin(a)*205*q;line(1390,485,x,y,'#acc9bd',2);rr(x-42,y-42,84,84,20,i%2?C.ink:C.mint);text(['PLAN','MAP','BUILD','TEST','LEARN','SHIP'][i],x,y+6,18,i%2?C.white:C.ink,'Studio Bold','center');}orb(1390,485,76,C.green,t,'M+',p);
  text('A local-first workspace for coding agents.',85,815,29,C.muted);
 }else if(t<26){const c=chapters.find(c=>t>=c.start&&t<c.end),u=(t-c.start)/(c.end-c.start),p=ease((t-c.start)/.6);ctx.save();ctx.globalAlpha=p;ctx.translate(0,28*(1-p));text(c.num+' / 06',80,218,23,C.green,'Studio Mono');pill(c.tag,80,260,C.ink,C.mint,19);c.title.forEach((s,i)=>text(s,76,429+i*94,79,C.ink,'Studio Bold'));wrap(c.copy,82,662,560,31,C.muted);ctx.restore();
  const sx=720+50*(1-p),sy=162,w=1120,h=742;ctx.save();ctx.shadowColor='#18271a20';ctx.shadowBlur=35;ctx.shadowOffsetY=18;rr(sx,sy,w,h,26,'#202a27');ctx.restore();rr(sx,sy,w,48,26,C.ink);text('Mefi’s Studio AI+  /  '+c.tag,sx+28,sy+31,18,C.mint,'Studio Mono');photo(c.screen,sx+9,sy+49,w-18,h-59,{crop:c.crop,progress:u,fit:'contain',zoom:1+u*.012});
  const captions=['Explore systems → parts → files','A visible path from ask to evidence','Patterns from completed work','Use the provider you already have','Your soundtrack, inside your workspace','Progress and proof, together'];text(captions[Number(c.num)-1],sx+4,960,24,C.muted);
 }else{const p=ease((t-26)/.7);ctx.save();ctx.globalAlpha=p;ctx.translate(0,30*(1-p));pill('FREE · OPEN SOURCE · WINDOWS',80,233,C.ink,C.mint);text('Build with Mefi.',75,459,120,C.ink,'Studio Bold');text('Bring an idea. Make something real.',83,542,37,C.muted);rr(82,655,514,86,19,C.ink);text('Get Mefi’s Studio AI+',112,711,30,C.mint,'Studio Bold');text('github.com/nateecho32-stack/mefi-studio',85,817,29,C.ink,'Studio Mono');text('Join the community · discord.gg/xgfKc5pVxG',85,869,23,C.muted);orb(1450,500,137,C.green,t,'M+');ctx.restore();}
 footer(t);
}
const sqFeatures=[
 ['A project you','can explore.','SYSTEMS → PARTS → FILES','map',[260,180,1020,650]],
 ['Agents. Steps.','Visible progress.','THE AGENT BRAIN','pipeline',[765,145,720,620]],
 ['Keep what','worked.','PLAYBOOK RECIPES','playbook',[250,120,1280,630]],
 ['Bring your','favorite models.','OPENROUTER + ROUTING','routing',[270,340,1260,520]],
 ['Keep the','flow going.','MUSIC + FLOATING VIDEO','music',[1200,135,385,800]],
 ['Progress with','proof.','TASK HISTORY + CHECKS','tasks',[660,160,920,580]],
];
function squares(t){bg();brand(58,64);text('02 / BUILD BY BLOCKS',W-58,64,17,C.muted,'Studio Mono','right');
 if(t<3.6){text('Everything.',54,255,94,C.ink,'Studio Bold');text('Coming together.',54,360,87,C.ink,'Studio Bold');const x0=280,y0=473,size=64;for(let y=0;y<5;y++)for(let x=0;x<8;x++){const q=ease((t-.18*(x+y))/.75),on=(x===0||x===4||y===x&&x<3||y===4-x&&x>1&&x<5||x===6&&y>0&&y<4||y===2&&x>4);ctx.save();ctx.translate(x0+x*size,y0+y*size+35*(1-q));ctx.globalAlpha=q;rr(0,0,56,56,9,on?C.ink:'#d7e7db');ctx.restore();}text('A new chapter for Mefi’s Studio AI+',W/2,892,27,C.muted,'Studio','center');
 }else if(t<24.6){const k=Math.min(5,Math.floor((t-3.6)/3.5)),u=(t-3.6-k*3.5)/3.5,c=sqFeatures[k];pill(c[2],58,123,C.ink,C.mint,18);text(c[0],54,264,71,C.ink,'Studio Bold');text(c[1],54,347,71,C.ink,'Studio Bold');const x=58,y=407,w=964,h=489;rr(x,y,w,h,20,C.ink);const im=assets[c[3]],crop=c[4],cols=6,rows=3;for(let yy=0;yy<rows;yy++)for(let xx=0;xx<cols;xx++){const p=ease((u*3.5-(xx+yy)*.055)/.4);if(p===0)continue;const tw=w/cols,th=h/rows;ctx.save();ctx.beginPath();ctx.roundRect(x+xx*tw+2,y+yy*th+2,tw-4,(th-4)*p,4);ctx.clip();photo(c[3],x,y,w,h,{crop,zoom:1+u*.035,round:20});ctx.restore();}for(let i=0;i<6;i++)rr(58+i*162,937,145,6,3,i<=k?C.green:'#cdd9d0');text(String(k+1).padStart(2,'0')+' / 06',W-58,982,20,C.muted,'Studio Mono','right');
 }else{const p=ease((t-24.6)/.65);ctx.save();ctx.globalAlpha=p;const small=['PROJECT MAP','PIPELINES','PLAYBOOK','YOUR MODELS','MEDIA','VERIFIED WORK'];for(let i=0;i<6;i++){const x=58+(i%3)*324,y=166+Math.floor(i/3)*168;rr(x,y,304,148,18,i%2?C.mint:C.ink);check(x+38,y+38,15,i%2?C.ink:C.green);text(small[i],x+20,y+114,21,i%2?C.ink:C.white,'Studio Bold');}text('One studio.',55,650,110,C.ink,'Studio Bold');text('Yours to build in.',58,727,57,C.muted);pill('GET MEFI’S STUDIO AI+',58,796,C.mint,C.ink,26);text('github.com/nateecho32-stack',60,903,24,C.ink,'Studio Mono');text('/mefi-studio',60,943,24,C.ink,'Studio Mono');ctx.restore();}
 text('SINCE 0.3.0 · SAMPLE PROJECT',58,H-34,17,C.muted,'Studio Mono');
}
function beam(a,b,p,color){ctx.save();ctx.strokeStyle=color+'40';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...a);ctx.bezierCurveTo(a[0],(a[1]+b[1])/2,b[0],(a[1]+b[1])/2,...b);ctx.stroke();const q=(p%1+1)%1;const x=lerp(a[0],b[0],smooth(q)),y=lerp(a[1],b[1],q);ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,5,0,7);ctx.fill();ctx.restore();}
function vertical(t){bg(true);dots(t,'rgba(184,169,255,.08)',56);brand(64,90,true);text('03 / AGENT CONSTELLATION',64,149,19,'#8e9cba','Studio Mono');
 const center=[540,650];let head=['One idea.','Watch it grow.'],sub='A studio full of visible work.';
 if(t>=5&&t<10){head=['Send the','agents out.'];sub='Pipelines make every step visible.';}
 if(t>=10&&t<15){head=['Keep the','project in view.'];sub='Explore systems, parts and files.';}
 if(t>=15&&t<20){head=['Bring good','work home.'];sub='Verified patterns become Playbook recipes.';}
 if(t>=20&&t<25){head=['Make the','studio yours.'];sub='Your models. Your soundtrack. Your flow.';}
 if(t>=25){head=['Your next idea','starts here.'];sub='Mefi’s Studio AI+ · Free & open source';}
 const local=t%5,p=ease(local/.65);ctx.save();ctx.globalAlpha=p;ctx.translate(0,30*(1-p));head.forEach((s,i)=>text(s,64,301+i*107,84,C.white,'Studio Bold'));wrap(sub,67,466,910,30,'#afbdd4');ctx.restore();
 const labels=['PLAN','MAP','BUILD','CHECK','LEARN','SHIP'];
 const positions=[[262,906],[810,906],[166,1117],[914,1117],[304,1320],[776,1320]];
 const born=t<5?ease((t-.8)/2.6):1;
 const returning=t>=15&&t<20?smooth((t-16.3)/2.4):0;
 for(let i=0;i<6;i++){const delay=clamp(born*1.6-i*.13),q=ease(delay);const target=positions[i],r=t>=25?smooth((t-25)/1.6):returning;const pos=[lerp(center[0],target[0],q*(1-r)),lerp(center[1],target[1],q*(1-r))];
   if(t>=25)continue;
   beam(center,pos,t*.32+i*.16,i%2?C.lavender:C.lime);
   if(t>=5&&t<10){const child=[pos[0]+(i%2?-75:75),pos[1]+110];beam(pos,child,t*.5+i*.1,C.lavender);orb(child[0],child[1],16,C.lavender,t,'',ease((t-5-i*.12)/1));}
   orb(pos[0],pos[1],36,i%2?C.lavender:C.lime,t,labels[i],q*(1-r));
   if(t>=15&&t<16.3)check(pos[0]+32,pos[1]-25,15,C.green);
 }
 orb(center[0],center[1],t>=25?95:70,C.mint,t,'M+',ease(t/.8));
 if(t>=10&&t<15){const q=ease((t-10)/.7);ctx.save();ctx.globalAlpha=q;rr(122,914,836,506,25,'#18221e','#719b8460',2);photo('map',138,930,804,474,{crop:[280,230,950,620],zoom:1+(t-10)*.004});pill('YOUR PROJECT, MAPPED',172,1360,C.ink,C.mint,21);ctx.restore();}
 if(t>=20&&t<25){const q=ease((t-20)/.7);ctx.save();ctx.globalAlpha=q;const names=['OpenRouter + your providers','Music, radio + floating video','Clear history + recorded checks'];for(let i=0;i<3;i++){const y=913+i*153;rr(120,y,840,124,21,'#17212b','#b8a9ff55',1);text(String(i+1).padStart(2,'0'),150,y+74,31,C.lime,'Studio Mono');text(names[i],231,y+74,28,C.white,'Studio Bold');}ctx.restore();}
 if(t>=25){const q=ease((t-25.5)/.8);ctx.save();ctx.globalAlpha=q;text('Build with Mefi.',540,967,73,C.lime,'Studio Bold','center');text('Local-first. Made for your projects.',540,1043,30,'#afbdd4','Studio','center');rr(128,1182,824,104,23,C.lime);text('GET THE STUDIO',540,1248,34,C.ink,'Studio Bold','center');text('github.com/nateecho32-stack',540,1388,29,C.white,'Studio Mono','center');text('/mefi-studio',540,1434,29,C.white,'Studio Mono','center');text('discord.gg/xgfKc5pVxG',540,1557,25,'#afbdd4','Studio Mono','center');ctx.restore();}
 else{const cta=t<5?'AN IDEA BECOMES A PLAN':t<10?'A PLAN BECOMES VISIBLE WORK':t<15?'EVERY TASK HAS A PLACE':t<20?'EVIDENCE BECOMES EXPERIENCE':'A WORKSPACE THAT FEELS LIKE YOU';text(cta,540,1600,23,C.lime,'Studio Mono','center');}
 text('THE AGENT BRAIN UPDATE',64,1762,21,C.lavender,'Studio Mono');text('Since 0.3.0 · Workflow illustration',64,1808,20,'#8190a9');rr(64,1850,952,4,2,'#2b3546');rr(64,1850,952*t/30,4,2,C.lime);
}
async function render(kind,preview=false){const config={main:[1920,1080,'01-main-showcase'],squares:[1080,1080,'02-build-by-blocks'],constellation:[1080,1920,'03-agent-constellation']}[kind];if(!config)throw new Error('Unknown style');[W,H]=config;canvas=createCanvas(W,H);ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';const draw={main,squares,constellation:vertical}[kind];
 if(preview){for(const t of [1.8,5,9,13,17,21,24.8,28]){draw(t);fs.writeFileSync(path.join(OUT,'work',`${kind}-${t}.png`),canvas.toBuffer('image/png'));}console.log('Preview frames:',kind);return;}
 const outfile=path.join(OUT,config[2]+'.mp4');const audio=path.join(OUT,'work',kind+'.wav');
 const ff=spawn('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','rawvideo','-pixel_format','rgba','-video_size',`${W}x${H}`,'-framerate',String(FPS),'-i','pipe:0','-i',audio,'-c:v','libx264','-preset','fast','-crf','22','-maxrate','2100k','-bufsize','4200k','-pix_fmt','yuv420p','-profile:v','high','-c:a','aac','-b:a','128k','-ar','48000','-af','afade=t=in:d=0.4,afade=t=out:st=28.5:d=1.5,loudnorm=I=-18:TP=-1.5:LRA=9','-t','30','-movflags','+faststart','-metadata','title='+config[2],outfile],{windowsHide:true,stdio:['pipe','ignore','pipe']});
 ff.stderr.on('data',b=>process.stderr.write(b));let err;ff.on('error',e=>{err=e;});
 const done=new Promise((resolve,reject)=>ff.on('close',code=>code===0?resolve():reject(err||new Error(`ffmpeg ${code}`))));
 for(let i=0;i<FPS*DURATION;i++){draw(i/FPS);if(!ff.stdin.write(canvas.data()))await once(ff.stdin,'drain');if(i%150===0)console.log(`${kind}: ${i/FPS}s rendered`);}
 ff.stdin.end();await done;draw(kind==='main'?5:kind==='squares'?1.8:8);fs.writeFileSync(path.join(OUT,config[2]+'.png'),canvas.toBuffer('image/png'));console.log('FINISHED',outfile,fs.statSync(outfile).size);
}
(async()=>{for(const key of ['home','map','pipeline','playbook','brains','routing','tasks','command','music'])assets[key]=await loadImage(path.join(OUT,'screens',key+'.png'));const kind=process.argv[2]||'main';await render(kind,process.argv.includes('--preview'));})().catch(e=>{console.error(e);process.exitCode=1;});
