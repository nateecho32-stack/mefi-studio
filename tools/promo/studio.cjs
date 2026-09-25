// Isolated, visible renderer for computer-use footage. F9 saves a clean frame.
// All IPC is a synthetic bridge from prepare.cjs; no app main or live data.
const {app,BrowserWindow,session} = require("electron");
const fs = require("node:fs"), path = require("node:path");
const ROOT = path.resolve(__dirname,"../..");
const OUT = path.join(ROOT,"dist/promo");
app.setName("Mefi Showcase Sample");
app.setPath("userData",fs.mkdtempSync(path.join(OUT,"work/profile-")));
app.commandLine.appendSwitch("force-device-scale-factor","1");
let shot = 0;
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest((d,cb)=>cb({cancel:! /^(file:|data:|blob:)/.test(d.url)}));
  session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  const win = new BrowserWindow({width:1440,height:900,useContentSize:true,show:true,title:"Mefi Showcase Sample",backgroundColor:"#171819",webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  win.webContents.on("page-title-updated",e=>{e.preventDefault();win.setTitle("Mefi Showcase Sample");});
  win.webContents.on("before-input-event",async(e,input)=>{
    if(input.type==="keyDown" && input.key==="F9"){
      e.preventDefault();
      const file = path.join(OUT,"screens",`screen-${String(++shot).padStart(2,"0")}.png`);
      fs.writeFileSync(file,(await win.webContents.capturePage()).toPNG());
      console.log(file);
    }
  });
  await win.loadFile(path.join(OUT,"work/preview/index.html"));
  win.setTitle("Mefi Showcase Sample");
});
app.on("window-all-closed",()=>app.quit());
