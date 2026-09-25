import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

const kind=new URLSearchParams(location.search).get('kind')||'main';
document.body.className=kind;
const W=innerWidth,H=innerHeight,square=kind==='squares',vertical=kind==='constellation';
const scene=new T.Scene();
const camera=new T.PerspectiveCamera(vertical?40:38,W/H,.1,100);
const renderer=new T.WebGLRenderer({alpha:false,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(1);renderer.setSize(W,H);renderer.setClearColor(0x000000,0);
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=square?1.05:1.05;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
document.querySelector('#stage').append(renderer.domElement);
const pmrem=new T.PMREMGenerator(renderer);const room=new RoomEnvironment();
scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));
const bloom=new UnrealBloomPass(new T.Vector2(W,H),square?.06:.08,.18,1.5);
composer.addPass(bloom);composer.addPass(new OutputPass());
const backgroundCanvas=document.createElement('canvas');backgroundCanvas.width=1024;backgroundCanvas.height=Math.round(1024*H/W);const bc=backgroundCanvas.getContext('2d');bc.fillStyle=square?'#e8ecfa':'#080b19';bc.fillRect(0,0,backgroundCanvas.width,backgroundCanvas.height);
for(const [x,y,r,color] of square?[[.1,.85,.8,'#afdcf2'],[1,.6,.7,'#d7bef2'],[.4,0,.8,'#ffffff']]:[[.8,.4,.5,'#184451'],[.3,1,.6,'#363068'],[1,1,.4,'#371e48']]){const bw=backgroundCanvas.width,bh=backgroundCanvas.height,g=bc.createRadialGradient(x*bw,y*bh,0,x*bw,y*bh,r*Math.max(bw,bh));g.addColorStop(0,color);g.addColorStop(1,'transparent');bc.fillStyle=g;bc.fillRect(0,0,bw,bh);}const btex=new T.CanvasTexture(backgroundCanvas);btex.colorSpace=T.SRGBColorSpace;scene.background=btex;
scene.add(new T.AmbientLight(0xcad9ff,.9));
function area(color,intensity,pos,size=8){const l=new T.DirectionalLight(color,intensity);l.position.set(...pos);scene.add(l);return l;}
area(0xa6ffff,1.5,[-4,5,6]);area(0xbb8aff,1.6,[5,2,-1]);area(0xffffff,1.5,[0,7,1]);
const root=new T.Group();scene.add(root);
const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);},out=x=>1-Math.pow(1-clamp(x),3),lerp=(a,b,t)=>a+(b-a)*t;
const rng=i=>{let n=Math.sin(i*127.1+53.7)*43758.5453;return n-Math.floor(n);};
const white=new T.Color('#e0ffee'),violet=new T.Color('#aa91ff'),blue=new T.Color('#6bd7ff');
const metal=new T.MeshPhysicalMaterial({color:0x7288ab,metalness:.91,roughness:.22,clearcoat:1,clearcoatRoughness:.12,iridescence:.75,iridescenceIOR:1.4,iridescenceThicknessRange:[130,470]});
const dark=new T.MeshPhysicalMaterial({color:0x101529,metalness:.6,roughness:.23,clearcoat:1});
const glow=(color,intensity=2)=>new T.MeshStandardMaterial({color,emissive:color,emissiveIntensity:intensity,metalness:.25,roughness:.2});
const mintGlow=glow(0x89e8c5,.65),purpleGlow=glow(0x9c80e9,.6),cyanGlow=glow(0x69b8e3,.65);
function round(w,h,d,r=.12){return new RoundedBoxGeometry(w,h,d,4,r);}
function mesh(g,m,parent=root){const o=new T.Mesh(g,m);parent.add(o);return o;}
function labelTexture(text,sub='',color='#dbfff2',bg=null){const c=document.createElement('canvas');c.width=768;c.height=320;const ctx=c.getContext('2d');if(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,768,320);}ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 71px "Segoe UI", sans-serif';ctx.fillStyle=color;ctx.fillText(text,384,sub?128:160);if(sub){ctx.font='400 34px "Segoe UI", sans-serif';ctx.fillStyle='#8da5c9';ctx.fillText(sub,384,221);}const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;return tex;}
function textPlane(text,w,h,parent,sub='',color){return mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map:labelTexture(text,sub,color),transparent:true,depthWrite:false,toneMapped:false}),parent);}
function makeCore(){const group=new T.Group();root.add(group);const body=mesh(round(1.66,1.56,1.25,.32),metal.clone(),group);body.material.color.set(0x95bfca);body.material.iridescence=1;
 const visor=mesh(round(1.28,.75,.14,.24),new T.MeshBasicMaterial({color:0x101d30}),group);visor.position.set(0,.08,.655);
 for(const x of[-.28,.28]){const eye=mesh(round(.095,.25,.06,.045),mintGlow,group);eye.position.set(x,.1,.74);}
 const name=textPlane('M+',.56,.25,group,'','#cbf9ed');name.position.set(0,-.53,.655);
 const rim=mesh(new T.TorusGeometry(1.19,.036,12,100),mintGlow,group);rim.rotation.x=Math.PI/2.6;rim.rotation.y=.35;
 const ring2=mesh(new T.TorusGeometry(1.48,.014,8,110),purpleGlow,group);ring2.rotation.x=.6;ring2.rotation.y=1.1;
 const earL=mesh(round(.16,.48,.46,.075),metal,group);earL.position.x=-.9;const earR=earL.clone();earR.position.x=.9;group.add(earR);
 return{group,body,rim,ring2};}
const core=makeCore();

const dust=new T.Group();root.add(dust);const dustBits=[];
for(let i=0;i<48;i++){const d=mesh(new T.SphereGeometry(.009+rng(i)*.012,6,4),i%3?cyanGlow:purpleGlow,dust);const p=[(rng(i+60)-.5)*18,(rng(i+300)-.5)*13,-3-rng(i+720)*7];d.userData={p,i};dustBits.push(d);}
function halo(color){const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d'),g=x.createRadialGradient(128,128,0,128,128,128);g.addColorStop(0,color);g.addColorStop(.18,color);g.addColorStop(1,'transparent');x.fillStyle=g;x.fillRect(0,0,256,256);return new T.CanvasTexture(c);}
const ambientHalos=[];for(let i=0;i<3;i++){const sp=new T.Sprite(new T.SpriteMaterial({map:halo(i===0?'#6b65ff':i===1?'#29a6a0':'#c258df'),transparent:true,opacity:.12,depthWrite:false,blending:T.AdditiveBlending}));sp.scale.set(8,8,1);sp.position.set(i===0?-4:i===1?4:0,i===2?-3:0,-5);scene.add(sp);ambientHalos.push(sp);}

const features=[
 {key:'map',tag:'HOME · PLANS · PROJECT MAP',title:['See the','whole project.'],desc:'A new Home, live planning and an explorable map.',detail:'Systems → parts → files',node:'Project map',sub:'EXPLORE',crop:[245,90,1330,845]},
 {key:'pipeline',tag:'THE AGENT BRAIN',title:['Watch agents','work together.'],desc:'Live pipelines, parallel steps and reports that return home.',detail:'Companion → lead → agents → evidence',node:'AgentBrain',sub:'ORCHESTRATE',crop:[553,160,1030,558]},
 {key:'playbook',tag:'PLAYBOOK · BRAIN MAPS',title:['Keep what','worked.'],desc:'Reusable recipes turn past work into the next plan.',detail:'Build a library of better ways to work',node:'Playbook',sub:'REMEMBER',crop:[251,90,1330,820]},
 {key:'routing',tag:'OPENROUTER · PROVIDER CONTROLS',title:['Bring your','best models.'],desc:'Your providers, model routing and usage in one place.',detail:'Choose the model for the job',node:'Your models',sub:'CONNECT',crop:[265,115,1320,775]},
 {key:'music',tag:'MUSIC · RADIO · FLOATING VIDEO',title:['Stay in','your flow.'],desc:'Your soundtrack and media move with the workspace.',detail:'Play a link. Keep working.',node:'Media',sub:'STAY IN FLOW',crop:[610,85,980,880]},
 {key:'tasks',tag:'TASKS · REVIEW · VERIFICATION',title:['See what’s','really done.'],desc:'Clearer reviews, recorded checks and fewer repeat questions.',detail:'From progress to proof',node:'Checks',sub:'VERIFY',crop:[650,100,940,800]},
];
const textures={};
await document.fonts.ready;
for(const f of features){const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=`../../dist/promo/screens/${f.key}.png`;});
 const c=document.createElement('canvas');c.width=1600;c.height=1000;const cx=c.getContext('2d');cx.fillStyle='#12171e';cx.fillRect(0,0,1600,1000);const[sx,sy,sw,sh]=f.crop;const ratio=Math.min(1600/sw,1000/sh),dw=sw*ratio,dh=sh*ratio;cx.drawImage(img,sx,sy,sw,sh,(1600-dw)/2,(1000-dh)/2,dw,dh);
 const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=renderer.capabilities.getMaxAnisotropy();textures[f.key]=tex;
}
const logoCanvas=document.createElement('canvas');logoCanvas.width=1600;logoCanvas.height=1000;const lc=logoCanvas.getContext('2d'),lg=lc.createLinearGradient(0,0,1600,1000);lg.addColorStop(0,'#ccfff3');lg.addColorStop(.48,'#78aeea');lg.addColorStop(1,'#b88bdc');lc.fillStyle=lg;lc.fillRect(0,0,1600,1000);lc.font='700 490px "Segoe UI", sans-serif';lc.textAlign='center';lc.fillStyle='#1d3456';lc.fillText('M+',800,680);const logoTexture=new T.CanvasTexture(logoCanvas);logoTexture.colorSpace=T.SRGBColorSpace;

const screenRig=new T.Group();root.add(screenRig);
const frame=mesh(round(8.62,5.5,.24,.13),metal,screenRig);
const inner=mesh(round(8.48,5.35,.07,.08),dark,screenRig);inner.position.z=.148;
const display=mesh(new T.PlaneGeometry(8.29,5.18),new T.MeshBasicMaterial({map:textures.map,toneMapped:false}),screenRig);display.position.z=.192;
const underlight=mesh(new T.BoxGeometry(6.4,.023,.025),cyanGlow,screenRig);underlight.position.set(0,-2.755,.04);
const tab=textPlane('M E F I   /   S T U D I O',2.9,.16,screenRig,'','#c4dcea');tab.position.set(0,2.665,.192);
const slabs=[];for(let i=0;i<3;i++){const p=mesh(round(8.4,5.3,.07,.12),new T.MeshPhysicalMaterial({color:i===0?0x566fa1:0x4c3874,metalness:.65,roughness:.2,transparent:true,opacity:.3,clearcoat:1}),screenRig);p.position.set(.16+i*.08,-.12-i*.08,-.2-i*.23);slabs.push(p);}

const tileRig=new T.Group();root.add(tileRig);const tiles=[];const cols=12,rows=7,tw=.75,th=.75;
const tileFrontMat=new T.MeshBasicMaterial({map:logoTexture,toneMapped:false});
for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const i=y*cols+x,g=new T.Group();tileRig.add(g);const m=metal.clone();m.color.setHSL(.5+x/cols*.2,.38,.7);const b=mesh(round(tw*.958,th*.958,.42,.065),m,g);const geom=new T.PlaneGeometry(tw*.91,th*.91);const uv=geom.attributes.uv;for(let q=0;q<uv.count;q++){uv.setXY(q,(x+uv.getX(q))/cols,1-(y+1-uv.getY(q))/rows);}const face=mesh(geom,tileFrontMat,g);face.position.z=.216;g.userData={x,y,i};tiles.push(g);}
const fusedDisplay=mesh(new T.PlaneGeometry(cols*tw-.06,rows*th-.06),new T.MeshBasicMaterial({map:logoTexture,transparent:true,opacity:0,toneMapped:false}),tileRig);fusedDisplay.position.z=.27;

const nodeRig=new T.Group();root.add(nodeRig);const nodes=[];const curves=[],wires=[],packets=[];
const destinations=[[-2.03,.5,.1],[2.03,-.1,.45],[-2.03,-1.4,.7],[2.03,-2,.1],[-2.03,-3.3,.2],[2.03,-3.9,.6]];
for(let i=0;i<6;i++){
 const g=new T.Group();nodeRig.add(g);const shell=mesh(round(2.63,1.13,.27,.15),metal.clone(),g);shell.material.color.set(i%2?0x7e80a4:0x68a9b8);
 const glass=mesh(round(2.51,1.015,.07,.11),new T.MeshBasicMaterial({color:i%2?0x121933:0x0c2330}),g);glass.position.z=.166;
 const txt=textPlane(features[i].node,2.36,.92,g,features[i].sub,i%2?'#e3d5ff':'#d1fff3');txt.position.z=.214;
 const led=mesh(new T.BoxGeometry(.82,.015,.026),i%2?purpleGlow:mintGlow,g);led.position.set(0,-.555,.15);
 nodes.push(g);
 const p=destinations[i],curve=new T.CubicBezierCurve3(new T.Vector3(0,1.62,0),new T.Vector3((i%2?1:-1)*.5,1.1,1.6),new T.Vector3(p[0]*.8,p[1]+.8,1.5),new T.Vector3(...p));curves.push(curve);
 const wire=mesh(new T.TubeGeometry(curve,75,.016,7,false),i%2?purpleGlow:cyanGlow,nodeRig);wires.push(wire);
 const packet=mesh(new T.SphereGeometry(.065,12,10),i%2?purpleGlow:mintGlow,nodeRig);packets.push(packet);
}
const sculpture=new T.Group();root.add(sculpture);const arcs=[];
for(let i=0;i<3;i++){const arc=mesh(new T.TorusGeometry(2.1+i*.34,i===1?.035:.08,14,120,Math.PI*(1.45+i*.1)),i===1?mintGlow:metal,sculpture);arc.rotation.set(i*.55,.5+i*.4,i*.75);arcs.push(arc);}

const el=id=>document.getElementById(id);let lastText='';
function copy(mode,index,t){let tag,title,desc,detail;if(mode==='hero'){tag=square?'A NEW DIMENSION OF STUDIO':vertical?'ONE IDEA. MANY POSSIBILITIES.':'A NEW CHAPTER';title=square?['From one idea.','To everything.']:vertical?['Give your ideas','a life of their own.']:['Your idea.','A whole studio.'];desc=square?'Your entire workflow, coming together.':vertical?'Meet a studio that moves with you.':'Plan it. Watch it. Make it real.';detail='';}
 else if(mode==='outro'){tag='FREE · OPEN SOURCE · WINDOWS';title=vertical?['Build something','worth sharing.']:square?['One studio.','Yours to create.']:['Build with Mefi.'];desc='Mefi’s Studio AI+';detail='';}
 else{const f=features[index];tag=f.tag;title=f.title;desc=f.desc;detail=f.detail;}
 const key=mode+index;if(key!==lastText){lastText=key;document.body.className=`${kind} ${mode}`;el('eyebrow').textContent=tag;el('headline').innerHTML=title.map((x,i)=>`<span class="${i===title.length-1?'accent':''}">${x}</span>`).join('<br>');el('description').textContent=desc;el('detail').textContent=detail;el('detail').style.display=detail?'flex':'none';el('cta').classList.toggle('hidden',mode!=='outro');el('url').classList.toggle('hidden',mode!=='outro');el('pill').style.display=mode==='feature'&&!vertical&&!square?'block':'none';el('footerLeft').textContent=square?'02 / VOXEL FORGE':vertical?'03 / LIVING CONSTELLATION':'01 / PRISM STUDIO';el('footerRight').textContent=vertical?'WORKFLOW ILLUSTRATION':'CURRENT UI · DEVELOPMENT PREVIEW';}
 let age=mode==='hero'?t:mode==='outro'?t-26:t-(3.8+index*3.7);const p=out(age/.62),fade=mode==='outro'?0:smooth((age-(mode==='hero'?3.58:3.48))/.22);document.querySelector('.copy').style.transform=`translateY(${(1-p)*28-fade*10}px)`;document.querySelector('.copy').style.opacity=String(p*(1-fade));el('progress').style.width=`${clamp(t/30)*100}%`;
}
function tick(t){
 const mode=t<3.8?'hero':t<26?'feature':'outro',index=Math.min(5,Math.max(0,Math.floor((t-3.8)/3.7))),age=mode==='feature'?t-(3.8+index*3.7):mode==='outro'?t-26:t;
 copy(mode,index,t);const enter=out(age/.95),end=mode==='feature'?smooth((age-3.36)/.34):0;
 dust.visible=!square;dust.rotation.y=t*.008;dustBits.forEach(d=>{const{p,i}=d.userData;d.position.set(p[0]+Math.sin(t*.18+i)*.08,p[1]+Math.sin(t*.3+i)*.15,p[2]);d.scale.setScalar(.65+.3*Math.sin(t*.4+i));});
 core.rim.rotation.z=t*.23;core.ring2.rotation.z=-t*.16;
 core.group.rotation.set(.08*Math.sin(t*.8),-.3+Math.sin(t*.32)*.24,.025*Math.sin(t*.7));
 screenRig.visible=!square&&!vertical&&mode==='feature';tileRig.visible=square;nodeRig.visible=vertical;sculpture.visible=!square&&!vertical&&mode!=='feature';
 core.group.visible=vertical||(!square&&mode!=='feature');
 if(!square&&!vertical){
  camera.position.set(.12*Math.sin(t*.13),.08,12.3);camera.lookAt(0,0,0);
  if(mode==='feature'){screenRig.position.set(2.73+(1-enter)*1.9+end*1.3,-.13-(1-enter)*.25,-.45);screenRig.rotation.set(-.055+Math.sin(age*.7)*.025,-.095+(1-enter)*.65-end*.45,-.018);screenRig.scale.setScalar(.95-(1-enter)*.1-end*.12);display.material.map=textures[features[index].key];}
  core.group.position.set(3.45,.15+Math.sin(t*.7)*.15,0);core.group.scale.setScalar(mode==='outro'?1.2:1.38);
  sculpture.position.copy(core.group.position);sculpture.rotation.set(t*.05,t*.035,-t*.04);sculpture.scale.setScalar(mode==='outro'?.85:.83+out(t/1.5)*.12);
  core.group.scale.multiplyScalar(mode==='hero'?out((t+.3)/1.3):out((age+.3)/.9));
 }else if(square){
  camera.position.set(.16*Math.sin(t*.19),.3,15.4);camera.lookAt(0,0,0);
  tileRig.position.set(-.04,-1.7,0);tileRig.rotation.set(.13+Math.sin(t*.24)*.035,-.15+Math.sin(t*.18)*.06,-.04);
  tileFrontMat.map=mode==='feature'?textures[features[index].key]:logoTexture;
  const st=mode==='feature'?age:mode==='outro'?age:t;
  fusedDisplay.material.map=tileFrontMat.map;fusedDisplay.material.opacity=mode==='feature'?smooth((st-1.12)/.4):0;
  tiles.forEach(g=>{const{x,y,i}=g.userData,p=out((st-(x+y)*.035)/.9),wave=Math.sin(t*1.3+x*.38+y*.46)*.025;g.position.set((x-(cols-1)/2)*tw+(1-p)*(rng(i+5)-.5)*5,((rows-1)/2-y)*th+(1-p)*3,p*wave+(1-p)*(rng(i+30)*7-2));g.rotation.set((1-p)*(rng(i+1)-.5)*4,(1-p)*(rng(i+4)-.5)*6,0);g.scale.setScalar(.92+.08*p);});
  tileRig.scale.setScalar(mode==='outro'?.66:.88);if(mode==='outro')tileRig.position.y=-2.45;
 }else{
  camera.position.set(.32*Math.sin(t*.15),.1,22);camera.lookAt(0,.2,0);
  core.group.position.set(0,lerp(-.2,1.65,out((t-3.8)/.9))+Math.sin(t*.65)*.085,.4);core.group.scale.setScalar(lerp(1.65,1.12,out((t-3.8)/.9)));
  nodeRig.position.y=-.05;
  if(mode==='hero'){core.group.position.y=-.2;core.group.scale.setScalar(1.65*out((t+.3)/1.3));nodeRig.visible=false;}
  if(mode==='outro'){const p=smooth((age-.7)/1.1);core.group.position.y=lerp(1.65,-2.2,p);core.group.scale.setScalar(lerp(1.12,1.6,p));}
  nodes.forEach((g,i)=>{let p=out((t-(3.8+i*3.7))/.85);if(mode==='outro')p=1-smooth(age/.8);const active=mode==='feature'&&i===index;g.visible=p>0;g.position.copy(curves[i].getPoint(p));g.position.y+=Math.sin(t*.9+i)*.045*p;g.rotation.set(-.05,((i%2?-.10:.10)+Math.sin(t*.4+i)*.035)*p,(1-p)*(i%2?.4:-.4));g.scale.setScalar(p*(active?1.025:.94));wires[i].visible=g.visible;wires[i].geometry.setDrawRange(0,Math.floor(wires[i].geometry.index.count*p/6)*6);packets[i].visible=g.visible&&p>.98;packets[i].position.copy(curves[i].getPoint((t*.34+i*.17)%1));});
 }
 ambientHalos.forEach((a,i)=>{a.material.opacity=square?0:.09+Math.sin(t*.25+i)*.025;});
 composer.render();
}
const syncMarker=document.createElement('div');syncMarker.style.cssText='position:absolute;left:0;top:0;width:2px;height:2px;z-index:9999;pointer-events:none';document.body.append(syncMarker);
window.renderFrame=async t=>{tick(t);const n=Math.round(t*30);syncMarker.style.backgroundColor=`rgb(${n&255},${16+(n>>8)},113)`;await new Promise(r=>requestAnimationFrame(r));composer.render();return{width:W,height:H,time:t,kind};};
window.__ready=true;
window.__renderInfo={renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),three:T.REVISION};
tick(0);
if(new URLSearchParams(location.search).has('play')){const start=performance.now();renderer.setAnimationLoop(()=>tick(((performance.now()-start)/1000)%30));}
