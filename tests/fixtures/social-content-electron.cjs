"use strict";
const {app,BrowserWindow,session}=require("electron");
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=process.env.MEFI_SOCIAL_FIXTURE,studio=path.resolve(__dirname,"../..");
if(!root||!path.isAbsolute(root))throw new Error("A temporary social fixture is required");
app.setName("Social content fixture");for(const key of ["userData","sessionData","crashDumps"]){const dir=path.join(root,key);fs.mkdirSync(dir,{recursive:true});app.setPath(key,dir);}
app.disableHardwareAcceleration();const report={permissions:[],passiveNetwork:[],complete:false};let done=false;
function finish(error){if(done)return;done=true;if(error)report.error=error.stack||String(error);fs.writeFileSync(path.join(root,"report.json"),JSON.stringify(report));app.exit(error?1:0);}
process.on("uncaughtException",finish);process.on("unhandledRejection",finish);
app.whenReady().then(async()=>{
  session.defaultSession.setPermissionRequestHandler((_wc,permission,cb)=>{report.permissions.push(permission);cb(false);});
  session.defaultSession.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*"]},(details,cb)=>{report.passiveNetwork.push(details.url);cb({cancel:true});});
  const css=["social-content.css","room-images.css","item-trades.css"].map(name=>fs.readFileSync(path.join(studio,"renderer",name),"utf8")).join("\n");
  fs.writeFileSync(path.join(root,"index.html"),`<!doctype html><html><meta charset="utf-8"><style>body{font:16px system-ui;background:#101620;color:#eef5ef}button,input,textarea,select{font:inherit}dialog{background:#182334;color:#fff;max-width:90vw}button{margin:4px}${css}</style><body><h1>Social content verification</h1></body></html>`);
  const win=new BrowserWindow({width:600,height:700,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  await win.loadFile(path.join(root,"index.html"));
  for(const name of ["social-content.js","room-images.js","item-trades.js"])await win.webContents.executeJavaScript(fs.readFileSync(path.join(studio,"renderer",name),"utf8"));
  const result=await win.webContents.executeJavaScript(`(async()=>{
    const check=(value,label)=>{if(!value)throw new Error(label);};
    const find=label=>[...document.querySelectorAll('button')].find(x=>x.textContent===label);
    const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI did not settle');};
    const opened=[],calls=[];window.confirm=()=>true;window.mefiStudio={openExternal:url=>opened.push(url)};
    const links=MefiSocialContent.content('hello https://www.youtube.com/watch?v=jNQXAC9IVRw https://private.local/?token=secret <svg onload=bad>');document.body.append(links);
    check(!document.querySelector('iframe,img,svg'),'rendering content is inert');check(!links.textContent.includes('token=secret'),'secrets redacted');
    const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1000;const ctx=canvas.getContext('2d');ctx.fillStyle='#57caab';ctx.fillRect(0,0,2000,1000);ctx.fillStyle='#142038';ctx.fillRect(10,10,100,100);
    const raw=Uint8Array.from(atob(canvas.toDataURL('image/jpeg').split(',')[1]),c=>c.charCodeAt(0));const meta=new TextEncoder().encode('Exif\\0\\0GPSLatitude=41;secret_filename');const size=meta.length+2;
    const extra=Uint8Array.of(255,225,size>>8,size&255,...meta);const file=new File([raw.slice(0,2),extra,raw.slice(2)],'private-home.jpg',{type:'image/jpeg'});
    const jpeg=await MefiRoomImages.prepare(file);check(jpeg.length<=131072,'bounded JPEG');check(!atob(jpeg).includes('GPSLatitude'),'metadata removed');
    const pixels=MefiRoomImages.dimensions(Uint8Array.from(atob(jpeg),c=>c.charCodeAt(0)));check(pixels.width===1280&&pixels.height===640,'pixel resize');
    const bad=new Uint8Array(24);new DataView(bad.buffer).setUint32(0,0x89504e47);new DataView(bad.buffer).setUint32(4,0x0d0a1a0a);new DataView(bad.buffer).setUint32(12,0x49484452);new DataView(bad.buffer).setUint32(16,65535);new DataView(bad.buffer).setUint32(20,65535);
    let refused=false;try{await MefiRoomImages.prepare(new File([bad],'huge.png',{type:'image/png'}));}catch{refused=true;}check(refused,'oversized decoded image refused');
    window.mefiStudio.hubRoom=async(method,...args)=>{calls.push([method,...args]);return ['roomImage','modReportImage'].includes(method)?{ok:true,jpeg,width:1280,height:640}:{ok:true};};
    const card=MefiRoomImages.card({id:'image_'+'a'.repeat(32)},'room');document.body.append(card);check(calls.length===0,'image is not fetched on display');find('Show image').click();await wait(()=>card.querySelector('img'));check(calls[0][0]==='roomImage','authenticated image bridge');find('Hide image').click();check(!card.querySelector('img'),'hidden pixels removed');
    card.remove();const evidence=MefiRoomImages.reportCard('rep_evidence');document.body.append(evidence);check(!calls.some(x=>x[0]==='modReportImage'),'moderator evidence is not fetched automatically');find('Show image').click();await wait(()=>evidence.querySelector('img'));check(calls.at(-1)[0]==='modReportImage','moderator-only image bridge');find('Hide image').click();check(!evidence.querySelector('img'),'hidden evidence removed');evidence.remove();
    const originalClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){const transfer=new DataTransfer();transfer.items.add(file);this.files=transfer.files;this.dispatchEvent(new Event('change'));}else originalClick.call(this);};
    MefiRoomImages.choose('room','The den');await wait(()=>find('Share image'));check(!calls.some(x=>x[0]==='sendImage'),'review comes before upload');
    document.querySelector('textarea').value='A safe caption';find('Share image').click();await wait(()=>!document.querySelector('dialog'));const upload=calls.find(x=>x[0]==='sendImage');check(upload[2].caption==='A safe caption'&&upload[2].jpeg===jpeg,'reviewed pixels sent once');check(!JSON.stringify(upload).includes('private-home'),'no filename');HTMLInputElement.prototype.click=originalClick;
    localStorage.setItem('mefiStudio.social.images','off');check(!MefiRoomImages.card({id:'x'},'room').querySelector('button'),'image kill switch');localStorage.removeItem('mefiStudio.social.images');
    const trade={id:'trade_'+'b'.repeat(32),sender:{id:'200000000000000001',name:'Alice'},recipient:{id:'200000000000000002',name:'Bob'},offered:{id:'studio:pet-cloud',name:'Cloud'},requested:{id:'studio:skin-frost',name:'Frost'},status:'pending',expiresAt:Date.now()+60000};
    window.mefiStudio.hubStatus=async()=>({status:{user:{id:trade.recipient.id}}});window.mefiStudio.hubShop=async(method,...args)=>{calls.push([method,...args]);if(method==='trades')return {ok:true,enabled:true,trades:[trade]};if(method==='tradeDecide'){trade.status='accepted';return {ok:true,trade};}return {ok:false};};
    await MefiTrades.open();check(!calls.some(x=>x[0]==='tradeDecide'),'opening does not accept');find('Review swap').click();check(!calls.some(x=>x[0]==='tradeDecide'),'review does not accept');check(document.querySelector('dialog').textContent.includes('Give Frost to Alice and receive Cloud'),'exact terms visible');
    const bounds=document.querySelector('dialog').getBoundingClientRect();check(bounds.width<=innerWidth&&bounds.left>=0,'dialog fits narrow viewport');find('Accept this swap').click();await wait(()=>document.querySelector('dialog').textContent.includes('accepted'));check(calls.filter(x=>x[0]==='tradeDecide').length===1,'one decision');find('Close').click();check(!document.querySelector('dialog'),'close removes modal');
    localStorage.setItem('mefiStudio.trades','off');await MefiTrades.open();check(!document.querySelector('dialog'),'trade kill switch');
    return {pixels,calls:calls.map(x=>x[0]),links:opened.length};
  })()`);
  assert.deepEqual(report.passiveNetwork,[]);report.results=result;report.complete=true;finish();
}).catch(finish);
