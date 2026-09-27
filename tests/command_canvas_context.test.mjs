import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../renderer/idle.js',import.meta.url),'utf8');
const a=source.indexOf('  const drawingContexts = new WeakMap();'),b=source.indexOf('  function armIdleTimer()',a);
assert.ok(a>=0&&b>a);
class Bitmap {
  constructor(width=300,height=150){this._width=width;this._height=height;this.resets=0;this.context={canvas:this,transforms:[],fills:[],setTransform(...v){this.transforms.push(v);},fillRect(...v){this.fills.push(v);}};}
  get width(){return this._width;}set width(v){this._width=v;this.resets++;}
  get height(){return this._height;}set height(v){this._height=v;this.resets++;}
  getContext(kind,options){assert.equal(kind,'2d');this.options=options;return this.context;}
}
function element(){const canvas=new Bitmap();canvas.style={};canvas.transfers=0;canvas.transferControlToOffscreen=()=>{canvas.transfers++;if(canvas.existing)throw Error('Context already acquired');return canvas.transferred=new Bitmap(canvas.width,canvas.height);};return canvas;}
function load(OffscreenCanvas=Bitmap){
  const el={},state={camMode:'free',labelWidths:new Map([['width',10]]),speechLineCache:new Map([['line',[]]])};
  const context=vm.createContext({window:{innerWidth:800,innerHeight:500,devicePixelRatio:1.25},document:{body:{dataset:{}}},el,state,OffscreenCanvas,autoFit:()=>{throw Error('No orbit refit expected');}});
  vm.runInContext(source.slice(a,b),context);return {context,el,state,create:context.createDrawingContext,resize:context.resize};
}
test('supported canvases transfer once and retain context options and identity',()=>{
  const env=load(),canvas=element(),options={alpha:true};
  const ctx=env.create(canvas,options);
  assert.equal(canvas.transfers,1);assert.equal(ctx.canvas,canvas.transferred);assert.equal(canvas.transferred.options,options);
  assert.equal(env.create(canvas,options),ctx);assert.equal(canvas.transfers,1);
});
test('unsupported 2D probes preserve the DOM canvas before any transfer',()=>{
  class Unsupported extends Bitmap {getContext(){return null;}}
  const env=load(Unsupported),canvas=element();assert.equal(env.create(canvas),canvas.context);assert.equal(canvas.transfers,0);
});
test('missing or throwing OffscreenCanvas capability falls back safely',()=>{
  for(const capability of [null,class {constructor(){throw Error('Unavailable');}}]){
    const env=load(capability),canvas=element();assert.equal(env.create(canvas),canvas.context);assert.equal(canvas.transfers,0);
  }
});
test('an existing host-acquired DOM context survives a refused transfer',()=>{
  const env=load(),canvas=element();canvas.existing=true;
  assert.equal(env.create(canvas),canvas.context);assert.equal(env.create(canvas),canvas.context);assert.equal(canvas.transfers,1);
});
test('missing optional canvases remain absent',()=>{const env=load();assert.equal(env.create(null),null);assert.equal(env.create({}),null);});
test('resize targets transferred bitmaps, preserves no-op pixels and follows DPR',()=>{
  const env=load(),near=element(),far=element();Object.assign(env.el,{canvas:near,ctx:env.create(near),far,farCtx:env.create(far,{alpha:true})});
  env.resize();
  for(const canvas of [near,far]){assert.equal(canvas.width,300);assert.equal(canvas.transferred.width,1000);assert.equal(canvas.transferred.height,625);assert.equal(canvas.style.width,'800px');assert.equal(canvas.style.height,'500px');assert.deepEqual(canvas.transferred.context.transforms.at(-1),[1.25,0,0,1.25,0,0]);}
  assert.equal(far.transferred.context.fills.length,1);assert.equal(env.state.labelWidths.size,0);assert.equal(env.state.speechLineCache.size,0);
  env.resize();assert.equal(near.transferred.resets,2);assert.equal(far.transferred.resets,2);assert.equal(far.transferred.context.fills.length,1);
  env.context.window.devicePixelRatio=2;env.context.window.innerWidth=600;env.resize();
  assert.equal(near.transferred.width,1200);assert.equal(near.transferred.height,1000);assert.equal(near.style.width,'600px');assert.deepEqual(near.transferred.context.transforms.at(-1),[2,0,0,2,0,0]);
});
test('ordinary contexts retain resize and transparent media-background behavior',()=>{
  const env=load(null),near=element(),far=element();Object.assign(env.el,{canvas:near,ctx:env.create(near),far,farCtx:env.create(far,{alpha:true})});env.context.document.body.dataset.mediaBackground='true';
  env.resize();assert.equal(near.width,1000);assert.equal(near.height,625);assert.equal(far.context.fills.length,0);env.resize();assert.equal(near.resets,2);
});
