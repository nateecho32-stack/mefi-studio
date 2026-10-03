// Renderer-only channel exercise. The bridge simulates confirmation results;
// host tests separately run the real channel handler against a native-dialog
// stub. This fixture never opts a live installation into development.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
exports.seed = responses => {
  responses.launchStudio = {ok:false,error:"Launching is disabled in this isolated fixture."};
  responses.getApiKey = {saved:false};
  responses.releaseStatus = {ok:true,status:{state:"current",channel:"stable",supported:true,current:"0.4.4",latest:{version:"0.4.4"}}};
  responses.releaseCheck = responses.releaseStatus;
  responses.updateStatus = {ok:true,status:{watching:false,reason:"installed builds use GitHub update channels"}};
};
exports.bridge = () => `
  releaseSetChannel:async channel=>{
    // First enable simulates native Cancel. Second enable uses fixture consent.
    responses.fixtureEnableAttempts=(responses.fixtureEnableAttempts||0)+(channel==='development'?1:0);
    if(channel==='development'&&responses.fixtureEnableAttempts===1)return {ok:true,cancelled:true,status:responses.releaseStatus.status};
    responses.releaseStatus={ok:true,status:{state:channel==='development'?'none':'current',channel,supported:true,current:'0.4.4',unavailable:channel==='development'?'No supported development artifact is available yet. Stable releases remain available.':null}};
    return responses.releaseStatus;
  },`;
exports.capture = async ({window,run,until,sleep,capturePage,report,root}) => {
  await until("window.MefiNav", "channel navigation");
  await run("window.MefiNav.go('studio',{section:'settings-updates'});document.getElementById('settings-updates').open=true;document.getElementById('release-development').scrollIntoView({block:'center'});");
  await until("document.getElementById('release-status').textContent.includes('stable')", "stable channel");
  const visibility=await run("const e=document.getElementById('release-development');return {visible:e.closest('label').checkVisibility(),ancestors:[e,...(()=>{const out=[];let p=e.parentElement;while(p){out.push(p);p=p.parentElement;}return out;})()].map(n=>({id:n.id,hidden:n.hidden,display:getComputedStyle(n).display,open:n.open})),bridge:typeof window.mefiStudio.launchStudio};");
  assert.equal(visibility.visible,true,`the switch is visible in desktop Settings: ${JSON.stringify(visibility)}`);
  const directory=process.env.MEFI_RELEASE_CHANNEL_CAPTURE_DIR||root;fs.mkdirSync(directory,{recursive:true});
  await sleep(180);fs.writeFileSync(path.join(directory,"updates-stable.png"),(await capturePage()).toPNG());
  await run("document.getElementById('release-development').click();");
  await until("!document.getElementById('release-development').disabled&&!document.getElementById('release-development').checked", "cancel keeps stable");
  await run("document.getElementById('release-development').click();");
  await until("document.getElementById('release-status').textContent.includes('No supported development artifact')", "truthful missing development build");
  assert.equal(await run("return document.getElementById('release-development').checked;"),true);
  await sleep(180);fs.writeFileSync(path.join(directory,"updates-development-unavailable.png"),(await capturePage()).toPNG());
  await run("document.getElementById('release-development').click();");
  await until("!document.getElementById('release-development').checked", "return to stable");
  window.setSize(600,900);await sleep(150);
  await run("document.getElementById('release-development').scrollIntoView({block:'center'});");
  const geometry=await run("const e=document.getElementById('release-development').closest('label'),r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,warning:document.getElementById('release-channel-warning').textContent,status:document.getElementById('release-status').textContent};");
  assert.ok(geometry.left>=0&&geometry.right>geometry.left&&geometry.right<=geometry.width+1);assert.match(geometry.warning,/untested.*unstable.*data loss/);
  await sleep(180);fs.writeFileSync(path.join(directory,"updates-narrow.png"),(await capturePage()).toPNG());
  report.channels={cancelKeptStable:true,developmentUnavailable:true,returnedToStable:true,narrowFits:true,bridge:"isolated fixture"};
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.networkAttempts,[]);assert.deepEqual(report.processAttempts,[]);
};
