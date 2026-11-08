import {CircleGeometry,CylinderGeometry,Group,Mesh,MeshStandardMaterial,SphereGeometry,DoubleSide,type BufferGeometry} from 'three';
import {bakeRigidGroup} from '../stage-batch';

export const VOLUMETRIC_PREPARATION_IDS = ['potato','pumpkin','sweet-potato','mushroom'] as const;
export type PreparationId = typeof VOLUMETRIC_PREPARATION_IDS[number];
export function isVolumetricPreparation(id:string):id is PreparationId {
 return (VOLUMETRIC_PREPARATION_IDS as readonly string[]).includes(id);
}
/** Original, texture-free solids. The caller owns every raw and batched resource.
 * Templates are built once per step, then cloned with shared geometry/materials.
 * Nothing in this renderer advances or invents a cut. */
export function createPreparationModel(id:PreparationId,owned:Set<BufferGeometry>,materials:Map<string,MeshStandardMaterial>) {
 const own=<G extends BufferGeometry>(g:G)=>{owned.add(g);return g;};
 const sphere=own(new SphereGeometry(1,24,16));
 const lower=own(new SphereGeometry(1,24,12,0,Math.PI*2,Math.PI/2,Math.PI/2));
 const face=own(new CircleGeometry(1,32));face.rotateX(-Math.PI/2);
 const cylinder=own(new CylinderGeometry(1,1,1,20));
 const cap=own(new SphereGeometry(1,24,12,0,Math.PI*2,0,Math.PI/2));
 const skin=id==='potato'?'#b98b50':id==='pumpkin'?'#d9762b':id==='sweet-potato'?'#9d4d50':'#a77c57';
 const flesh=id==='potato'?'#f4dfa4':id==='pumpkin'?'#f5b544':id==='sweet-potato'?'#f0c15e':'#f2e2c8';
 const detail=id==='pumpkin'?'#76563d':id==='mushroom'?'#76523b':'#815a3b';
 const accent=id==='pumpkin'?'#eee0a8':id==='mushroom'?'#d2b58d':skin;
 const material=(color:string)=>{let m=materials.get(color);if(!m){m=new MeshStandardMaterial({color,roughness:.74,side:DoubleSide});materials.set(color,m);}return m;};
 const part=(parent:Group,g:BufferGeometry,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{const mesh=new Mesh(g,material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;};
 const whole=new Group(),cut=new Group();whole.name='preparation/whole';cut.name='preparation/cut';
 // An organic closed surface, rather than layers extruded off a drawing.
 const body=own(sphere.clone()),positions=body.getAttribute('position');
 for(let i=0;i<positions.count;i++){
  const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),angle=Math.atan2(z,x);
  const radial=id==='pumpkin'?1+.09*Math.cos(angle*8)*(1-y*y):id==='sweet-potato'?1+.06*Math.sin(y*4+angle*2):1+.045*Math.sin(x*5+z*3)*Math.cos(y*4);
  positions.setXYZ(i,x*radial,y,z*radial);
 }
 body.computeVertexNormals();body.computeBoundingBox();body.computeBoundingSphere();
 if(id==='mushroom'){
  part(whole,cylinder,flesh,0,.18,0,.09,.28,.09);
  part(whole,cap,skin,0,.3,0,.3,.21,.27);
  part(whole,face,detail,0,.299,0,.27,1,.24).rotation.z=Math.PI;
  for(const side of [-1,1]){
   part(cut,lower,skin,side*.18,.19,0,.17,.16,.24);
   part(cut,face,flesh,side*.18,.191,0,.16,1,.23);
   part(cut,cylinder,flesh,side*.18,.1,.29,.065,.3,.065).rotation.x=Math.PI/2;
   // Raised, radial gills are geometry and remain visible from an oblique view.
   for(let n=0;n<4;n++){const rib=part(cut,cylinder,detail,side*.18+(n-1.5)*.05,.195,.08,.008,.18,.008);rib.rotation.x=Math.PI/2;rib.rotation.z=(n-1.5)*.16;}
  }
 }else{
  const sx=id==='sweet-potato'?.19:.29,sy=id==='pumpkin'?.27:.22,sz=id==='sweet-potato'?.42:.25;
  const solid=part(whole,body,skin,0,sy+.025,0,sx,sy,sz);if(id==='sweet-potato')solid.rotation.y=-.23;
  if(id==='pumpkin'){
   const stem=part(whole,cylinder,detail,0,.59,0,.045,.16,.05);stem.rotation.z=-.2;
  }else{
   for(const [x,z] of [[-.12,-.08],[.09,.1],[-.04,.17]])part(whole,sphere,detail,x,.22+Math.sqrt(Math.max(0,1-(x/sx)**2-(z/sz)**2))*.2,z,.018,.008,.025);
  }
  for(const side of [-1,1]){
   const x=side*.18;
   part(cut,lower,skin,x,.19,0,.165,.16,sz);
   part(cut,face,flesh,x,.192,0,.15,1,sz*.94);
   if(id==='pumpkin'){
    part(cut,face,detail,x,.194,0,.075,1,.15);
    for(let n=0;n<3;n++){const seed=part(cut,sphere,accent,x+(n%2?-.025:.025),.203,(n-1)*.075,.019,.012,.035);seed.rotation.y=(n-1)*.4;}
   }
  }
 }
 bakeRigidGroup(whole,owned);bakeRigidGroup(cut,owned);cut.visible=false;
 return {whole,cut};
}
