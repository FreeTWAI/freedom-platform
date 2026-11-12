import {ACESFilmicToneMapping,Box3,Color,DirectionalLight,Group,HemisphereLight,InstancedMesh,Mesh,Object3D,PerspectiveCamera,PCFSoftShadowMap,Plane,Raycaster,Scene,Vector2,Vector3,WebGLRenderer,type Intersection} from 'three';
import {foodStudio} from './food-studio';
import {bakeRigidGroup} from '../stage-batch';
import {FoodKit,cookedColor} from './food-kit';
import {marketFood} from './market-food';
import {createCornDogStall} from './corn-dog-stall';
import {cornDogPresentation} from './corn-dog-presentation';
import {shawarmaPresentation} from './shawarma-presentation';
import type {MarketRun} from './market-domain';

export type MarketStage={hit:(point:{x:number;y:number})=>{point:{x:number;y:number};index:number|null}|null;update:(run:MarketRun)=>void;capture:()=>string;stats:()=>{calls:number;triangles:number;geometries:number;textures:number};dispose:()=>void};
/** Batched toppings retain ownership on every vertex of the hit triangle. */
export function marketHitPortion(hit:Intersection<Object3D>,root:Object3D):number|null{
 const attribute=hit.object instanceof Mesh?hit.object.geometry.getAttribute('marketPortion'):undefined,face=hit.face;
 if(attribute?.itemSize===1&&face&&[face.a,face.b,face.c].every(i=>Number.isInteger(i)&&i>=0&&i<attribute.count)){
  const index=attribute.getX(face.a);
  if(Number.isInteger(index)&&index>=0&&index<16&&attribute.getX(face.b)===index&&attribute.getX(face.c)===index)return index;
 }
 for(let node:Object3D|null=hit.object;node&&node!==root;node=node.parent)if(typeof node.userData.portion==='number')return node.userData.portion;
 return null;
}
/** Level, centered camera. Narrow viewports expand vertically, never crop the worktop. */
export function marketFrontCamera(width:number,height:number){
 const aspect=width>0&&height>0&&Number.isFinite(width/height)?width/height:6/5;
 const fov=2*Math.atan(Math.tan(19*Math.PI/180)*Math.max(1,(6/5)/aspect))*180/Math.PI;
 const camera=new PerspectiveCamera(fov,aspect,.1,45);
 camera.position.set(0,1.2,8.4);camera.lookAt(0,1.2,0);camera.updateMatrixWorld();return camera;
}
/** Only the working surface tilts; the stall and its upright spit face the viewer. */
export function createMarketWorktop(){const root=new Group();root.rotation.x=Math.PI/5;root.position.y=1.2;root.updateMatrixWorld();return root;}

/** UX-9: close-up worktop; bounded geometry, shared materials, explicit scene ownership. */
export function createMarketStage(host:HTMLElement,onLost:()=>void):MarketStage{
 const renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'}),scene=new Scene(),kit=new FoodKit(),work=new Group(),foodRoot=new Group(),spit=new Group(),light=new DirectionalLight('#fff5e4',2.4);
 let resizeObserver:ResizeObserver|undefined,resizeView:(()=>void)|undefined;
 let studio:ReturnType<typeof foodStudio>|undefined,motion:MediaQueryList|undefined,refreshMotion:(()=>void)|undefined;
 let disposed=false,food:ReturnType<typeof marketFood>|null=null,fingerprint='',recipe='',snapshot:MarketRun|null=null,tossAt=-Infinity,foodMinY=0;
 const lost=(e:Event)=>{e.preventDefault();if(!disposed)onLost();};
 const dispose=()=>{if(disposed)return;disposed=true;resizeObserver?.disconnect();if(resizeView)window.removeEventListener('resize',resizeView);if(refreshMotion)motion?.removeEventListener('change',refreshMotion);renderer.domElement.removeEventListener('webglcontextlost',lost);food?.dispose();kit.dispose();studio?.dispose();light.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();scene.clear();};
 try{
  renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=.92;renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=PCFSoftShadowMap;renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.addEventListener('webglcontextlost',lost);host.append(renderer.domElement);
  studio=foodStudio(renderer,scene);scene.background=new Color('#203b3a');scene.add(new HemisphereLight('#fff8ed','#4c3021',.65));light.position.set(-3,8,4);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:25});light.shadow.normalBias=.03;scene.add(light);
  // A built, front-facing chef's counter, not a floating plate against an empty sky.
  // Every architectural detail is static and batched before the first frame.
  kit.block(work,'#553c2d',0,-1.7,0,14,1.8,8,'wood');
  kit.block(work,'#c9b89a',0,-.76,0,14,.1,8,'plain');
  kit.block(work,'#927553',0,-.85,4,14,.24,.13,'wood');
  // Deep glazed tile wall, inset brass rails and warm timber reveals.
  kit.block(work,'#142e2e',0,3,-4.4,14,7,.3,'plain');
  for(let row=0;row<8;row++)for(let col=-8;col<=8;col++){
   const x=col*.88+(row%2)*.44,y=.35+row*.64;
   kit.block(work,(row+col)%3===0?'#31534e':'#274741',x,y,-4.18,.85,.61,.06,'ceramic');
  }
  for(const x of [-4.8,4.8])kit.block(work,'#856344',x,2.5,-4.04,.22,5.4,.24,'wood');
  kit.block(work,'#ba9158',0,3.9,-3.97,10,.035,.035,'metal');
  kit.block(work,'#614632',0,2.82,-3.92,9.6,.14,.65,'wood');
  // Identifiable ceramic mise-en-place jars stay peripheral to the food/hit plane.
  for(const [i,x] of [-3.65,-2.95,2.95,3.65].entries()){
   kit.disk(work,i%2?'#d4c4a2':'#53756d',x,3.12,-3.88,.23,.47,.23,'ceramic');
   kit.disk(work,'#a38155',x,3.38,-3.88,.25,.07,.25,'wood');
   kit.block(work,'#eee0bd',x,3.12,-3.64,.23,.16,.015,'paper');
  }
  // Rolled metal prep bowls and a folded towel anchor the side work zones.
  for(const x of [-3.35,3.35]){
   kit.disk(work,'#88938c',x,-.02,-1.1,.43,.27,.43,'metal');
   kit.disk(work,'#263b33',x,.12,-1.1,.37,.025,.37,'plain');
   kit.mesh(work,kit.ring,'#c6cdc1',x,.14,-1.1,.42,.42,.42,'metal').rotation.x=-Math.PI/2;
  }
  kit.block(work,'#e4d8bb',-3.35,-.13,.5,1.05,.08,1.5,'paper');
  for(const x of [-3.7,-3.6])kit.block(work,'#3f645b',x,-.083,.5,.035,.008,1.5,'plain');
  for(const [i,c]of ['#a34527','#c29a36','#e0cf9e'].entries()){
   kit.disk(work,c,3.3,-.01,.5+i*.48,.15,.44,.15,'plain');
   kit.disk(work,'#e6dcc4',3.3,.25,.5+i*.48,.075,.14,.075,'plain');
  }
  bakeRigidGroup(work,kit.geometries);const worktop=createMarketWorktop();scene.add(work,worktop,spit);spit.position.set(0,1.2,-1);worktop.add(foodRoot);
  // The display slab uses the same local surface as the food. Its top is exactly
  // the settled plate's -.225 plane: no floating dish or camera-only fake shadow.
  const deck=new Group();worktop.add(deck);
  kit.block(deck,'#a18a69',0,-.5,0,6.8,.55,5.4,'wood');
  kit.block(deck,'#d1c2a6',0,-.245,0,6.75,.04,5.35,'plain');
  for(const x of [-3.2,3.2])kit.block(deck,'#856b47',x,-.34,0,.05,.15,5.36,'wood');
  bakeRigidGroup(deck,kit.geometries);
  const camera=marketFrontCamera(768,640);const fill=new DirectionalLight('#dbe7ff',.7);fill.position.set(5,3,-3);scene.add(fill);
  const cooker=new Group();worktop.add(cooker);
  let cornDogStall:ReturnType<typeof createCornDogStall>|null=null,spitMaterial:ReturnType<FoodKit['mat']>|null=null;
  const ray=new Raycaster(),ndc=new Vector2(),plane=new Plane(new Vector3(0,1,0),-.5).applyMatrix4(worktop.matrixWorld),intersection=new Vector3();
  const hit=(point:{x:number;y:number})=>{
   if(disposed||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
   const box=host.getBoundingClientRect();if(!box.width||!box.height)return null;
   const x=point.x,y=point.y;if(x<0||x>1||y<0||y>1)return null;
   ndc.set(x*2-1,1-y*2);ray.setFromCamera(ndc,camera);const closest=ray.intersectObjects(foodRoot.children,true)[0];let index:number|null=null,location:Vector3;
   if(closest){location=closest.point;index=marketHitPortion(closest,foodRoot);}
   else{if(!ray.ray.intersectPlane(plane,intersection))return null;location=intersection;}
   const local=worktop.worldToLocal(location.clone()),px=local.x/3.4+.5,py=local.z/2.5+.5;if(px<0||px>1||py<0||py>1)return null;return {index,point:{x:px,y:py}};
  };
  const bubbleMaterial=kit.mat('#ead18a','plain');bubbleMaterial.transparent=true;bubbleMaterial.opacity=.48;
  const bubbles=new InstancedMesh(kit.ring,bubbleMaterial,24),bubblePose=new Object3D();motion=matchMedia('(prefers-reduced-motion: reduce)');worktop.add(bubbles);bubbles.visible=false;
  function setup(r:MarketRun){cooker.clear();spit.clear();cornDogStall=null;recipe=r.recipe;
   if(r.recipe==='egg-fried-rice'||r.recipe==='steak-dinner'){
    kit.block(cooker,'#49362b',0,-.08,.1,5.55,.25,4.6,'wood');kit.disk(cooker,'#252927',0,.03,0,2.43,.22,1.96,'metal');kit.disk(cooker,'#34352c',0,.16,0,2.22,.07,1.73,'metal');kit.mesh(cooker,kit.ring,'#697167',0,.23,0,2.31,2.31,1.85,'metal').rotation.x=-Math.PI/2;
    const handle=kit.block(cooker,'#574135',2.6,.13,.65,2,.2,.25,'wood');handle.rotation.y=-.23;
    for(let i=0;i<7;i++)kit.ball(cooker,'#373a2e',Math.cos(i*1.5)*1.8,.22,Math.sin(i*1.5)*1.4,.04,.009,.03);
   } else if(r.recipe==='corn-dog'){
    cornDogStall=createCornDogStall(kit);cooker.add(cornDogStall.root);
   } else {
    // One separately owned live material: never recolor the shared food cache.
    if(!spitMaterial){spitMaterial=kit.mat('#ba8755','meat').clone();kit.materials.set('market-shawarma-live',spitMaterial);}
    kit.block(cooker,'#ccb181',0,-.08,.6,5.5,.14,4.1,'wood');kit.block(spit,'#494e45',0,0,-2.2,2.8,.18,1.8,'metal');kit.block(spit,'#65402b',0,1.35,-3,2.5,2.8,.18,'metal');for(let i=0;i<5;i++)kit.block(spit,'#cc6534',-.8+i*.4,1.4,-2.86,.1,2.15,.05);
    kit.disk(spit,'#a4a498',0,1.55,-2.2,.055,3.2,.055,'metal');
   }
   // The fryer has already batched its static body; retain its live dial/lamp.
   if(!cornDogStall)bakeRigidGroup(cooker,kit.geometries);
  }
  // Shadows depend on scene geometry/light, not viewport size. Updates still
  // refresh the full-quality map; pure resizes reuse it without a second pass.
  const render=(sceneChanged=true)=>{renderer.shadowMap.needsUpdate=sceneChanged;renderer.render(scene,camera);};
  const update=(r:MarketRun)=>{
   if(disposed)return;if(snapshot&&r.tosses>snapshot.tosses)tossAt=r.elapsed;if(snapshot&&r.elapsed<snapshot.elapsed)tossAt=-Infinity;snapshot=r;if(recipe!==r.recipe)setup(r);
   const key=JSON.stringify([r.status,r.portions.map(p=>[p.kind,Math.round(p.a*15),Math.round(p.b*15),p.side,p.coated,p.lifted]),r.stirs,r.folds,r.shaves,r.sauces]);
   if(key!==fingerprint){fingerprint=key;food?.dispose();foodRoot.clear();food=marketFood(r,kit);const bottom=new Box3().setFromObject(food.root).min.y;foodMinY=Number.isFinite(bottom)?bottom:0;foodRoot.add(food.root);
    if(r.recipe==='shawarma'){
     // Remove only the previous meat layers, leaving the heater and spindle.
     for(const child of [...spit.children])if(child.userData.meat)spit.remove(child);
     for(let i=0;i<22;i++){const radius=.48+(i/22)*.19-r.shaves*.008,ring=kit.mesh(spit,kit.steakGeometry,'#ba8755',0,.28+i*.105,-2.2,radius,radius,.25,'meat');ring.material=spitMaterial!;ring.rotation.x=-Math.PI/2;ring.rotation.z=i*.42;ring.userData.meat=true;}
    }
   }
   const plated=r.status==='done'||(r.recipe==='corn-dog'&&r.portions.length>0&&r.portions.every(p=>p.lifted));
   cooker.visible=!plated;spit.visible=!plated;camera.zoom=plated?(r.recipe==='steak-dinner'?1.08:1.15):1;camera.updateProjectionMatrix();
   foodRoot.position.set(0,plated?-.225-foodMinY:.25,0);foodRoot.rotation.set(0,0,0);
   if(r.recipe==='egg-fried-rice'&&!motion!.matches&&r.status==='playing'){const age=(r.elapsed-tossAt)/1000;if(age<.7){const lift=Math.sin(age/.7*Math.PI);foodRoot.position.y+=lift*.9;foodRoot.rotation.x=lift*-.28;}}
   cornDogStall?.update(r);
   const frying=cornDogPresentation(r);
   bubbles.visible=frying.bubbleCount>0;
   bubbles.count=frying.bubbleCount;bubbleMaterial.opacity=frying.bubbleOpacity;
   if(bubbles.visible){for(let i=0;i<frying.bubbleCount;i++){const phase=motion!.matches ? .3 : ((r.elapsed/1100+i*.137)%1),radius=.018+Math.sin(phase*Math.PI)*.045;bubblePose.position.set(-.55+Math.sin(i*2.4)*1.72,.272+phase*.015,Math.cos(i*2.4)*1.56);bubblePose.rotation.set(-Math.PI/2,0,0);bubblePose.scale.setScalar(radius);bubblePose.updateMatrix();bubbles.setMatrixAt(i,bubblePose.matrix);}bubbles.instanceMatrix.needsUpdate=true;bubbles.computeBoundingSphere();}
   if(r.recipe==='shawarma'){const presentation=shawarmaPresentation(r,motion!.matches);spitMaterial?.color.set(cookedColor('#ba8755',presentation.cooked));for(const layer of spit.children)if(layer.userData.meat)layer.rotation.z=presentation.rotation+layer.position.y;}
   if(r.recipe==='corn-dog'&&r.status!=='done'&&!plated)food?.root.children.forEach(o=>{const i=o.userData.portion;if(typeof i==='number'&&r.portions[i]?.lifted){o.position.x=2.65-(i%3-1)*1.15;o.position.y=.18;}});
   render();
  };
  refreshMotion=()=>{if(snapshot&&!disposed)update(snapshot);};motion.addEventListener('change',refreshMotion);
  // Keep the old maximum pixel budget while covering the actual play viewport.
  let viewWidth=0,viewHeight=0,viewDpr=0;
  const sizeView=(width:number,height:number)=>{
   const dpr=Math.min(devicePixelRatio||1,1.5);
   if(width===viewWidth&&height===viewHeight&&dpr===viewDpr)return false;
   viewWidth=width;viewHeight=height;viewDpr=dpr;
   const next=marketFrontCamera(width,height);camera.aspect=next.aspect;camera.fov=next.fov;camera.updateProjectionMatrix();
   const scale=Math.min(dpr,Math.sqrt(768*640*2.25/(width*height)));
   // One allocation, not setPixelRatio (which also resizes) followed by setSize.
   renderer.setDrawingBufferSize(Math.max(1,Math.floor(width*scale)),Math.max(1,Math.floor(height*scale)),1);return true;
  };
  resizeView=()=>{if(disposed)return;const box=host.getBoundingClientRect();if(box.width<=0||box.height<=0)return;if(sizeView(box.width,box.height)&&snapshot)render(false);};
  if(typeof ResizeObserver!=='undefined'){resizeObserver=new ResizeObserver(resizeView);resizeObserver.observe(host);}window.addEventListener('resize',resizeView);resizeView();
  return {hit,update,capture:()=>{if(!snapshot||disposed)throw Error('料理畫面尚未就緒');const original=snapshot;try{sizeView(768,640);update({...original,status:'done'});return renderer.domElement.toDataURL('image/png');}finally{const box=host.getBoundingClientRect();if(box.width>0&&box.height>0)sizeView(box.width,box.height);update(original);}},stats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),dispose};
 }catch(cause){dispose();throw cause;}
}
