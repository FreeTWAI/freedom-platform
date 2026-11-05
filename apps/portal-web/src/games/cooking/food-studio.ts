import {Color,Mesh,MeshBasicMaterial,PlaneGeometry,PMREMGenerator, type Scene, type WebGLRenderer, type WebGLRenderTarget} from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

/** UX-12: original broad softboxes, baked once per owned renderer. No remote HDR or idle loop. */
export function foodStudio(renderer: WebGLRenderer, scene: Scene) {
 const room = new RoomEnvironment(), generator = new PMREMGenerator(renderer);
 let target: WebGLRenderTarget | undefined;
 try {
  // RoomEnvironment is offset by -3.5 on Y. Aim local panels at the food's world origin.
  const softbox=(w:number,h:number,x:number,y:number,z:number,power:number)=>{
   const panel=new Mesh(new PlaneGeometry(w,h),new MeshBasicMaterial({color:new Color().setRGB(power,power*.97,power*.91)}));
   panel.position.set(x,y,z);panel.lookAt(0,3.5,0);room.add(panel);
  };
  softbox(6,3,-3,8.5,4,7);
  softbox(1.4,5,4,6.5,-1,4);
  target = generator.fromScene(room, .035, .1, 80);
  scene.environment = target.texture;
  scene.environmentIntensity = .65;
 } finally {
  // The addon's disposal traverses and owns our added panel geometry/materials too.
  room.dispose();
  generator.dispose();
 }
 let disposed = false;
 return {dispose() {
  if (disposed) return;
  disposed = true;
  scene.environment = null;
  target?.dispose();
 }};
}
