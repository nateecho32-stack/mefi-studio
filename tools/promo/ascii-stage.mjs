import * as T from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';

// A single photographed space: glyph sculptures, machined rings, optical traces.
// All thought diagrams are illustrative graphics, never private agent reasoning.
const W=innerWidth,H=innerHeight,scene=new T.Scene();
scene.background=new T.Color('#090d0e');scene.fog=new T.FogExp2('#090d0e',.033);
const camera=new T.PerspectiveCamera(39,W/H,.08,110);
const renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(1);renderer.setSize(W,H);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;document.body.prepend(renderer.domElement);
const pm=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pm.fromScene(room,.04).texture;room.dispose();scene.environmentIntensity=.65;
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));composer.addPass(new UnrealBloomPass(new T.Vector2(W,H),.115,.35,1.15));composer.addPass(new OutputPass());
// A horizonless atmosphere, with very slow light drift and a dithered gradient.
const atmosphere=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{uTime:{value:0},uAspect:{value:W/H}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}',fragmentShader:`varying vec2 vUv;uniform float uTime;uniform float uAspect;float field(vec2 p,vec2 c,vec2 s){vec2 d=(p-c)/s;return exp(-dot(d,d)*2.0);}float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 p=vUv;float drift=sin(uTime*.11)*.035;vec3 col=vec3(.0028,.005,.0075);col+=vec3(.009,.040,.034)*field(p,vec2(.79+drift,.58),vec2(.53,.8));col+=vec3(.012,.019,.034)*field(p,vec2(.14,.23),vec2(.64,.58));float ribbon=exp(-pow((p.y-.6-(p.x-.5)*.31-sin(p.x*3.+uTime*.06)*.04)/.20,2.0));col+=vec3(.002,.010,.008)*ribbon;float grain=(hash(gl_FragCoord.xy)-.5)*.0014;gl_FragColor=vec4(col+grain,1.0);}`}));atmosphere.renderOrder=-1000;atmosphere.frustumCulled=false;scene.add(atmosphere);
scene.add(new T.HemisphereLight(0xe9f1e7,0x172224,1.05));
for(const[c,p,i]of[[0xf9ffe9,[-4,10,5],4],[0x9effd9,[6,4,-8],4.5],[0x7390a1,[-9,1,-2],2]]){const l=new T.DirectionalLight(c,i);l.position.set(...p);scene.add(l);}
const clamp=x=>Math.min(1,Math.max(0,x)),smooth=x=>{x=clamp(x);return x*x*x*(x*(6*x-15)+10);},mix=T.MathUtils.lerp,v=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),rand=i=>{let x=Math.sin(i*78.233+11.371)*43758.5453;return x-Math.floor(x);};
const windowFade=(t,a,b,d=.65)=>smooth((t-a)/d)*(1-smooth((t-b)/d));
const FLOW_SPEED=.84; // Three packets per path = 2.52 responsive beats / second.
const world=new T.Group();scene.add(world);
const metal=new T.MeshPhysicalMaterial({color:0x59716c,metalness:.94,roughness:.26,clearcoat:.45});
const black=new T.MeshBasicMaterial({color:0x091212});
const trace=new T.MeshBasicMaterial({color:0xb4f9dc,toneMapped:false});
function torus(r,w,mat=metal,parent=world){const m=new T.Mesh(new T.TorusGeometry(r,w,8,128),mat);parent.add(m);return m;}
function textMesh(text,width,color='#b9d1c7',font=34){const c=document.createElement('canvas');c.width=1024;c.height=100;const x=c.getContext('2d');x.font=`${font}px Consolas,monospace`;x.fillStyle=color;x.textAlign='center';x.textBaseline='middle';x.fillText(text,512,50);const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;const m=new T.Mesh(new T.PlaneGeometry(width,width/10.24),new T.MeshBasicMaterial({map:tx,transparent:true,depthWrite:false,toneMapped:false}));return m;}

// One atlas keeps the hundreds of spatial glyphs sharp at every camera distance.
await document.fonts.load('40px Consolas');
const glyphs=Array.from({length:95},(_,i)=>String.fromCharCode(i+32)).join('');
const ac=document.createElement('canvas');ac.width=1024;ac.height=512;const ax=ac.getContext('2d');ax.font='44px Consolas,monospace';ax.textAlign='center';ax.textBaseline='middle';ax.fillStyle='#ffffff';
[...glyphs].forEach((g,i)=>ax.fillText(g,(i%16)*64+32,Math.floor(i/16)*64+33));
const atlas=new T.CanvasTexture(ac);atlas.minFilter=T.LinearMipmapLinearFilter;atlas.magFilter=T.LinearFilter;atlas.anisotropy=8;
const vertex=`attribute vec3 aPosition;attribute vec3 aTint;attribute float aGlyph;attribute float aSeed;attribute float aOrder;uniform float uTime;uniform float uReveal;uniform float uSphere;uniform float uSize;varying vec2 vUv;varying vec3 vTint;varying float vGlyph;varying float vAlpha;varying float vTone;void main(){vec3 p=aPosition;float phase=clamp((uReveal-aOrder)*6.0,0.0,1.0);p.y+=(1.0-phase)*.24;vec4 mv=modelViewMatrix*vec4(p,1.0);mv.xy+=position.xy*uSize;gl_Position=projectionMatrix*mv;vUv=uv;float scramble=step(phase,.85);vGlyph=mod(aGlyph+floor(uTime*11.0+aSeed*23.0)*scramble,95.0);vec3 normal=normalize(mat3(modelViewMatrix)*aPosition);float face=mix(1.0,smoothstep(-.2,.5,normal.z),uSphere);float shade=mix(1.0,.23+.77*max(0.,dot(normal,normalize(vec3(-.5,.7,.75)))),uSphere);vTint=aTint*shade;vAlpha=phase*face;vTone=.55+.45*sin(aSeed*20.0+uTime*.6);}`;
const fragment=`uniform sampler2D uAtlas;uniform vec3 uColor;uniform float uOpacity;varying vec2 vUv;varying vec3 vTint;varying float vGlyph;varying float vAlpha;varying float vTone;void main(){vec2 cell=vec2(mod(vGlyph,16.0),floor(vGlyph/16.0));vec2 uv=vec2((cell.x+vUv.x)/16.0,1.0-(cell.y+1.0-vUv.y)/8.0);float a=texture2D(uAtlas,uv).a*vAlpha*uOpacity;if(a<.015)discard;gl_FragColor=vec4(uColor*vTint*(.7+.3*vTone),a);}`;
function glyphField(items,{size=.12,sphere=false,color=0xe8f4e8}={}){const geo=new T.InstancedBufferGeometry();const plane=new T.PlaneGeometry(1,1);geo.index=plane.index;geo.attributes.position=plane.attributes.position;geo.attributes.uv=plane.attributes.uv;geo.setAttribute('aPosition',new T.InstancedBufferAttribute(new Float32Array(items.flatMap(e=>e.p)),3));geo.setAttribute('aTint',new T.InstancedBufferAttribute(new Float32Array(items.flatMap(e=>new T.Color(e.tint??0xffffff).toArray())),3));geo.setAttribute('aGlyph',new T.InstancedBufferAttribute(new Float32Array(items.map(e=>Math.max(0,glyphs.indexOf(e.c)))),1));geo.setAttribute('aSeed',new T.InstancedBufferAttribute(new Float32Array(items.map((_,i)=>rand(i+33))),1));geo.setAttribute('aOrder',new T.InstancedBufferAttribute(new Float32Array(items.map(e=>e.order||0)),1));geo.instanceCount=items.length;const mat=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:fragment,uniforms:{uAtlas:{value:atlas},uTime:{value:0},uReveal:{value:1.2},uSphere:{value:sphere?1:0},uSize:{value:size},uColor:{value:new T.Color(color)},uOpacity:{value:1}},transparent:true,depthWrite:false});const mesh=new T.Mesh(geo,mat);mesh.frustumCulled=false;return mesh;}
function globe(radius=.68,count=740){const items=[];for(let i=0;i<count;i++){const y=1-(i/(count-1))*2,r=Math.sqrt(1-y*y),theta=i*2.3999632297;items.push({p:[Math.cos(theta)*r*radius,y*radius,Math.sin(theta)*r*radius],c:'.:+*01'[Math.floor(rand(i+3)*6)],order:rand(i+70)*.72});}return glyphField(items,{size:.071,sphere:true});}
function asciiArt(lines,size=.125,color=0xc9e6d8,style=''){const cols=Math.max(...lines.map(s=>s.length)),items=[];lines.forEach((s,row)=>[...s].forEach((c,col)=>{if(c===' ')return;let tint=0xffffff,z=Math.sin(col*.16)*.055,thick=false;
 if(style==='boat'){tint=c==='~'?0x6ba6cd:row<3?0xf3dfb7:0x83d7be;if(row>=3&&col>cols*.57&&c==='\\')tint=0xe8b477;if(c==='='||c==='_')tint=0xb8f3d3;z=c==='~'?-.17:row<3?.12:.02;thick=row>=3&&row<=5&&c!=='~';}
 if(style==='hammer'){tint=c==='#'?0xaef4d1:c==='|'?0x579081:c==='/'&&row>3&&row<9?0xe4b780:c==='?'?0xbeaa82:0xd1e9da;z=c==='#'?.11:c==='|'?-.11:.02;thick=row<8&&['#','_','/','|'].includes(c);if(c==='*'||c==='+')tint=0xffe3a0;}
 if(style==='robot'){tint=row<2?0xebc083:c==='^'||c==='o'?0xffefc0:c==='#'?0x94edc5:row>6?0x618b8b:0xc7eade;z=row>1&&row<7?.09:-.035;thick=row>1&&row<7;}
 if(style==='rocket'){tint=(c==='('||c===')')?0xecc48e:row>5?0xe3b277:col>cols/2?0x68a193:0xc0f0d7;z=col>cols/2?-.08:.06;thick=row<6;}
 const p=[(col-cols/2)*size*.64,(lines.length/2-row)*size*1.04,z],order=row/lines.length*.68+col/cols*.1;
 if(thick)for(let layer=2;layer>=1;layer--)items.push({c:layer===2&&c==='#'?':':c,p:[p[0]+layer*.027,p[1]-layer*.018,p[2]-layer*.095],order,tint:layer===2?0x294a4a:0x47776a});
 items.push({c,p,order,tint});}));return glyphField(items,{size,color});}

// Nothing grounds the agents: no floor, horizon, platform or ground grid.

const definitions=[
 {name:'01 / AGENT BRAIN',pos:[-4.1,.1,1.1],art:['      o       ','     /|\\      ','    / | \\     ','   o  o  o    ','   | / \\ |    ','   o    o     ','    \\  /      ','     [#]      ']},
 {name:'02 / PROJECT MAP',pos:[-4.4,.15,-4.5],art:['      +------+','     /      /|','    +------+ |','    |  .-. | +','    |  |_| |/ ','    +------+  ','       |      ','    +--+--+   ']},
 {name:'03 / PLAYBOOK',pos:[.25,.55,-5.7],art:['    _______   ','   /______/|  ','  /______/||  ',' /______/|||  ',' |      |||/  ',' |  >>  ||/   ',' |______|/    ']},
 {name:'04 / BUILD + VERIFY',pos:[4.35,.25,-1.2],art:['    .----.    ','  .-+ ## +-.  ','  | `----\' |  ','  +-->[]<--+  ','       |      ','     \\ |      ','      \\|      ','       +      ']},
 {name:'05 / MODEL ROUTING',pos:[-2.3,-.15,5.15],art:['   >--.       ','      |       ','   >--+-->#   ','      |       ','   >--\'       ','   [OPENROUTER]']},
 {name:'06 / FLOATING MEDIA',pos:[3.2,-.05,4.9],art:['       |      ','    |  |      ','  | |  | |    ',' _|_|__|_|_|_ ','  | |  | |    ','    |  |      ','       |      ']}
];
// Small animated ASCII vignettes. Their silhouettes change, rather than merely
// cycling random characters: rowing, a swinging hammer, and a robot's jump.
const thoughtFilms={
 boat:[
 ['         o           ','        /|\\___       ','       / |    \\      ','   ___/==|=====\\___  ','   \\      \\       /  ','~~~~\\______\\_____/~~~','      ~     \\__  ~   '],
 ['         o           ','      __/|\\          ','     /   | \\         ','   _/====|==\\_____   ','   \\    /         /  ','~~~~\\__/_________/~~~','    __/      ~        '],
 ['         o           ','        /|\\          ','       / | \\___      ','   ___/==|=====\\___  ','   \\      |       /  ','~~~~\\_____|______/~~~','      ~   _|_    ~    '],
 ['         o           ','        /|\\___       ','       / |    \\      ','   ___/==|=====\\___  ','   \\       \\      /  ','~~~~\\_______\\____/~~~','    ~        _\\  ~   ']
 ],
 hammer:[
 ['        ______       ','       /#####/|      ','      /_____/ |      ','      |_____|/       ','         //          ','        //           ','       //            ','      //             ','   .-----------.     ','   |  ?  ?  ?  |     ','   \'-----------\'     '],
 ['                     ','          ______     ','         /#####/|    ','        /_____/ |    ','        |_____|/     ','          //         ','         //          ','        //           ','   .-----------.     ','   |  ?  ?  ?  |     ','   \'-----------\'     '],
 ['                     ','                     ','              *      ','         ______  +   ','        /#####/|     ','   *   /_____/ |     ','       |_____|/   *  ','        //  +        ','   .---//------.     ','   |  ? / ? /  |     ','   \'-----------\'     '],
 ['        ______       ','       /#####/|      ','      /_____/ |      ','      |_____|/       ','         //          ','        //     +     ','       //  *         ','      //             ','   .-----------.     ','   |    DONE   |     ','   \'-----------\'     ']
 ],
 robot:[
 ['        o        ','        |        ','     .-----.     ','     | ^ ^ |     ','     | \\_/ |     ','  .--\'-----\'--.  ','  |  [ ### ]  |  ','      |   |      ','     _|   |_     '],
 ['   \\    o    /   ','    \\   |   /    ','     .-----.     ','     | ^ ^ |     ','     | \\_/ |     ','     \'-----\'     ','     [ ### ]     ','      /   \\      ','    _/     \\_    '],
 ['    *   o   *    ','   \\    |    /   ','    \\.-----./    ','     | ^ ^ |     ','     | \\_/ |     ','     \'-----\'     ','     [ ### ]     ','      |   |      ','     _|   |_     ']
 ],
 rocket:[
 ['       /\\        ','      /  \\       ','     | () |      ','     |    |      ','    /|    |\\     ','   /_|____|_\\    ','      /\\/\\       ','       \\/        '],
 ['       /\\        ','      /  \\       ','     | () |      ','     |    |      ','    /|    |\\     ','   /_|____|_\\    ','      \\/\\/       ','      /\\/\\       ']
 ]
};
const thoughtKinds=['boat','rocket','robot','hammer','boat','robot'];
const nodes=definitions.map((d,i)=>{const group=new T.Group();world.add(group);const shell=new T.Group();group.add(shell);const core=new T.Mesh(new T.SphereGeometry(.625,40,28),black);shell.add(core);const glyph=globe();shell.add(glyph);const halo=torus(.86,.018,metal,shell),edge=torus(.86,.0045,trace,shell);edge.position.z=.024;const gimbal=torus(1.02,.01,metal,shell);gimbal.rotation.set(.95,.3,.25);const pivot=torus(.78,.007,new T.MeshBasicMaterial({color:0x548775}),shell);pivot.rotation.y=1.2;
 const name=textMesh(d.name,3.8,'#b7ccc1',30);group.add(name);name.position.y=-1.16;
 const thought=new T.Group();group.add(thought);const thoughtKind=thoughtKinds[i];const frames=thoughtFilms[thoughtKind].map(lines=>{const m=asciiArt(lines,.135,0xffffff,thoughtKind);thought.add(m);return m;});const art=frames[0];const thoughtName=textMesh(i===0?'FINDING A FLOW':i===1?'EXPLORING':i===2?'THAT WORKED!':i===3?'WORKING ON IT':i===4?'SAME DIRECTION':'IN THE GROOVE',2.5,'#729e8e',31);thoughtName.position.y=thoughtKind==='hammer'?.91:.75;thought.add(thoughtName);
 const stem=new T.Line(new T.BufferGeometry().setFromPoints([v(.25,.65,0),v(.6,1,.15),v(.8,1,.2)]),new T.LineBasicMaterial({color:0x799f8e,transparent:true,opacity:.45}));group.add(stem);
 return{...d,group,shell,core,glyph,halo,gimbal,pivot,name,thought,art,frames,thoughtKind,thoughtName,stem,target:v(...d.pos)};});

const hub=new T.Group();world.add(hub);const hubShell=new T.Group();hub.add(hubShell);
const hubMetal=new T.MeshPhysicalMaterial({color:0x8fbaab,metalness:1,roughness:.21,clearcoat:.8});
const hubRings=[torus(1.18,.038,hubMetal,hubShell),torus(1.06,.008,trace,hubShell),torus(1.3,.007,metal,hubShell)];
const hubDisc=new T.Mesh(new T.CircleGeometry(1.035,80),new T.MeshBasicMaterial({color:0x091512}));hubShell.add(hubDisc);
const hubLogo=asciiArt(['##    ##    +    ','###  ###    +    ','## ## ##  +++++  ','##    ##    +    ','##    ##    +    '],.19,0xd1ffdf);hubShell.add(hubLogo);hubLogo.position.z=.12;
const hubLabel=textMesh('M E F I  /  S T U D I O',4.1,'#b9ebd0',31);hubLabel.position.y=-1.55;hub.add(hubLabel);
const pillarGeo=new T.PlaneGeometry(2,15),pillarMat=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,uniforms:{uOpacity:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec2 vUv;uniform float uOpacity;void main(){float k=exp(-abs(vUv.x-.5)*20.0)*sin(vUv.y*3.14159);gl_FragColor=vec4(.66,1.,.84,k*uOpacity);}'});const pillar=new T.Mesh(pillarGeo,pillarMat);pillar.position.set(0,5.1,0);world.add(pillar);

const edges=[];function edge(from,to,index){const a=from.clone(),b=to.clone(),middle=a.clone().lerp(b,.5);middle.y+=.35;middle.z-=.15;const curve=new T.CatmullRomCurve3([a,middle,b]);const geo=new T.TubeGeometry(curve,120,.012,5,false);const mat=new T.MeshBasicMaterial({color:0x77c4a4,transparent:true,opacity:.65});const line=new T.Mesh(geo,mat);world.add(line);
const pulses=[];for(let j=0;j<3;j++){const p=new T.Group();const dot=new T.Mesh(new T.SphereGeometry(.037,10,8),trace);p.add(dot);const token=asciiArt([j%2?'>':'#'],.14);token.position.y=.14;p.add(token);world.add(p);pulses.push({p,token});}edges.push({curve,line,pulses,index});}
nodes.forEach((n,i)=>edge(n.target.clone().normalize().multiplyScalar(1.32),n.target,i));
for(const[a,b]of[[0,1],[1,2],[2,3],[3,5],[5,4],[4,0]])edge(nodes[a].target,nodes[b].target,edges.length);
// A perimeter graph grows from the six primary agents, all on the same plane.
const satellites=[];for(let i=0;i<18;i++){const parent=nodes[Math.floor(i/3)],angle=i*2.39996;const target=parent.target.clone().add(v(Math.cos(angle)*1.55,-.7+rand(i)*.8,Math.sin(angle)*1.6));const g=new T.Group();const ring=torus(.14,.014,metal,g);const dot=new T.Mesh(new T.SphereGeometry(.052,12,8),trace);g.add(dot);world.add(g);const curve=new T.CatmullRomCurve3([parent.target,parent.target.clone().lerp(target,.4).add(v(0,.2,0)),target]);const line=new T.Line(new T.BufferGeometry().setFromPoints(curve.getPoints(30)),new T.LineBasicMaterial({color:0x668f7a,transparent:true,opacity:.45}));world.add(line);satellites.push({g,line,target,ring,i});}

// Optical packets become legible characters as they approach their destination.
const exchanges=[];for(let i=0;i<46;i++){const token=asciiArt(['+-/>01*'[i%7]],.12,0xbcd7c6);world.add(token);exchanges.push(token);}
const poses=[
 [0,[-5.8,1.7,6.6],[-5.7,.6,1]],
 [3.3,[-5.6,2.0,7.2],[-5.5,.6,.5]],
 [6.5,[1.4,5.1,12.6],[0,.1,0]],
 [9.1,[1.7,4.6,12.3],[0,.1,0]],
 [12.2,[-6.4,2.9,7.3],[-3.3,.6,-.1]],
 [15.1,[-1.2,3.1,4.8],[-1,.65,-4.3]],
 [18.2,[7.3,3.0,6.7],[3.5,.5,-1.0]],
 [21.0,[9.8,8.2,15.1],[0,.25,.2]],
 [24.6,[4.7,13.4,19.0],[0,0,0]],
 [27.1,[1.1,7.1,18.5],[0,.2,0]],
 [30,[.1,6.8,18.5],[0,.2,0]]
];
function shot(t){let k=0;while(k<poses.length-2&&t>poses[k+1][0])k++;const a=poses[k],b=poses[k+1],u=smooth((t-a[0])/(b[0]-a[0]));camera.position.copy(v(...a[1])).lerp(v(...b[1]),u);const aim=v(...a[2]).lerp(v(...b[2]),u);camera.lookAt(aim);camera.rotateZ(Math.sin(t*.17)*.016);}
const cap=document.querySelector('.caption'),heading=cap.querySelector('h1'),kicker=cap.querySelector('.kicker'),detail=cap.querySelector('.detail'),link=cap.querySelector('.link'),phase=document.querySelector('.phase');
function caption(cls,title,small,body,url,opacity){cap.className='caption '+cls;heading.innerHTML=title;kicker.textContent=small;detail.innerHTML=body;link.textContent=url;cap.style.opacity=opacity;cap.style.transform=`translateY(${(1-opacity)*18}px)`;}

function update(t){shot(t);atmosphere.material.uniforms.uTime.value=t;const organize=smooth((t-6.3)/3.2),end=smooth((t-24.7)/2.0);world.position.x=end*4.6;world.rotation.y=end*-.15;
 nodes.forEach((n,i)=>{n.group.scale.setScalar(i===0?1:smooth((t-3.0-i*.08)/1.7));const motion=v(Math.sin(t*.61+i*2)*.26,Math.sin(t*.78+i)*.18,Math.cos(t*.7+i*2)*.28).multiplyScalar(1-organize);n.group.position.copy(n.target).add(motion);n.group.position.y+=Math.sin(t*.6+i)*.035;
 n.shell.rotation.set(.06*Math.sin(t*.13+i),t*.055+i*.65,Math.sin(t*.10+i)*.08);n.gimbal.rotation.z=t*.055+i*.6;n.pivot.rotation.x=t*.04;n.glyph.material.uniforms.uTime.value=t;n.glyph.material.uniforms.uReveal.value=1.3;n.glyph.material.uniforms.uColor.value.set(i===0?0xe7f7e5:0xb3dcca);
 const q=camera.quaternion.clone();n.name.quaternion.copy(q);n.name.material.opacity=(.75+organize*.25)*(1-end*.83);n.thought.quaternion.copy(q);n.thought.rotateY(-.23+Math.sin(t*.31+i)*.18);n.thought.rotateX(Math.sin(t*.23+i)*.07);n.thought.position.copy(v(i===0?-.62:.18,1.32,.6).applyQuaternion(q));
 let focus=.1;if(i===0)focus=windowFade(t,.1,3.0,.5)+windowFade(t,10.0,12.5,.6);if(i===1)focus=windowFade(t,12.1,14.15,.7);if(i===2)focus=windowFade(t,13.8,16.0,.65);if(i===3)focus=windowFade(t,16.2,19.0,.6);if(i===4)focus=windowFade(t,19.3,21.0,.5);if(i===5)focus=windowFade(t,20.0,22.0,.5);focus=Math.min(1,focus);
 // The phase wraps exactly when one of the three packets reaches this node.
 const presence=focus*(1-end),cycle=(t*FLOW_SPEED*3+i*.123*3)%1;
 const response=Math.exp(-cycle*12),hop=smooth(cycle/.18)*(1-smooth((cycle-.43)/.5));
 let frameIndex=Math.floor(cycle*n.frames.length);
 if(n.thoughtKind==='hammer')frameIndex=cycle<.17?2:cycle<.34?3:cycle<.72?0:1;
 if(n.thoughtKind==='robot')frameIndex=hop>.74?2:hop>.25?1:0;
 n.glyph.material.uniforms.uOpacity.value=.78+.22*response;
 n.shell.scale.setScalar(t>9.5?1+response*.014:1);
 n.frames.forEach((art,j)=>{art.visible=j===frameIndex;art.material.uniforms.uTime.value=t;art.material.uniforms.uReveal.value=1.25;art.material.uniforms.uOpacity.value=presence*(.86+.14*response);art.position.y=n.thoughtKind==='robot'?hop*.25:n.thoughtKind==='boat'?Math.sin(cycle*Math.PI*2)*.035:0;art.position.x=n.thoughtKind==='boat'?response*.045:0;art.rotation.z=n.thoughtKind==='boat'?Math.sin(cycle*Math.PI*2)*.025:0;});n.thoughtName.visible=false;n.stem.visible=false;n.thought.scale.setScalar(.9+focus*.2);
 });
 const arrive=smooth((t-6.1)/2.45);hub.visible=t>6;hub.position.y=mix(5.2,0,arrive);hub.scale.setScalar(mix(.12,1,arrive));hubShell.quaternion.copy(camera.quaternion);hubShell.rotateZ(Math.sin(t*.21)*.065);hubRings[2].rotation.set(.4,.3,t*.17);hubLogo.material.uniforms.uTime.value=t;hubLogo.material.uniforms.uReveal.value=arrive*1.25;hubLabel.quaternion.copy(camera.quaternion);hubLabel.material.opacity=arrive*(1-end);
 pillar.material.uniforms.uOpacity.value=windowFade(t,6.1,8.6,.8)*.55;pillar.quaternion.copy(camera.quaternion);
 edges.forEach((e,i)=>{const grow=smooth((t-(i<6?8.05+i*.19:10.0+(i-6)*.3))/1.4);e.line.visible=grow>.001;e.line.geometry.setDrawRange(0,Math.floor(e.line.geometry.index.count*grow/6)*6);e.line.material.opacity=(i<6?.56:.24)*(1-end*.42);e.pulses.forEach(({p,token},j)=>{p.visible=grow>.98;p.position.copy(e.curve.getPoint((t*FLOW_SPEED+j/3+i*.123)%1));token.quaternion.copy(camera.quaternion);token.material.uniforms.uTime.value=t;token.material.uniforms.uOpacity.value=.8*(1-end*.7);});});
 satellites.forEach(s=>{const a=smooth((t-18.7-s.i*.14)/1.4);s.g.position.copy(s.target);s.g.scale.setScalar(a);s.g.quaternion.copy(camera.quaternion);s.line.geometry.setDrawRange(0,Math.floor(31*a));s.line.visible=a>.01;s.line.material.opacity=.4*(1-end*.35);});
 exchanges.forEach((g,i)=>{const a=nodes[i%6].group.position,b=nodes[(i+1)%6].group.position,p=(t*.26+rand(i)*2)%1;g.position.copy(a).lerp(b,p);g.position.y+=Math.sin(p*Math.PI)*(.3+rand(i+10));g.quaternion.copy(camera.quaternion);g.material.uniforms.uTime.value=t;g.material.uniforms.uOpacity.value=(1-organize)*.42*windowFade(t,2.2,7,.8);});
 if(t<4.8)caption('','A thought is<br><strong>just the start.</strong>','01 / POTENTIAL','','',windowFade(t,.45,3.4,.7));
 else if(t<10)caption('lower','Give it a studio.','02 / CONNECTION','','',windowFade(t,7.35,9.05,.6));
 else if(t<14.0)caption('lower','Agents. In sync.','AGENT BRAIN / LIVE PIPELINES','','',windowFade(t,10.35,12.9,.6));
 else if(t<17.0)caption('lower','Patterns worth keeping.','PROJECT MAP / PLAYBOOK','','',windowFade(t,14.05,16.05,.6));
 else if(t<20)caption('lower','Build. Check. Move forward.','TASK HISTORY / REVIEW / VERIFICATION','','',windowFade(t,17.1,19.0,.6));
 else if(t<25.2)caption('lower','One connected workflow.','OPENROUTER / FLOATING MEDIA / YOUR TOOLS','','',windowFade(t,21.15,24.0,.75));
 else caption('end','Mefi’s<br>Studio AI+','THOUGHT / FORM','Your idea. A whole studio.<br><span style="font:15px Consolas;letter-spacing:1px;color:#81988c">FREE & OPEN SOURCE · WINDOWS</span>','nateecho32-stack.github.io/mefi-studio',smooth((t-25.45)/.8));
 phase.textContent=t<6?'01 — A THOUGHT':t<10?'02 — CONNECTION':t<20?'03 — IN MOTION':t<25?'04 — THE WHOLE PICTURE':'M+ — MAKE SOMETHING REAL';document.querySelector('.progress').style.width=(t/30*100)+'%';composer.render();}
const marker=document.createElement('div');marker.style.cssText='position:absolute;left:0;top:0;width:2px;height:2px;z-index:9999';document.body.append(marker);
window.renderFrame=async t=>{update(t);const n=Math.round(t*30);marker.style.background=`rgb(${n&255},${16+(n>>8)},113)`;await new Promise(r=>requestAnimationFrame(r));composer.render();return{t,width:W,height:H};};
window.__ready=true;window.__renderInfo={three:T.REVISION,direction:'Thought / Form — dimensional ASCII agents',silent:true};update(0);
if(new URLSearchParams(location.search).has('play')){const start=performance.now();renderer.setAnimationLoop(()=>update(((performance.now()-start)/1000)%30));}
