/** CPU observations of production PHOTO geometry/draw paths. No GPU or pixels. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';
import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {bakeRigidGroup} from '../../../apps/portal-web/src/games/stage-batch.js';
import {createStampHandleGeometry} from '../../../apps/portal-web/src/games/stamp-tool.js';
import * as model from '../../../apps/portal-web/src/games/daily-scene-model.js';
import * as domain from '../../../apps/portal-web/src/games/domain.js';
import type {Stage,StageView} from '../../../apps/portal-web/src/games/stage.js';
export type PhotoBounds={left:number;right:number;top:number;bottom:number};
const bounds=(points:{x:number;y:number}[]):PhotoBounds=>points.reduce((b,p)=>({left:Math.min(b.left,p.x),right:Math.max(b.right,p.x),top:Math.min(b.top,p.y),bottom:Math.max(b.bottom,p.y)}),{left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity});
export function photoModelBounds(renderer:'native'|'light',width:number,height:number,view:StageView){
  let scene:T.Scene|undefined,camera:T.PerspectiveCamera|undefined,tracking=false;
  const points:{x:number;y:number}[]=[];
  const context=new Proxy({moveTo(x:number,y:number){if(tracking)points.push({x,y});},lineTo(x:number,y:number){if(tracking)points.push({x,y});}}, {get:(target,key)=>Reflect.get(target,key)??(()=>{}),set:(target,key,value)=>Reflect.set(target,key,value)});
  const canvas={width:0,height:0,style:{},setAttribute(){},addEventListener(){},removeEventListener(){},remove(){},getContext:()=>context};
  class Renderer{domElement=canvas;shadowMap={};info={render:{calls:0,triangles:0},memory:{geometries:0,textures:0}};setSize(){}setPixelRatio(){}dispose(){}forceContextLoss(){}render(s:T.Scene,c:T.PerspectiveCamera){scene=s;camera=c;}}
  const document={createElement:()=>({...canvas})},module={exports:{} as {createStage:(host:unknown,lost:()=>void)=>Stage;createDailyLightStage:(host:unknown)=>Stage}};
  const filename=renderer==='native'?'stage.ts':'daily-scene.tsx';
  const source=readFileSync(new URL(`../../../apps/portal-web/src/games/${filename}`,import.meta.url),'utf8');
  // Observe only the actual client. The foreground board remains in production
  // and in framing/scoring, but is deliberately not mistaken for the client.
  const instrumented=renderer==='light'?source.replace('human(v,client);','trackSubject(true);human(v,client);').replace("if(CLIENTS[v.client].id==='backdrop') {","trackSubject(false);if(CLIENTS[v.client].id==='backdrop') {"):source;
  if(renderer==='light'&&instrumented===source)throw Error('PHOTO subject observation point missing');
  runInNewContext(transformSync(instrumented,{loader:'tsx',format:'cjs'}).code,{
    module,exports:module.exports,document,window:{devicePixelRatio:1},trackSubject:(value:boolean)=>{tracking=value;},ResizeObserver:class{observe(){}disconnect(){}},
    require:(id:string)=>{if(id==='three')return {...T,WebGLRenderer:Renderer};if(id.includes('RoundedBox'))return {RoundedBoxGeometry};if(id.includes('BufferGeometryUtils'))return {mergeGeometries};if(id==='./stage-batch')return {bakeRigidGroup};if(id==='./stamp-tool')return {createStampHandleGeometry};if(id==='./daily-scene-model')return model;if(id==='./domain')return domain;throw Error(id);},
  });
  const host={clientWidth:width,clientHeight:height,append(){},getBoundingClientRect:()=>({left:0,top:0,width,height})};
  const stage=renderer==='native'?module.exports.createStage(host,()=>{}):module.exports.createDailyLightStage(host);
  try{
    stage.update(view);
    if(renderer==='native'){
      const world=scene!.children.find(o=>o instanceof T.Group)!;
      // Production builds studio, client, then optional foreground board.
      const client=world.children[1];
      if(!client||client.position.y!==domain.photoPose(domain.CLIENTS[view.client].id,view.seconds,view.seed).lift)throw Error('PHOTO client identity changed');
      client.traverse(o=>{if(!(o instanceof T.Mesh))return;for(let parent:T.Object3D|null=o;parent;parent=parent.parent)if(!parent.visible)return;const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++){
        const v=new T.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).project(camera!);
        points.push({x:(v.x+1)*width/2,y:(1-v.y)*height/2});
      }});
    }else{
      const scale=Math.min(1,1.5,960/width,720/height);
      // Light paths use the backing canvas, not the CSS viewport.
      for(const p of points){p.x*=width/Math.max(1,Math.round(width*scale));p.y*=height/Math.max(1,Math.round(height*scale));}
    }
    if(!points.length||points.some(p=>!Number.isFinite(p.x+p.y)))throw Error('Missing finite PHOTO subject vertices');
    return {bounds:bounds(points),points,vertices:points.length,framing:stage.framing()};
  }finally{stage.dispose();}
}
