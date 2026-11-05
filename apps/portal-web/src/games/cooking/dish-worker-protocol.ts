import {recipeOf} from './catalog';
import {parseMarket,type MarketRun} from './market-domain';

export type DishStats={calls:number;triangles:number;geometries:number;textures:number};
export type DishInit={version:1;kind:'init';owner:number;canvas:OffscreenCanvas;recipe:string;pixelRatio:number;snapshot?:MarketRun};
export type DishView={version:1;kind:'view';owner:number;sequence:number;angle:number;zoom:number};
export type DishReply={version:1;kind:'ready'|'rendered';owner:number;sequence:number;stats:DishStats}|{version:1;kind:'failed';owner:number};
const object=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x:Record<string,unknown>,allowed:string[])=>Object.keys(x).every(k=>allowed.includes(k));
const integer=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const range=(x:unknown,min:number,max:number):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
export function parseDishInit(value:unknown):DishInit|null{
 if(!object(value)||!keys(value,['version','kind','owner','canvas','recipe','pixelRatio','snapshot'])||value.version!==1||value.kind!=='init'||!integer(value.owner)||!range(value.pixelRatio,.5,1.5)||typeof value.recipe!=='string'||!recipeOf(value.recipe))return null;
 if(typeof OffscreenCanvas==='undefined'||!(value.canvas instanceof OffscreenCanvas))return null;
 const snapshot=value.snapshot===undefined?undefined:parseMarket(value.snapshot);
 if(snapshot===null||snapshot&&snapshot.recipe!==value.recipe)return null;
 return {version:1,kind:'init',owner:value.owner as number,canvas:value.canvas,recipe:value.recipe,pixelRatio:value.pixelRatio,...(snapshot?{snapshot}:{})};
}
export function parseDishView(value:unknown,owner:number,previous:number):DishView|null{
 if(!object(value)||!keys(value,['version','kind','owner','sequence','angle','zoom'])||value.version!==1||value.kind!=='view'||value.owner!==owner||!integer(value.sequence)||(value.sequence as number)<=previous||!range(value.angle,-Math.PI*2,Math.PI*2)||!range(value.zoom,.8,1.7))return null;
 return value as DishView;
}
export function parseDishReply(value:unknown,owner:number):DishReply|null{
 if(!object(value)||value.version!==1||value.owner!==owner)return null;
 if(value.kind==='failed')return keys(value,['version','kind','owner'])?value as DishReply:null;
 const stats=value.stats;
 if(!['ready','rendered'].includes(value.kind as string)||!keys(value,['version','kind','owner','sequence','stats'])||!integer(value.sequence)||!object(stats)||!keys(stats,['calls','triangles','geometries','textures'])||!['calls','triangles','geometries','textures'].every(k=>integer(stats[k])))return null;
 return value as DishReply;
}
/** Coalesce absolute view state, never deltas: zoom clamp and reset ordering remain exact. */
export function nextDishView(view:{angle:number;zoom:number},kind:'turn'|'zoom'|'reset',delta:number,recipe:string){
 if(kind==='reset')return {angle:-.12,zoom:recipe==='steak-dinner'?1.26:1.38};
 if(!Number.isFinite(delta))return view;
 return kind==='turn'?{...view,angle:(view.angle+delta)%(Math.PI*2)}:{...view,zoom:Math.max(.8,Math.min(1.7,view.zoom+delta))};
}
