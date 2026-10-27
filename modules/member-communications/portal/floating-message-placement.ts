/** Device-local launcher layout only. Never contains account or conversation data. */
export type LauncherPlacement={side:'left'|'right';vertical:number};
export type LauncherBounds={left:number;right:number;top:number;bottom:number};
export const LAUNCHER_PLACEMENT_KEY='freedom-message-launcher-position-v1';
export const DEFAULT_LAUNCHER_PLACEMENT:LauncherPlacement={side:'right',vertical:1};
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export function parseLauncherPlacement(raw:string|null):LauncherPlacement{
  try{
    const value:unknown=JSON.parse(raw??'null');
    if(value&&typeof value==='object'&&'side' in value&&'vertical' in value&&
      (value.side==='left'||value.side==='right')&&typeof value.vertical==='number'&&Number.isFinite(value.vertical)&&value.vertical>=0&&value.vertical<=1){
      return {side:value.side,vertical:value.vertical};
    }
  }catch{/* Missing, corrupt or blocked storage must not hide the launcher. */}
  return {...DEFAULT_LAUNCHER_PLACEMENT};
}
export function launcherBounds(viewport:{left:number;top:number;width:number;height:number},size:number,safe:{left:number;right:number;top:number;bottom:number},statusHeight=0):LauncherBounds{
  // Prefer safe-area margins, but keep the button reachable if zoom/keyboard
  // leaves too little room for all margins. A viewport smaller than the button
  // cannot contain it; in that case anchor at its visible origin.
  const maxX=viewport.left+Math.max(0,viewport.width-size),maxY=viewport.top+Math.max(0,viewport.height-size);
  const left=Math.min(maxX,viewport.left+Math.max(16,safe.left+8)),right=Math.max(left,maxX-Math.max(16,safe.right+8));
  const top=Math.min(maxY,viewport.top+Math.max(12,safe.top+8)+statusHeight),bottom=Math.max(top,maxY-16-safe.bottom);
  return {left,right,top,bottom};
}
export function launcherPoint(placement:LauncherPlacement,bounds:LauncherBounds){
  return {x:placement.side==='left'?bounds.left:bounds.right,y:bounds.top+placement.vertical*(bounds.bottom-bounds.top)};
}
export function snapLauncher(x:number,y:number,bounds:LauncherBounds):LauncherPlacement{
  return {side:x<(bounds.left+bounds.right)/2?'left':'right',vertical:bounds.bottom===bounds.top?1:clamp((y-bounds.top)/(bounds.bottom-bounds.top),0,1)};
}
export function launcherDragPoint(start:{x:number;y:number;pointerX:number;pointerY:number},pointer:{x:number;y:number},bounds:LauncherBounds){
  return {x:clamp(start.x+pointer.x-start.pointerX,bounds.left,bounds.right),y:clamp(start.y+pointer.y-start.pointerY,bounds.top,bounds.bottom)};
}
export function launcherDragStarted(start:{pointerX:number;pointerY:number},pointer:{x:number;y:number}){
  return Math.hypot(pointer.x-start.pointerX,pointer.y-start.pointerY)>=6;
}
