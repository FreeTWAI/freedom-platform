import {Box3,BoxGeometry,Color,DirectionalLight,HemisphereLight,Mesh,MeshStandardMaterial,ACESFilmicToneMapping,PerspectiveCamera,PCFSoftShadowMap,Scene,WebGLRenderer} from 'three';
import {foodStudio} from './food-studio';
import type {MarketRun} from './market-domain';
import {foodTexture} from './food-kit';
import {createDishModel,type DishModel} from './dish-model';

export type DishStage={turn:(delta:number)=>void;reset:()=>void;zoom:(delta:number)=>void;capture:()=>string;stats:()=>{calls:number;triangles:number;geometries:number;textures:number};dispose:()=>void};
/** UX-8: one owned context and no idle animation loop. Catalog previews use this exact factory. */
export function createDishStage(host:HTMLElement,recipeId:string,onLost:()=>void,snapshot?:MarketRun):DishStage{
 const renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'}),scene=new Scene(),floorGeometry=new BoxGeometry(40,.2,40),floorTexture=foodTexture('wood'),floorMaterial=new MeshStandardMaterial({color:'#855b3b',map:floorTexture,roughness:1}),light=new DirectionalLight('#fff5e4',1.85);
 let disposed=false,model:DishModel|null=null,studio:ReturnType<typeof foodStudio>|undefined;
 const lost=(event:Event)=>{event.preventDefault();if(!disposed)onLost();};
 const dispose=()=>{if(disposed)return;disposed=true;renderer.domElement.removeEventListener('webglcontextlost',lost);model?.dispose();floorGeometry.dispose();floorMaterial.dispose();floorTexture.dispose();studio?.dispose();light.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();scene.clear();};
 try{
  renderer.setSize(640,480,false);renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=.85;renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFSoftShadowMap;renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.addEventListener('webglcontextlost',lost);host.append(renderer.domElement);
  studio=foodStudio(renderer,scene);floorTexture.repeat.set(5,5);scene.background=new Color('#d6b991');scene.add(new HemisphereLight('#fff9ee','#523723',.35));light.position.set(-4,8,5);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.5,far:25});light.shadow.normalBias=.04;light.shadow.radius=3;scene.add(light);
  const floor=new Mesh(floorGeometry,floorMaterial);floor.receiveShadow=true;scene.add(floor);model=createDishModel(recipeId,snapshot);scene.add(model.root);floor.position.y=new Box3().setFromObject(model.root).min.y-.1;
  const camera=new PerspectiveCamera(34,4/3,.1,40);camera.position.set(.25,7.5,7.9);camera.lookAt(0,.3,0);const fill=new DirectionalLight('#dbe7ff',.35);fill.position.set(4,3,-3);scene.add(fill);
  const render=()=>{if(!disposed)renderer.render(scene,camera);};const reset=()=>{if(model){model.root.rotation.y=-.12;camera.zoom=recipeId==='steak-dinner'?1.26:1.38;camera.updateProjectionMatrix();render();}};reset();
  return {turn:delta=>{if(!model||!Number.isFinite(delta)||disposed)return;model.root.rotation.y=(model.root.rotation.y+delta)%(Math.PI*2);render();},reset,zoom:delta=>{if(!Number.isFinite(delta)||disposed)return;camera.zoom=Math.max(.8,Math.min(1.7,camera.zoom+delta));camera.updateProjectionMatrix();render();},capture:()=>{if(disposed)throw Error('料理畫面已關閉');render();return renderer.domElement.toDataURL('image/png');},stats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),dispose};
 }catch(cause){dispose();throw cause;}
}
