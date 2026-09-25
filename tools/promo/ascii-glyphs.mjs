import * as T from 'three';
const rand=i=>{const x=Math.sin(i*78.233+11.371)*43758.5453;return x-Math.floor(x);};
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

export {asciiArt,globe,thoughtFilms};
