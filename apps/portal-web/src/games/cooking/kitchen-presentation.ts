import {KITCHEN_VIEW as V} from './catalog';

/** Close-up is limited to the central cutting board; other tools retain clearance. */
export const kitchenWorkZoom=(kind:string,done=false)=>kind==='slice'&&!done?1.2:1;
export const kitchenInputPoint=(x:number,y:number,zoom:number)=>({x:.5+(x-.5)/zoom,y:.5+(y-.5)/zoom});
export const kitchenGuideViewBox=(zoom:number)=>`${400-400/zoom} ${280-280/zoom} ${800/zoom} ${560/zoom}`;

export type KitchenViewport={width:number;height:number;left:number;top:number;coreWidth:number;coreHeight:number};
/** Expand the view around the original interaction rectangle, never stretch it. */
export function kitchenPresentation(v:KitchenViewport,zoom=1){
 const values=Object.values(v);if(!values.every(Number.isFinite)||v.width<=0||v.height<=0||v.coreWidth<=0||v.coreHeight<=0||!Number.isFinite(zoom)||zoom<1||zoom>1.2)throw Error('Invalid kitchen viewport');
 const horizontal=9.3/zoom,vertical=6.51/zoom,left=-horizontal/2-horizontal*v.left/v.coreWidth,top=vertical/2+vertical*v.top/v.coreHeight;
 // Projection follows CSS, not the raster aspect ratio. Spend the existing
 // bounded buffer on both axes rather than discarding portrait width samples.
 return {left,right:left+horizontal*v.width/v.coreWidth,top,bottom:top-vertical*v.height/v.coreHeight,width:V.width,height:V.height};
}

/** A deliberate upward scoop starts on the pan, not a tap anywhere on stage. */
export const kitchenPanStart=(p:{x:number;y:number})=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=.2&&p.x<=.8&&p.y>=.25&&p.y<=.82;
export function kitchenPanStroke(from:{x:number;y:number},to:{x:number;y:number}){
 const rise=from.y-to.y;
 return kitchenPanStart(from)&&Number.isFinite(to.x)&&Number.isFinite(to.y)&&to.x>=.12&&to.x<=.88&&to.y>=.14&&to.y<=.88&&rise>=.12&&rise>Math.abs(to.x-from.x);
}
