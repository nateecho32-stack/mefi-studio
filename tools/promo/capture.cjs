// Reproducible footage plates: current renderer, synthetic bridge, no live data.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'dist/promo');
app.setPath('userData',fs.mkdtempSync(path.join(OUT,'work/capture-')));
app.commandLine.appendSwitch('force-device-scale-factor','1');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:! /^(file:|data:|blob:)/.test(d.url)}));
  session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  const win=new BrowserWindow({width:1600,height:1000,show:false,frame:false,backgroundColor:'#171819',webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const wc=win.webContents;wc.setFrameRate(30);wc.setAudioMuted(true);
  const errors=[];
  wc.on('console-message',(_e,d)=>{if(d.level==='error')errors.push(d.message);});
  const run=code=>wc.executeJavaScript(`(async()=>{${code}})()`);
  await win.loadFile(path.join(OUT,'work/preview/index.html'));
  for(let i=0;i<25;i++){
    if(await run(`const b=document.getElementById('boot-continue');if(b&&!b.disabled)b.click();return !!window.MefiNav;`))break;
    await wait(400);
  }
  await wait(2200);
  await run(`window.MefiOnboarding?.close?.();`);
  const shots=[
    ['home',`window.MefiNav.go('workspace');`],
    ['map',`window.MefiNav.go('agent-brain',{tab:'map'});`],
    ['pipeline',`window.MefiNav.go('agent-brain',{tab:'live'});`],
    ['playbook',`window.MefiNav.go('agent-brain',{tab:'playbook'});`],
    ['brains',`window.MefiNav.go('brains');`],
    ['routing',`window.MefiNav.go('studio',{category:'connections'});`],
    ['tasks',`window.MefiNav.go('tasks');`],
    ['command',`window.MefiNav.go('command');`],
    ['music',`window.MefiMusic?.openAudio?.();`],
  ];
  for(const [name,code]of shots){
    await run(code);await wait(name==='command'?5000:2000);
    if(name==='brains')await run(`document.getElementById('brains-fit')?.click();`);
    if(name==='command')await run(`document.getElementById('idle-fit')?.click();`);
    await wait(700);wc.invalidate();await wait(180);
    fs.writeFileSync(path.join(OUT,'screens',`${name}.png`),(await wc.capturePage()).toPNG());
    console.log('Captured',name);
  }
  fs.writeFileSync(path.join(OUT,'work/capture-report.json'),JSON.stringify({synthetic:true,shots:shots.map(s=>s[0]),errors},null,2));
  app.quit();
}).catch(e=>{console.error(e);app.exit(1);});
