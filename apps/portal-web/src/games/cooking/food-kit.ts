import {BoxGeometry,CapsuleGeometry,CatmullRomCurve3,Color,CylinderGeometry,DataTexture,DoubleSide,ExtrudeGeometry,Group,LinearFilter,LinearMipmapLinearFilter,Mesh,MeshStandardMaterial,MeshPhysicalMaterial,RepeatWrapping,RGBAFormat,Shape,SphereGeometry,SRGBColorSpace,TorusGeometry,TubeGeometry,Vector3,type BufferGeometry,type Texture} from 'three';

import {foodTexture,foodRelief,type FoodSurface} from './food-surfaces';
export {foodTexture} from './food-surfaces';
import {cutletGeometry,wrapGeometry,leafGeometry,cornDogGeometry,paperTrayGeometry,ceramicPlateGeometry,ironPlatterGeometry,ironEarGeometry,servingBoardGeometry} from './food-geometry';

export class FoodKit{
 readonly geometries=new Set<BufferGeometry>();readonly materials=new Map<string,MeshStandardMaterial>();readonly textures=new Set<Texture>();
 readonly sphere=this.own(new SphereGeometry(1,16,10));readonly cylinder=this.own(new CylinderGeometry(1,1,1,32));readonly box=this.own(new BoxGeometry(1,1,1));readonly capsule=this.own(new CapsuleGeometry(.3,1.7,6,16));readonly ring=this.own(new TorusGeometry(1,.045,8,48));readonly cutlet=this.own(cutletGeometry());readonly wrap=this.own(wrapGeometry());readonly leaf=this.own(leafGeometry());readonly steakGeometry:ExtrudeGeometry;
 readonly cornDog=this.own(cornDogGeometry());readonly paperTray=this.own(paperTrayGeometry());
 readonly ceramicPlate=this.own(ceramicPlateGeometry());readonly ironPlatter=this.own(ironPlatterGeometry());readonly ironEar=this.own(ironEarGeometry());readonly servingBoard=this.own(servingBoardGeometry());
 readonly maps:Record<FoodSurface,DataTexture>;readonly relief=new Map<FoodSurface,ReturnType<typeof foodRelief>>();
 constructor(){this.maps={food:foodTexture('food'),meat:foodTexture('meat'),bread:foodTexture('bread'),wood:foodTexture('wood'),sear:foodTexture('sear'),batter:foodTexture('batter'),rice:foodTexture('rice'),paper:foodTexture('paper')};Object.values(this.maps).forEach(t=>this.textures.add(t));const shape=new Shape();shape.moveTo(-1.05,-.7);shape.bezierCurveTo(-1.6,-.45,-1.3,.65,-.7,.85);shape.bezierCurveTo(-.1,1.1,.42,.72,.94,.88);shape.bezierCurveTo(1.65,.8,1.4,-.23,.82,-.5);shape.bezierCurveTo(.05,-.58,-.3,-1.1,-1.05,-.7);this.steakGeometry=this.own(new ExtrudeGeometry(shape,{depth:.3,bevelEnabled:true,bevelThickness:.1,bevelSize:.09,bevelSegments:3,steps:1,curveSegments:18}));}
 own<T extends BufferGeometry>(g:T):T{this.geometries.add(g);return g;}
 mat(color:string,kind:FoodSurface|'plain'|'metal'|'iron'|'sauce'|'ceramic'|'oil'='food'){
  const key=color+'/'+kind;let material=this.materials.get(key);
  if(!material){
   let detail:ReturnType<typeof foodRelief>|undefined;
   if(kind in this.maps||kind==='iron'){const surface=kind==='iron'?'food':kind as FoodSurface;detail=this.relief.get(surface);if(!detail){detail=foodRelief(surface);this.relief.set(surface,detail);this.textures.add(detail.height);this.textures.add(detail.roughness);}}
   // UX-12: broad moving reflections belong to wet surfaces, never glitter particles.
   const roughness=kind==='sauce'?.23:kind==='oil'?.16:kind==='ceramic'?.2:kind==='iron'?.65:kind==='metal'?.25:kind==='meat'?.68:kind==='sear'?.68:kind==='batter'?.7:kind==='rice'?.85:kind==='food'?.68:kind==='plain'?.72:1;
   const clearcoat=kind==='sauce'?.8:kind==='oil'?.85:kind==='ceramic'?.8:kind==='iron'?.12:kind==='meat'?.4:kind==='sear'?.3:kind==='batter'?.65:kind==='rice'?.14:kind==='food'?.25:0;
   material=new MeshPhysicalMaterial({color,roughness,metalness:kind==='metal'?.9:kind==='iron'?.6:0,side:DoubleSide,clearcoat,clearcoatRoughness:kind==='oil'?.12:kind==='sauce'?.16:kind==='ceramic'?.18:kind==='batter'?.2:.3,...(detail?{...(kind!=='iron'?{map:this.maps[kind as FoodSurface]}:{}),bumpMap:detail.height,roughnessMap:detail.roughness,bumpScale:kind==='wood'?.004:kind==='batter'?.005:kind==='paper'?.003:kind==='iron'?.003:.004}:{})});
   this.materials.set(key,material);
  }
  return material;
 }

 mesh(parent:Group,g:BufferGeometry,color:string,x:number,y:number,z:number,sx=1,sy=sx,sz=sx,kind:Parameters<FoodKit['mat']>[1]='food'){
  const mesh=new Mesh(g,this.mat(color,kind));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
 }
 ball(p:Group,c:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx){return this.mesh(p,this.sphere,c,x,y,z,sx,sy,sz);}
 disk(p:Group,c:string,x:number,y:number,z:number,r:number,h:number,rz=r,kind:Parameters<FoodKit['mat']>[1]='food'){return this.mesh(p,this.cylinder,c,x,y,z,r,h,rz,kind);}
 block(p:Group,c:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,kind:Parameters<FoodKit['mat']>[1]='food'){return this.mesh(p,this.box,c,x,y,z,sx,sy,sz,kind);}
 curve(p:Group,c:string,points:Vector3[],radius=.035){const g=new TubeGeometry(new CatmullRomCurve3(points),Math.min(80,points.length*6),radius,6,false),mesh=new Mesh(g,this.mat(c,'sauce'));mesh.castShadow=true;p.add(mesh);return g;}
 dispose(){this.geometries.forEach(g=>g.dispose());this.materials.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());this.geometries.clear();this.materials.clear();this.textures.clear();}
}
export function cookedColor(raw:string,cooked:number){const color=new Color(raw);color.lerp(new Color('#ae622b'),Math.min(1,cooked)*.85);color.lerp(new Color('#25190e'),Math.max(0,cooked-.85)*1.4);return '#'+color.getHexString();}
