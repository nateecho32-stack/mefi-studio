import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {asciiArt,globe,thoughtFilms} from './ascii-glyphs.mjs';

// Visual grammar follows renderer/tree3d.js: small orbs, quiet links, coloured
// roles, amber work, green completion, travel wakes and returning reports.
// This is a deterministic concept scene using original synthetic content.
const W=innerWidth,H=innerHeight,V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),clamp=x=>Math.min(1,Math.max(0,x));
const ease=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);},out=x=>1-Math.pow(1-clamp(x),3),mix=T.MathUtils.lerp;
const rng=i=>{const x=Math.sin(i*83.791+3.731)*48391.7;return x-Math.floor(x);};
const fade=(t,a,b,d=.2)=>ease((t-a)/d)*(1-ease((t-b)/d));
const P={bg:0x04080e,pending:0x494d50,active:0xc9a86a,done:0x57d69a,agent:0xe6c98d,blue:0x8fd0ff,purple:0xc9a7f5,edge:0x536674};
const scene=new T.Scene();scene.background=new T.Color(P.bg);scene.fog=new T.FogExp2(P.bg,.023);
const camera=new T.PerspectiveCamera(39,W/H,.05,140),renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(1);renderer.setSize(W,H);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.76;document.body.prepend(renderer.domElement);
const pm=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pm.fromScene(room,.08).texture;scene.environmentIntensity=.17;room.dispose();
scene.add(new T.HemisphereLight(0x9cafbd,0x050609,.5));for(const[c,p,i]of[[0x8fc1ba,[-5,7,9],1.4],[0x677ea5,[8,1,-6],1.2]]){const l=new T.DirectionalLight(c,i);l.position.set(...p);scene.add(l);}
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));composer.addPass(new UnrealBloomPass(new T.Vector2(W,H),.06,.22,1.3));composer.addPass(new OutputPass());
const backdrop=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthWrite:false,depthTest:false,uniforms:{uTime:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.,1.);}',fragmentShader:`varying vec2 vUv;uniform float uTime;void main(){vec2 p=vUv;float a=exp(-dot((p-vec2(.65,.52))/vec2(.7,.85),(p-vec2(.65,.52))/vec2(.7,.85))*2.);float b=exp(-dot((p-vec2(.12,.2))/vec2(.5,.65),(p-vec2(.12,.2))/vec2(.5,.65))*2.);vec3 c=vec3(.002,.003,.005)+a*vec3(.002,.004,.007)+b*vec3(.002,.002,.004);gl_FragColor=vec4(c,1.);}`}));backdrop.renderOrder=-1000;backdrop.frustumCulled=false;scene.add(backdrop);
const starPos=[],starCol=[];for(let i=0;i<340;i++){starPos.push((rng(i)-.5)*55,(rng(i+500)-.5)*35,-8-rng(i+1000)*26);const b=.025+rng(i+200)*.075;starCol.push(b*.73,b*.88,b);}
const stars=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(starPos,3)).setAttribute('color',new T.Float32BufferAttribute(starCol,3)),new T.PointsMaterial({size:.021,vertexColors:true,transparent:true,opacity:.5,depthWrite:false}));scene.add(stars);
const world=new T.Group();scene.add(world);
const basic=(color,opacity=1)=>new T.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1});
function ring(radius,width,color,parent=world,opacity=.6){const m=new T.Mesh(new T.TorusGeometry(radius,width,7,72),basic(color,opacity));parent.add(m);return m;}
function ball(radius,color,parent,glow=.04){const mat=new T.MeshPhysicalMaterial({color,emissive:color,emissiveIntensity:glow,metalness:.25,roughness:.43,clearcoat:.35});const m=new T.Mesh(new T.SphereGeometry(radius,24,18),mat);parent.add(m);return m;}
function glowDisc(parent,r,color){const cv=document.createElement('canvas');cv.width=cv.height=128;const x=cv.getContext('2d'),g=x.createRadialGradient(64,64,1,64,64,62);g.addColorStop(0,'#ffffff88');g.addColorStop(.2,'#ffffff33');g.addColorStop(1,'#ffffff00');x.fillStyle=g;x.fillRect(0,0,128,128);const m=new T.Mesh(new T.PlaneGeometry(r,r),new T.MeshBasicMaterial({map:new T.CanvasTexture(cv),color,transparent:true,depthWrite:false,opacity:.3,blending:T.AdditiveBlending}));parent.add(m);return m;}

// id, parent, position, birth, work starts, work completes, radius.
const specs=[
 ['root',null,[0,3.4,0],0,0,27.8,.47],
 ['a','root',[-3.7,1.05,.6],2.35,2.9,8.0,.35],
 ['a1','a',[-5.35,-.8,1],4.05,6.15,8.0,.23],
 ['a2','a',[-3.35,-1.15,-.4],4.4,6.5,9.5,.23],
 ['a3','a',[-1.8,-.85,1.5],4.75,7.35,10.5,.23],
 ['a11','a1',[-6.0,-2.65,.55],7.8,8.15,10.3,.135],
 ['a12','a1',[-4.8,-2.9,1.65],8.0,8.55,11,.135],
 ['a21','a2',[-3.6,-3.3,-.85],8.2,9.1,11.7,.135],
 ['b','root',[.2,.85,-.7],8.4,8.95,14.4,.35],
 ['b1','b',[-.75,-1.55,-1.15],10.25,10.9,12.3,.23],
 ['b2','b',[1.3,-1.35,.6],10.6,12.6,14.4,.23],
 ['b11','b1',[-1.65,-3.5,-.8],12.05,12.5,15.5,.135],
 ['b12','b1',[-.25,-3.85,.3],12.35,13,16.2,.135],
 ['b21','b2',[1.2,-3.15,1],13.35,14,17.2,.135],
 ['c','root',[3.85,1.05,.4],14.75,15.25,21.4,.35],
 ['c1','c',[3.1,-1.2,.7],17.0,18.05,19.55,.23],
 ['c2','c',[5.65,-.65,-.5],17.4,20.0,21.3,.23],
 ['c11','c1',[2.65,-3.0,.25],19.4,21.5,22.1,.14],
 ['c21','c2',[4.45,-2.75,.85],20.5,22.35,23.0,.14],
 ['c22','c2',[6.0,-2.8,-1.1],20.75,23.25,24.0,.14],
 ['result','b12',[0,-5.05,-.1],22.3,24.65,26.2,.34],
 ['r1','result',[-1.4,-6.25,.6],24.8,25,26.5,.14],
 ['r2','result',[1.4,-6.25,.6],25.0,25.25,26.7,.14]
];
const nodes=new Map();
for(const[id,parent,pos,birth,start,done,radius]of specs){const group=new T.Group();group.position.set(...pos);world.add(group);const body=ball(radius,0x10202a,group);const rim=ring(radius*1.12,.009,P.pending,group,.5);const inner=ring(radius*.72,.0045,P.pending,group,.28);const arc=ring(radius*1.34,.014,P.active,group,.65);const ping=ring(radius*1.25,.01,P.done,group,0);const glow=glowDisc(group,radius*5,P.active);const mark=new T.Group();group.add(mark);const cgeo=new T.BufferGeometry().setFromPoints([V(-.11,-.015,radius+.015),V(-.015,-.095,radius+.015),V(.15,.1,radius+.015)]);const check=new T.Line(cgeo,new T.LineBasicMaterial({color:P.done,transparent:true,opacity:0}));mark.add(check);check.scale.setScalar(radius/.28);
 const icon=id==='root'?asciiArt(['M+'],.21,0xc7bd9d):null;if(icon){icon.position.z=radius+.025;group.add(icon);}
 nodes.set(id,{id,parent,pos:V(...pos),group,body,rim,inner,arc,ping,glow,mark,check,icon,birth,start,done,radius});}
const links=[];
function connect(fromId,toId,birth){const a=nodes.get(fromId),b=nodes.get(toId),mid=a.pos.clone().lerp(b.pos,.5);mid.z+=.22;const curve=new T.CatmullRomCurve3([a.pos,mid,b.pos]);const geom=new T.TubeGeometry(curve,64,.010,5,false),mesh=new T.Mesh(geom,basic(P.edge,.28));world.add(mesh);const packets=[];for(let k=0;k<2;k++){const dot=ball(.025,P.active,world,.25);packets.push(dot);}links.push({a,b,curve,mesh,packets,birth});}
for(const n of nodes.values())if(n.parent)connect(n.parent,n.id,n.birth-.25);
connect('b21','result',23.2);connect('c11','result',24.0);

function traveler(radius,color){const group=new T.Group();world.add(group);const body=ball(radius,color,group,.07),rim=ring(radius*1.3,.013,color,group,.65),cross=ring(radius*1.08,.006,color,group,.33);cross.rotation.y=.9;const shell=globe(radius*1.045,230);shell.material.uniforms.uSize.value=.054;shell.material.uniforms.uColor.value.set(color);shell.material.uniforms.uOpacity.value=.7;group.add(shell);const halo=glowDisc(group,radius*6,color);halo.material.opacity=.15;body.material.color.set(0x0e1921).lerp(new T.Color(color),.22);body.material.emissiveIntensity=.025;
const trailGeo=new T.BufferGeometry(),trailPos=new Float32Array(36*3),trailColors=new Float32Array(36*3);trailGeo.setAttribute('position',new T.BufferAttribute(trailPos,3));trailGeo.setAttribute('color',new T.BufferAttribute(trailColors,3));const trail=new T.Line(trailGeo,new T.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.72,depthWrite:false}));world.add(trail);return{group,body,rim,cross,shell,halo,trail,trailPos,trailColors,color:new T.Color(color)};}
const lead=traveler(.265,P.agent),assistants=[traveler(.12,P.blue),traveler(.105,P.purple)];
const anchor=id=>nodes.get(id).pos.clone().add(V(.7,.38,.75));
const visits=[
 [0,1.1,'root'],[2.65,5.5,'a'],[6.12,8.03,'a1'],[8.92,10.42,'b'],[10.88,12.03,'b1'],[12.59,14.38,'b2'],[15.24,17.48,'c'],[18.03,19.57,'c1'],[20.00,21.24,'c2'],[21.54,22.08,'c11'],[22.35,23.0,'c21'],[23.26,24.0,'c22'],[24.64,26.2,'result'],[27.32,30,'root']
];
function flight(a,b,u){const c1=a.clone().lerp(b,.35).add(V(0,.55,.75)),c2=a.clone().lerp(b,.72).add(V(.2,.3,.5));return new T.CubicBezierCurve3(a,c1,c2,b).getPoint(ease(u));}
function positionAt(t,route=visits,offset=0){const time=Math.max(0,t);for(let i=0;i<route.length;i++){const[a,b,id]=route[i];if(time>=a&&time<=b){const p=anchor(id);p.x+=Math.sin((time-a)*4+offset)*.12;p.y+=Math.cos((time-a)*4+offset)*.08;return p;}const next=route[i+1];if(next&&time>b&&time<next[0])return flight(anchor(id),anchor(next[2]),(time-b)/(next[0]-b));}return anchor(time<route[0][0]?route[0][2]:route[route.length-1][2]);}
const helperRoutes=[[[5.8,6.3,'a'],[6.65,7.8,'a2'],[8.2,9.2,'a11'],[9.6,10.6,'a12'],[11,11.8,'a21'],[12.5,14.5,'b11'],[15,16,'b12'],[16.5,17.2,'b21'],[18,25,'root']],[[11.5,12,'b'],[12.5,13.8,'b12'],[14.2,15.3,'b11'],[15.8,17,'b21'],[18,19,'c'],[19.5,21,'c1'],[21.5,23.4,'c2'],[24,26.4,'r1'],[27,30,'root']]];
function animateTraveler(agent,t,route,start=0){agent.group.visible=t>=start;if(t<start){agent.trail.visible=false;return;}const p=positionAt(t,route,start);agent.group.position.copy(p);agent.group.scale.setScalar(out((t-start)/.25));agent.body.rotation.y=t*.25;agent.rim.quaternion.copy(camera.quaternion);agent.cross.rotation.set(.35,t*.16,.18);agent.shell.rotation.y=t*.12;agent.shell.material.uniforms.uTime.value=t;agent.halo.quaternion.copy(camera.quaternion);
const speed=p.distanceTo(positionAt(t-.035,route,start))/.035;agent.trail.visible=speed>.25;const color=agent.color.clone();for(let i=0;i<36;i++){const q=positionAt(t-(35-i)*.009,route,start);agent.trailPos.set(q.toArray(),i*3);const alpha=Math.pow(i/35,2)*.6;agent.trailColors.set(color.clone().multiplyScalar(alpha).toArray(),i*3);}agent.trail.geometry.attributes.position.needsUpdate=true;agent.trail.geometry.attributes.color.needsUpdate=true;}

const thought=new T.Group();world.add(thought);const thoughts={};for(const kind of ['boat','hammer','robot','rocket'])thoughts[kind]=thoughtFilms[kind].map(lines=>{const m=asciiArt(lines.map(line=>line.replace("DONE","++++")),.12,0xffffff,kind);thought.add(m);return m;});
const thoughtCues=[[.2,1.0,'rocket'],[3.15,5.2,'hammer'],[9.15,10.35,'boat'],[11.0,11.85,'hammer'],[15.55,17.15,'hammer'],[18.25,19.25,'rocket'],[24.9,25.85,'hammer'],[27.4,29.15,'robot']];

// Original dark reference images. No messages, labels, live user content or
// feature cards; each preview is an object the agent actually inspects.
function picture(kind){const c=document.createElement('canvas');c.width=800;c.height=500;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,800,500);g.addColorStop(0,'#0b1320');g.addColorStop(1,'#0c2428');x.fillStyle=g;x.fillRect(0,0,800,500);
 if(kind===0){for(let i=0;i<70;i++){x.fillStyle=`rgba(149,178,190,${.08+rng(i)*.32})`;x.fillRect(rng(i+200)*800,rng(i+350)*290,1.5,1.5);}x.fillStyle='#8c947d';x.beginPath();x.arc(615,115,35,0,Math.PI*2);x.fill();const ridges=[[[0,340],[140,210],[285,345],[405,170],[610,340],[740,225],[800,300]],[[0,390],[175,300],[325,385],[475,270],[650,410],[800,340]]];ridges.forEach((pts,i)=>{x.beginPath();x.moveTo(0,500);pts.forEach(p=>x.lineTo(...p));x.lineTo(800,500);x.fillStyle=i?'#193c3b':'#172b35';x.fill();x.strokeStyle=i?'#42695c':'#374958';x.lineWidth=2;x.stroke();});for(let i=0;i<10;i++){x.strokeStyle=`rgba(94,138,143,${.16-i*.01})`;x.beginPath();x.moveTo(0,422+i*8);x.bezierCurveTo(170,415+i*8,560,450+i*3,800,418+i*8);x.stroke();}}
 else if(kind===1){const iso=(a,b,h)=>[400+(a-b)*31,145+(a+b)*15-h];for(let a=0;a<6;a++)for(let b=0;b<5;b++){const h=25+rng(a*8+b)*150,p=iso(a,b,h),q=iso(a+1,b,h),r=iso(a+1,b+1,h),s=iso(a,b+1,h),base=iso(a,b,0),br=iso(a+1,b+1,0);x.beginPath();x.moveTo(...s);x.lineTo(...r);x.lineTo(...br);x.lineTo(base[0]-31,base[1]+15);x.closePath();x.fillStyle='#173035';x.fill();x.strokeStyle='#3e6260';x.stroke();x.beginPath();[p,q,r,s].forEach((q,i)=>i?x.lineTo(...q):x.moveTo(...q));x.closePath();x.fillStyle='#2b4648';x.fill();x.strokeStyle='#6d8374';x.stroke();}x.strokeStyle='#436c69';x.lineWidth=1;for(let i=0;i<8;i++){x.beginPath();x.moveTo(100+i*60,420);x.lineTo(330+i*30,280);x.stroke();}}
 else {const pts=[];for(let i=0;i<28;i++)pts.push([90+rng(i+29)*620,65+rng(i+48)*370]);for(let i=1;i<28;i++){x.strokeStyle='#35574d';x.beginPath();x.moveTo(...pts[Math.floor((i-1)/2)]);x.lineTo(...pts[i]);x.stroke();}for(let i=0;i<28;i++){x.beginPath();x.arc(...pts[i],i<4?10:5,0,Math.PI*2);x.fillStyle=i%3?'#639984':'#918a6c';x.fill();}}
const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=8;return tex;}
const imageSpecs=[['a1',6.3,7.95,0],['b2',12.75,14.28,1],['c2',20.05,21.2,2]];
const images=imageSpecs.map(([id,start,end,kind])=>{const group=new T.Group();world.add(group);const border=new T.Mesh(new T.PlaneGeometry(2.7,1.72),basic(0x34534f));group.add(border);const plane=new T.Mesh(new T.PlaneGeometry(2.64,1.65),new T.MeshBasicMaterial({map:picture(kind),transparent:true,opacity:0,toneMapped:false}));plane.position.z=.012;group.add(plane);const scan=new T.Mesh(new T.PlaneGeometry(.025,1.64),basic(0x7eae9d,.23));scan.position.z=.025;group.add(scan);return{id,start,end,group,border,plane,scan};});
// Tiny document-like slivers gather into the output while the lead works.
const chips=[];for(let i=0;i<18;i++){const m=new T.Mesh(new T.BoxGeometry(.1,.15,.015),basic(i%3?0x4b7970:0x9b906b,.75));world.add(m);chips.push(m);}

const shots=[
 [0,[1.8,4.5,8.8],[0,2.8,0]],
 [2.5,[-1.5,2.8,10],[-2.7,1.25,.5]],
 [6.15,[-3.0,1.0,10],[-4.7,-.3,.8]],
 [8.65,[-1.7,2.3,11.5],[-1.2,.2,0]],
 [12.4,[2.4,1.5,10.3],[.9,-.8,0]],
 [15.3,[5.8,3.0,10.8],[3.55,.9,.3]],
 [19.4,[6.8,1.3,11.4],[4.2,-.9,.2]],
 [22,[7.0,4.0,16.8],[1,-1.1,0]],
 [25,[5.2,2.8,17.5],[0,-2.5,0]],
 [27.4,[3.4,5.4,18.4],[0,-.8,0]],
 [30,[-.7,5.0,18.6],[0,-.8,0]]
];
function shot(t){let i=0;while(i<shots.length-2&&t>shots[i+1][0])i++;const a=shots[i],b=shots[i+1],p=ease((t-a[0])/(b[0]-a[0]));camera.position.copy(V(...a[1])).lerp(V(...b[1]),p);camera.lookAt(V(...a[2]).lerp(V(...b[2]),p));camera.rotateZ(Math.sin(t*.13)*.012);}
function update(t){shot(t);stars.rotation.y=t*.0025;backdrop.material.uniforms.uTime.value=t;
 for(const n of nodes.values()){const born=out((t-n.birth)/.55),progress=clamp((t-n.start)/(n.done-n.start)),active=t>=n.start&&t<n.done,finished=t>=n.done;const color=new T.Color(finished?P.done:active?P.active:P.pending);n.group.visible=t>=n.birth;n.group.scale.setScalar(Math.max(.001,born)*(1+Math.sin(t*.6+n.birth)*.016));n.rim.quaternion.copy(camera.quaternion);n.inner.quaternion.copy(camera.quaternion);n.arc.quaternion.copy(camera.quaternion);n.ping.quaternion.copy(camera.quaternion);n.mark.quaternion.copy(camera.quaternion);n.glow.quaternion.copy(camera.quaternion);if(n.icon){n.icon.quaternion.copy(camera.quaternion);n.icon.material.uniforms.uTime.value=t;}
 n.body.material.color.set(0x0d1720).lerp(color,finished?.13:active?.2:.045);n.body.material.emissive.copy(color);n.body.material.emissiveIntensity=active?.055:finished?.03:0;n.rim.material.color.copy(color);n.rim.material.opacity=finished?.45:active?.57:.25;n.inner.material.color.copy(color);n.inner.material.opacity=.18;n.arc.visible=active&&n.id!=='root';n.arc.geometry.setDrawRange(0,Math.floor(n.arc.geometry.index.count*progress/6)*6);n.arc.rotation.z=-Math.PI/2;n.glow.material.color.copy(color);n.glow.material.opacity=active?.13:finished?.06:0;n.check.material.opacity=finished&&n.id!=='root'?.62:0;
const q=(t-n.done)/.65;n.ping.visible=q>=0&&q<1;n.ping.scale.setScalar(1+q*1.8);n.ping.material.opacity=(1-clamp(q))*.35;}
 for(const e of links){const grow=out((t-e.birth)/.7),active=t>=e.b.start&&t<e.b.done,finished=t>=e.b.done;e.mesh.visible=grow>0;e.mesh.geometry.setDrawRange(0,Math.floor(e.mesh.geometry.index.count*grow/6)*6);e.mesh.material.color.set(finished?0x467e68:active?0x9d8759:P.edge);e.mesh.material.opacity=finished?.28:active?.48:.19;for(let j=0;j<2;j++){const packet=e.packets[j];let p=(t-e.b.start)*1.6-j*.5;let visible=active&&p>=0;if(finished){p=(t-e.b.done)*1.8-j*.25;visible=p>=0&&p<=1;p=1-p;}else p=(p%1+1)%1;packet.visible=visible&&grow>.98;packet.position.copy(e.curve.getPoint(clamp(p)));packet.material.color.set(finished?P.done:P.active);packet.material.emissive.set(finished?P.done:P.active);}}
 animateTraveler(lead,t,visits);assistants.forEach((a,i)=>animateTraveler(a,t,helperRoutes[i],i?11.5:5.8));
 let cue=null;for(const c of thoughtCues)if(t>=c[0]&&t<c[1]+.2)cue=c;thought.visible=Boolean(cue);for(const group of Object.values(thoughts))for(const art of group)art.visible=false;if(cue){const[a,b,kind]=cue,alpha=fade(t,a,b,.16),cycle=(t-a)*2.52%1,hop=ease(cycle/.18)*(1-ease((cycle-.43)/.5));let frame=Math.floor(cycle*thoughts[kind].length);if(kind==='hammer')frame=cycle<.17?2:cycle<.34?3:cycle<.72?0:1;if(kind==='robot')frame=hop>.74?2:hop>.25?1:0;const art=thoughts[kind][frame];art.visible=true;art.material.uniforms.uTime.value=t;art.material.uniforms.uOpacity.value=alpha*.7;art.position.y=kind==='robot'?hop*.18:Math.sin(cycle*Math.PI*2)*.022;thought.quaternion.copy(camera.quaternion);thought.rotateY(-.22+Math.sin(t*.3)*.12);thought.position.copy(lead.group.position).add(V(t>27?1.55:.4,t>27?.45:1.02,.2).applyQuaternion(camera.quaternion));thought.scale.setScalar((kind==='robot'&&t>27?1.55:1.0)*(.92+.08*alpha));}
 for(const im of images){const p=fade(t,im.start,im.end,.2);im.group.visible=p>.001;im.group.position.copy(nodes.get(im.id).pos).add(V(2.05,.35,.9).applyQuaternion(camera.quaternion));im.group.quaternion.copy(camera.quaternion);im.group.rotateY(-.12+(1-p)*.25);im.group.scale.setScalar(.8+.2*p);im.border.material.transparent=true;im.border.material.opacity=p*.45;im.plane.material.opacity=p*.72;im.scan.material.opacity=p*.2;im.scan.position.x=-1.25+((t-im.start)*1.7%1)*2.5;}
 chips.forEach((m,i)=>{const active=fade(t,18.1,19.3,.2)+fade(t,24.7,25.8,.2);m.visible=active>.01;const id=t>23?'result':'c1',center=nodes.get(id).pos,a=t*2+i*.42,r=.38+rng(i)*.45;m.position.copy(center).add(V(Math.cos(a)*r,Math.sin(a)*r*.7,Math.sin(a*.7)*.25));m.quaternion.copy(camera.quaternion);m.rotateZ(a*.15);m.scale.setScalar(active);});
 composer.render();}
const marker=document.createElement('div');marker.style.cssText='position:absolute;left:0;top:0;width:2px;height:2px;z-index:9999';document.body.append(marker);
window.renderFrame=async t=>{update(t);const n=Math.round(t*30);marker.style.background=`rgb(${n&255},${16+(n>>8)},113)`;await new Promise(r=>requestAnimationFrame(r));composer.render();return{t,width:W,height:H};};window.__ready=true;window.__renderInfo={three:T.REVISION,direction:'Work in Motion — a travelling agent grows and completes tasks',silent:true};update(0);
if(new URLSearchParams(location.search).has('play')){const start=performance.now();renderer.setAnimationLoop(()=>update((performance.now()-start)/1000%30));}
