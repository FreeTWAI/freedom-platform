/** One projection contract for the native camera, light scene and hit geometry.
 * The original 640×480 gameplay coordinates are never stretched or cropped.
 * A larger camera window reveals the set beyond that safe, HUD-free core. */
export const PARTY_CANONICAL={width:640,height:480} as const;
export const PARTY_MAX_PIXELS=640*480*1.5*1.5;
const finite=(n:number,fallback:number)=>Number.isFinite(n)?n:fallback;
export function partyViewport(width:number,height:number,top=0,bottom=0){
  const w=Math.max(1,finite(width,640)),h=Math.max(1,finite(height,480));
  const safeTop=Math.min(Math.max(0,finite(top,0)),Math.max(0,h-1));
  const safeBottom=Math.min(Math.max(0,finite(bottom,0)),Math.max(0,h-safeTop-1));
  const scale=Math.min(w/640,(h-safeTop-safeBottom)/480);
  const core={x:(w-640*scale)/2,y:safeTop+(h-safeTop-safeBottom-480*scale)/2,width:640*scale,height:480*scale};
  const viewBox={x:-core.x/scale,y:-core.y/scale,width:w/scale,height:h/scale};
  return {width:w,height:h,core,viewBox,view:{fullWidth:640,fullHeight:480,offsetX:viewBox.x,offsetY:viewBox.y,width:viewBox.width,height:viewBox.height}};
}
export function partyBufferSize(width:number,height:number,dpr:number){
  const w=Math.max(1,finite(width,640)),h=Math.max(1,finite(height,480));
  const ratio=Math.min(Math.max(.01,finite(dpr,1)),1.5,Math.sqrt(PARTY_MAX_PIXELS/(w*h)));
  const heightPx=Math.max(1,Math.min(PARTY_MAX_PIXELS,Math.floor(h*ratio)));
  return {width:Math.max(1,Math.min(Math.floor(w*ratio),Math.floor(PARTY_MAX_PIXELS/heightPx))),height:heightPx};
}
/** The caller restores live projection even when rendering/encoding throws. */
export function withPartyCaptureView<T>(enter:()=>void,capture:()=>T,restore:()=>void):T{
  try{enter();return capture();}finally{restore();}
}
