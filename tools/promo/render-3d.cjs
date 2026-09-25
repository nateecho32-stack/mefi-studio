// Deterministic, silent Three.js film export. Never starts the Studio application.
const{app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{once}=require('node:events');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'dist/promo');
const kind=process.argv[2]||'main',preview=process.argv.includes('--preview'),show=process.argv.includes('--show');
const flow=process.argv.includes('--flow'),story=process.argv.includes('--story'),ascii=process.argv.includes('--ascii'),worktree=process.argv.includes('--worktree');
const config=(worktree?{main:[1920,1080,'mefi-work-in-motion']}:ascii?{main:[1920,1080,'mefi-thought-form']}:story?{main:[1920,1080,'01-chaos-to-clarity'],squares:[1080,1080,'02-connected-studio'],constellation:[1080,1920,'03-node-ballet']}:flow?{main:[1920,1080,'01-studio-in-motion'],squares:[1080,1080,'02-cascade'],constellation:[1080,1920,'03-signal']}:{main:[1920,1080,'01-prism-studio-v2'],squares:[1080,1080,'02-voxel-forge-v2'],constellation:[1080,1920,'03-living-constellation-v2']})[kind];
if(!config)throw Error('Use main, squares or constellation');
const[W,H,name]=config;
app.setPath('userData',fs.mkdtempSync(path.join(OUT,'work/three-')));
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:!/^(file:|data:|blob:)/.test(d.url)}));
 session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
 const win=new BrowserWindow({width:W,height:H,show,frame:false,useContentSize:true,enableLargerThanScreen:true,backgroundColor:'#080917',title:`Mefi Motion Studio — ${kind}`,webPreferences:{offscreen:!show,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.setContentSize(W,H);console.log('Canvas size',win.getContentSize());
 const wc=win.webContents;wc.setAudioMuted(true);if(!show)wc.setFrameRate(60);let lastPaint=null;wc.on('paint',(_event,_dirty,image)=>lastPaint=image);
 const errors=[];wc.on('console-message',(_e,d)=>{if(d.level==='error'){errors.push(d.message);console.error('Renderer:',d.message);}});
 await win.loadFile(path.join(__dirname,worktree?'worktree-stage.html':ascii?'ascii-stage.html':story?'node-story.html':flow?'flow-stage.html':'three-stage.html'),{query:{kind,...show?{play:'1'}:{}}});
 for(let i=0;i<200;i++){if(await wc.executeJavaScript('Boolean(window.__ready)'))break;await wait(100);}
 if(!await wc.executeJavaScript('Boolean(window.__ready)'))throw Error('3D scene not ready');
 console.log('Ready',kind,JSON.stringify(await wc.executeJavaScript('window.__renderInfo')));
 if(show)return;
 const frame=async t=>{await wc.executeJavaScript(`window.renderFrame(${t})`);const n=Math.round(t*30);for(let attempt=0;attempt<180;attempt++){wc.invalidate();await wait(12);if(!lastPaint)continue;const data=lastPaint.toBitmap();if(data[0]!==113||data[1]!==16+(n>>8)||data[2]!== (n&255))continue;const im=lastPaint;if(im.getSize().width!==W||im.getSize().height!==H)throw Error('Unexpected frame dimensions '+JSON.stringify(im.getSize()));return im;}throw Error(`Compositor did not deliver frame ${n}`);};
 const previewTimes=worktree?[.6,3.6,6.9,9.7,13.4,16.3,20.6,23.3,25.3,28.2]:ascii?[1.8,5.2,8.1,11.7,14.9,17.8,22.2,28.9]:story?[1.8,5.2,9,11.7,15.5,20.4,24.1,28.9]:[1.8,5.2,9,12.9,16.5,20.4,24.1,28.1];
 if(preview){for(const t of previewTimes){const im=await frame(t);fs.writeFileSync(path.join(OUT,'work',`${name}-${t}.png`),im.toPNG());console.log('Preview',t);}app.quit();return;}
 const ff=spawn('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','rawvideo','-pixel_format','bgra','-video_size',`${W}x${H}`,'-framerate','30','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','19','-maxrate','8000k','-bufsize','16000k','-pix_fmt','yuv420p','-movflags','+faststart',path.join(OUT,`${name}.mp4`)],{stdio:['pipe','ignore','pipe']});
 let ffErrors='';ff.stderr.on('data',x=>ffErrors+=x);const done=once(ff,'close');
 const started=Date.now();for(let i=0;i<900;i++){const im=await frame(i/30);if(i===160)fs.writeFileSync(path.join(OUT,`${name}.png`),im.toPNG());const bitmap=im.toBitmap();for(const offset of[0,4,W*4,W*4+4])bitmap.copy(bitmap,offset,8,12);if(!ff.stdin.write(bitmap))await once(ff.stdin,'drain');if(i%90===0)console.log(`${kind} ${i}/900 · ${Math.round((Date.now()-started)/1000)}s`);}
 ff.stdin.end();const[code]=await done;if(code!==0)throw Error(ffErrors||`ffmpeg exited ${code}`);
 fs.writeFileSync(path.join(OUT,'work',`${name}-report.json`),JSON.stringify({name,kind,width:W,height:H,seconds:30,fps:30,audio:false,errors,elapsedSeconds:(Date.now()-started)/1000},null,2));
 console.log('Exported',path.join(OUT,`${name}.mp4`));app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
