import {ACESFilmicToneMapping,Box3,BoxGeometry,Color,CylinderGeometry,DirectionalLight,DoubleSide,ExtrudeGeometry,FrontSide,Float32BufferAttribute,Group,InstancedMesh,DynamicDrawUsage,HemisphereLight,LatheGeometry,Mesh,MeshStandardMaterial,OrthographicCamera,PCFShadowMap,Plane,Raycaster,Scene,Shape as Contour,SphereGeometry,TorusGeometry,Vector2,Vector3,WebGLRenderer,type BufferGeometry,type Material,type Texture} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {createDishModel,type DishModel} from './dish-model';
import {bakeRigidGroup} from '../stage-batch';
import {createKitchenFoodBatch} from './kitchen-food-batch';
import {ingredientVisual,type IngredientLayer} from './ingredient-visuals';
import {createPreparationModel,isVolumetricPreparation} from './preparation-model';
import {currentStep,cutGuide,plateTarget,type CookingRun} from './domain';
import {KITCHEN_VIEW as V,type Shape} from './catalog';

import {kitchenPresentation,kitchenWorkZoom,type KitchenViewport} from './kitchen-presentation';
export {kitchenPresentation} from './kitchen-presentation';
export type KitchenStage={resize:(viewport:KitchenViewport,paint?:boolean)=>void;update:(run:CookingRun,point:{x:number;y:number}|null,time:number,motion:boolean)=>void;dispose:()=>void;capture:()=>string;stats:()=>{calls:number;triangles:number;geometries:number;textures:number}};
const C={ink:'#393d40',wood:'#dfab72',edge:'#a86d42',cream:'#fff0d1',mint:'#78b9a5',red:'#e87455',gold:'#f2bb55',dark:'#555b61'};
const BOARD_DEPTH=0;
const foodColors:Record<Shape,string>={greens:'#67a46f',carrot:'#efa052',meat:'#d68b77',rice:'#ead1a0',dough:'#f0d09a',noodle:'#e8bf70',egg:'#edb541',fruit:'#e66e68',cream:'#f2e4c8',chocolate:'#855b48',fish:'#e9987d'};

/** UX-7: original culinary miniature, with material-specific studio lighting. Rendered food never mutates cooking rules. */
export function createKitchenStage(host:HTMLElement,onLost:()=>void):KitchenStage{
 const renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'}),geometries=new Set<BufferGeometry>(),stepGeometry=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
 // A step owns its ingredient palette separately from utensils and the retained
 // generic palette. Heat must never recolor the board, spoon or next recipe.
 const ingredientMaterials=new Map<string,MeshStandardMaterial>(),ingredientGeometry=new Map<readonly IngredientLayer[],BufferGeometry[]>();
 const ingredientCuts=new Map<Group,{whole:Group;cut:Group}>();
 let preparationModel:ReturnType<typeof createPreparationModel>|null=null;
 let foodBatch:ReturnType<typeof createKitchenFoodBatch>=null;
 const ambientBatches:{mesh:InstancedMesh;sources:Mesh[]}[]=[];
 const clearAmbient=()=>{for(const {mesh} of ambientBatches){mesh.removeFromParent();mesh.dispose();}ambientBatches.length=0;};
 // Only factory-owned opaque steam/flame meshes are admitted. Their local TRS,
 // material, topology and shadow flags stay unchanged; no geometry is disposed here.
 function batchAmbient(parent:Group,sources:Mesh[]){
  const groups:Mesh[][]=[];
  if(sources.some(m=>m.parent!==parent||m.constructor!==Mesh||Array.isArray(m.material)||!(m.material instanceof MeshStandardMaterial)||m.material.transparent||m.material.opacity!==1||!m.visible||m.children.length||m.customDepthMaterial||m.customDistanceMaterial||!m.matrixAutoUpdate||!m.matrixWorldAutoUpdate||[m.scale.x,m.scale.y,m.scale.z].some(n=>!Number.isFinite(n)||n<=0)))return;
  for(const source of sources){const group=groups.find(g=>g[0].geometry===source.geometry&&g[0].material===source.material&&g[0].castShadow===source.castShadow&&g[0].receiveShadow===source.receiveShadow&&g[0].layers.mask===source.layers.mask&&g[0].renderOrder===source.renderOrder);if(group)group.push(source);else groups.push([source]);}
  for(const group of groups){if(group.length<2)continue;const first=group[0];
   const mesh=new InstancedMesh(first.geometry,first.material,group.length);mesh.name='kitchen/ambient';mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.layers.mask=first.layers.mask;mesh.renderOrder=first.renderOrder;
   for(const source of group)source.removeFromParent();parent.add(mesh);ambientBatches.push({mesh,sources:group});
  }
 }
 function updateAmbient(){for(const {mesh,sources} of ambientBatches){for(let i=0;i<sources.length;i++){sources[i].updateMatrix();mesh.setMatrixAt(i,sources[i].matrix);}mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();}}

 let completedDish:DishModel|null=null;let disposed=false,identity='',objects:{food:Group[];tool:Group;body:Group;steam:Mesh[];flaps:Group[];liquid:Mesh|null;stream:Mesh|null;flames:Mesh[]}|null=null;
 const light=new DirectionalLight('#fff1dc',2.1),lost=(e:Event)=>{e.preventDefault();if(!disposed)onLost();};
 const dispose=()=>{if(disposed)return;disposed=true;clearAmbient();foodBatch?.dispose();completedDish?.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);stepGeometry.forEach(g=>g.dispose());ingredientMaterials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());light.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 try{
  renderer.setSize(V.width,V.height,false);// Supersample standard-DPI displays too, within the same fixed 960×672 cap.
  renderer.setPixelRatio(V.maxDpr);renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=.94;renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;renderer.shadowMap.autoUpdate=false;renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.addEventListener('webglcontextlost',lost);host.append(renderer.domElement);
  const scene=new Scene();scene.background=new Color('#d8d3c4');const camera=new OrthographicCamera(-4.65,4.65,3.255,-3.255,.1,40);camera.position.set(0,10.6,7);camera.lookAt(0,.6,0);camera.updateMatrixWorld(true);const presentationCamera=camera.clone();let viewport:KitchenViewport|null=null,zoom=1,presentation:ReturnType<typeof kitchenPresentation>|null=null;let shadowsReady=false;const render=(shadows=true)=>{renderer.shadowMap.needsUpdate=shadows||!shadowsReady;camera.updateMatrixWorld(true);if(presentation){presentationCamera.copy(camera);Object.assign(presentationCamera,{left:presentation.left,right:presentation.right,top:presentation.top,bottom:presentation.bottom});presentationCamera.updateProjectionMatrix();}renderer.render(scene,presentation?presentationCamera:camera);shadowsReady=true;};scene.add(new HemisphereLight('#f5f2e8','#59675f',.55));light.position.set(-3,6,10);light.castShadow=true;light.shadow.mapSize.set(V.shadowSize,V.shadowSize);Object.assign(light.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:25});light.shadow.normalBias=.04;scene.add(light);const fill=new DirectionalLight('#e7edf0',.6);fill.position.set(5,3,9);scene.add(fill);
  const own=<T extends BufferGeometry>(g:T)=>{geometries.add(g);return g;},round=own(new RoundedBoxGeometry(1,1,1,3,.17)),sphere=own(new SphereGeometry(1,24,16)),cylinder=own(new CylinderGeometry(1,1,1,32)),cone=own(new CylinderGeometry(.12,1,1,24)),torus=own(new TorusGeometry(1,.08,10,40)),box=own(new BoxGeometry(1,1,1));
  const bowl=own(new LatheGeometry([new Vector2(.04,0),new Vector2(.8,.02),new Vector2(1.2,.2),new Vector2(1.55,.65),new Vector2(1.7,1.15),new Vector2(1.8,1.3),new Vector2(1.72,1.3),new Vector2(1.62,1.15),new Vector2(1.47,.65),new Vector2(1.12,.2),new Vector2(.72,.11),new Vector2(.04,.09)],40));
  // The native budget includes shadow color/depth and Three's DFG LUT.
  // Keep culinary grain in owned geometry; no PMREM or additional GPU maps.
  const woodGeometry=new Map<BufferGeometry,BufferGeometry>();
  function grained(g:BufferGeometry){let result=woodGeometry.get(g);if(!result){result=own(g.clone());const p=result.getAttribute('position'),colors:number[]=[];for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),tone=.91+.045*Math.sin(z*31+x*3)+.02*Math.sin(z*71+x*1.7);colors.push(tone,tone*.985,tone*.95);}result.setAttribute('color',new Float32BufferAttribute(colors,3));woodGeometry.set(g,result);}return result;}
  // Reusable bounded culinary topology: individual long grains and small pearls,
  // not scaled yellow meal-sized balls. These are original, texture-free meshes.
  const morsel=own(new SphereGeometry(1,12,8)),grainGeometry=own(new SphereGeometry(1,8,6));
  const bladeOutline=new Contour();bladeOutline.moveTo(0,0);bladeOutline.lineTo(1.1,0);bladeOutline.quadraticCurveTo(1.35,.015,1.45,.12);bladeOutline.lineTo(1.35,.38);bladeOutline.lineTo(0,.44);bladeOutline.closePath();
  const chefBlade=own(new ExtrudeGeometry(bladeOutline,{depth:.035,bevelEnabled:true,bevelSize:.008,bevelThickness:.006,bevelSegments:1,steps:1,curveSegments:5}));chefBlade.rotateY(-Math.PI/2);chefBlade.translate(.0175,0,-.35);
  const doughSurface=own(sphere.clone()),doughPositions=doughSurface.getAttribute('position'),flour:number[]=[];
  for(let i=0;i<doughPositions.count;i++){const x=doughPositions.getX(i),y=doughPositions.getY(i),z=doughPositions.getZ(i),tone=.89+.055*Math.sin(x*17+z*11)*Math.cos(y*23-z*7)+.035*Math.sin(x*41+y*13);flour.push(tone,tone*.975,tone*.92);}
  doughSurface.setAttribute('color',new Float32BufferAttribute(flour,3));
  type Surface='ceramic'|'wood'|'steel'|'iron'|'food'|'pearl'|'cloth';
  const vesselLip=own(new TorusGeometry(1,.065,10,40));
  const waterContour=new Contour();waterContour.moveTo(1,0);waterContour.absarc(0,0,1,0,Math.PI*2,false);waterContour.closePath();
  const waterVolume=own(new ExtrudeGeometry(waterContour,{depth:1,bevelEnabled:false,steps:1,curveSegments:24}));waterVolume.rotateX(-Math.PI/2);
  const taperedWater=own(waterVolume.clone()),waterPositions=taperedWater.getAttribute('position');for(let i=0;i<waterPositions.count;i++){const taper=.45+.55*waterPositions.getY(i);waterPositions.setX(i,waterPositions.getX(i)*taper);waterPositions.setZ(i,waterPositions.getZ(i)*taper);}taperedWater.computeVertexNormals();
  // A complete liquid volume inside a complete vessel. Its footprint stays
  // inside the vessel at the lowest water height, rather than protruding through it.
  const palette=new Map<string,MeshStandardMaterial>(),openMaterials=new Set<MeshStandardMaterial>();function mat(color:string,surface:Surface='ceramic'){const key=`${surface}/${color}`;let m=palette.get(key);if(!m){m=new MeshStandardMaterial({color,roughness:surface==='pearl'?.24:surface==='cloth'?.95:surface==='steel'?.25:surface==='iron'?.76:surface==='wood'?.84:surface==='food'?.52:.3,metalness:surface==='steel'?.82:surface==='iron'?.3:0,side:DoubleSide,vertexColors:surface==='wood'});m.userData.kitchenSurface=surface;palette.set(key,m);materials.add(m);}return m;}
  const group=(p:Group,x=0,y=0,z=0)=>{const g=new Group();g.position.set(x,y,z);p.add(g);return g;};
  function mesh(p:Group,g:BufferGeometry,color:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx,surface:Surface='ceramic'){const role:Surface=p.userData.kitchenSurface??surface,material=mat(color,role);if(role==='wood')g=grained(g);if(g===bowl)openMaterials.add(material);const m=new Mesh(g,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=m.receiveShadow=true;p.add(m);return m;}
  const rb=(p:Group,c:string,x:number,y:number,z:number,xs:number,ys:number,zs:number,surface:Surface='ceramic')=>mesh(p,round,c,x,y,z,xs,ys,zs,surface);
  const ball=(p:Group,c:string,x:number,y:number,z:number,xs:number,ys=xs,zs=xs,surface:Surface='ceramic')=>mesh(p,sphere,c,x,y,z,xs,ys,zs,surface);
  const ring=(p:Group,c:string,x:number,y:number,z:number,r:number)=>{const m=mesh(p,torus,c,x,y,z,r,r,r);m.rotation.x=-Math.PI/2;return m;};
  const vesselRim=(p:Group,c:string,x:number,y:number,z:number,r:number)=>{const m=mesh(p,vesselLip,c,x,y,z,r,r,r);m.rotation.x=-Math.PI/2;return m;};
  const world=new Group(),set=new Group(),work=new Group();scene.add(world);world.add(set,work);
  // A fixed operator-eye work view: the room stays upright and the board lies
  // on its counter. The camera, never the entire world, establishes depth.
  rb(set,'#d8d3c4',0,12,-8,64,64,.3);rb(set,'#51625a',0,-16,-1,64,31,12);
  rb(set,'#ded5c5',0,-.12,-1,64,.13,12);
  // Quiet architectural scale: inset cabinet fronts and a stone counter lip,
  // not an empty coloured plane or a field of tiny decorative props.
  for(const x of [-10,-5,0,5,10]){rb(set,C.ink,x,-3.4,5.03,4.82,5.8,.05);rb(set,'#51625a',x,-3.4,5.09,4.68,5.62,.08);rb(set,C.cream,x,-1.25,5.18,.8,.075,.06);}
  rb(set,'#ded5c5',0,-.28,5.12,64,.18,.25);
  for(const x of [-7,7]){rb(set,C.cream,x,4,-7.73,3.2,5.6,.12);rb(set,'#d8d3c4',x,4,-7.63,2.94,5.34,.10);rb(set,C.cream,x,4,-7.5,.065,5.34,.08);}
  // Complete vessels and horizontal boards share the real countertop.
  // Food is revealed by the work view, not by removing the front wall of pots.
  // Large, legible shelf props; no dense texture noise or specular specks.
  const towel=group(set,-3.6,.02,1.9);rb(towel,'#f7e3be',0,0,0,1.1,.08,2.5);for(const x of [-.32,0,.32])rb(towel,C.red,x,.05,0,.08,.02,2.35);
  for(const [i,color]of [C.mint,C.red,C.gold].entries()){const b=group(set,2.8+i*.42,0,-2.5);mesh(b,cylinder,color,0,.35,0,.18,.7,.18);rb(b,C.cream,0,.35,.18,.24,.3,.035);mesh(b,cylinder,C.dark,0,.77,0,.14,.15,.14);}
  // The guide is an original mitten-like kitchen cat, rather than a human hand sprite.
  const cat=group(set,-3.4,.2,-2.65);ball(cat,C.mint,0,.45,0,.5,.5,.4);for(const side of [-1,1]){const ear=mesh(cat,cone,C.mint,side*.3,.93,0,.19,.35,.18);ear.rotation.z=-side*.2;ball(cat,C.ink,side*.17,.51,.36,.04,.065,.025);}ball(cat,C.red,0,.35,.4,.055,.04,.035);rb(cat,C.cream,0,.04,.05,.72,.24,.5);bakeRigidGroup(set,geometries);
  // Keep food-to-board contact shadows, not a room-sized silhouette from the
  // mounted board onto the distant wall/cabinet. No extra lights or shadow maps.
  set.name='kitchen/backdrop';set.traverse(node=>{if(node instanceof Mesh)node.receiveShadow=false;});
  const ray=new Raycaster(),ground=new Plane(new Vector3(0,1,0),-.3),intersection=new Vector3();
  function screen(x:number,y:number,depth=.3){
   // One horizontal contact plane supplies the actual tools and plating targets.
   // The same camera projection keeps normalized input and SVG guides aligned.
   camera.updateMatrixWorld(true);ray.setFromCamera(new Vector2(x*2-1,1-y*2),camera);ground.constant=-depth;
   const hit=ray.ray.intersectPlane(ground,intersection);if(!hit)throw Error('Invalid work surface projection');return hit.clone();
  }
  function food(p:Group,shape:Shape,size=1,ingredient='',cuttable=false){const g=group(p),color=foodColors[shape],visual=ingredientVisual(ingredient,shape);g.userData.kitchenSurface='food';
   if(ingredient.includes('珍珠')){
    g.name='ingredient/tapioca-pearls';g.userData.kitchenSurface='pearl';
    for(let i=0;i<11;i++){const angle=i*2.39996,r=.10+.22*Math.sqrt(i/10),pearl=mesh(g,morsel,i%3?'#321b12':'#49271a',Math.cos(angle)*r,.10+(i%3)*.032,Math.sin(angle)*r,.082,.078,.082,'pearl');pearl.name='food/tapioca-pearl';}
   }
   else if(visual){
    g.name=`ingredient/${visual.id}`;
    const addLayers=(target:Group,layers:readonly IngredientLayer[])=>{
     let geometry=ingredientGeometry.get(layers);
     if(!geometry){geometry=layers.map(layer=>{const contour=new Contour();layer.points.forEach(([x,y],i)=>{if(i===0)contour.moveTo(x*.3,-y*.3);else contour.lineTo(x*.3,-y*.3);});contour.closePath();const result=new ExtrudeGeometry(contour,{depth:.09,bevelEnabled:true,bevelSize:.006,bevelThickness:.006,bevelSegments:2,steps:1,curveSegments:1});result.scale(.98,.98,1);stepGeometry.add(result);return result;});ingredientGeometry.set(layers,geometry);}
     const pieceGeometry=geometry;
     layers.forEach((layer,i)=>{let material=ingredientMaterials.get(layer.color);if(!material){material=new MeshStandardMaterial({color:layer.color,roughness:.52,side:DoubleSide});ingredientMaterials.set(layer.color,material);}const piece=new Mesh(pieceGeometry[i],material);piece.rotation.x=-Math.PI/2;piece.position.y=.066+i*.018;piece.castShadow=piece.receiveShadow=true;target.add(piece);});
    };
    if(visual.cutLayers&&cuttable){
     const whole=group(g),cut=group(g);whole.name='preparation/whole';cut.name='preparation/cut';
     // Bake each variant independently. Baking their parent would flatten hidden
     // children into one mesh and expose both states at the same time.
     addLayers(whole,visual.layers);addLayers(cut,visual.cutLayers);
     bakeRigidGroup(whole,stepGeometry);bakeRigidGroup(cut,stepGeometry);cut.visible=false;
     ingredientCuts.set(g,{whole,cut});g.scale.setScalar(size);return g;
    }
    addLayers(g,visual.layers);
   }
   else if(shape==='carrot'){mesh(g,cone,color,0,.24,0,.3,.55,.3);for(const side of [-1,1]){const l=ball(g,'#6b9e62',side*.1,.59,0,.09,.25,.06);l.rotation.z=-side*.4;}}
   else if(shape==='greens'){for(let i=0;i<3;i++){const leaf=ball(g,i%2?'#8db878':color,(i-1)*.16,.17,0,.22,.09,.44);leaf.rotation.y=(i-1)*.55;}rb(g,'#b7c58d',0,.12,.18,.06,.07,.6);}
   else if(shape==='rice'){
    g.name='ingredient/separate-rice-grains';
    for(let i=0;i<24;i++){const angle=i*2.39996,r=.34*Math.sqrt((i+.5)/24),grain=mesh(g,grainGeometry,'#ead1a0',Math.cos(angle)*r,.065+.14*(1-r/.38),Math.sin(angle)*r,.039,.035,.115,'food');grain.rotation.y=angle+.6;grain.name='food/rice-grain';}
    if(ingredient.includes('炒飯'))for(let i=0;i<6;i++){const angle=i*1.7,r=.24;const garnish=mesh(g,box,i%2?'#7ca571':'#edc358',Math.cos(angle)*r,.19,Math.sin(angle)*r,.09,.035,.075,'food');garnish.rotation.y=angle;}
    else if(ingredient.includes('芝麻'))for(let i=0;i<6;i++){const seed=mesh(g,grainGeometry,'#4b3422',Math.cos(i*1.7)*.24,.2,Math.sin(i*1.7)*.24,.015,.01,.035,'food');seed.rotation.y=i*.8;}
   }
   else if(shape==='noodle'){for(let i=0;i<3;i++){const t=ring(g,color,(i-1)*.09,.13+i*.08,0,.28+i*.04);t.scale.z=.7;}rb(g,'#79a66f',.19,.35,.1,.08,.07,.28);}
   else if(shape==='fish'){rb(g,color,0,.18,0,.7,.3,.48);for(const x of [-.23,0,.23]){const line=rb(g,'#f6d4b3',x,.34,0,.04,.018,.43);line.rotation.y=-.25;}}
   else if(shape==='egg'){ball(g,'#f9e6bf',0,.09,0,.5,.1,.4);ball(g,color,.02,.2,.01,.23,.14,.23);}
   else if(shape==='fruit'){mesh(g,cone,color,0,.24,0,.3,.55,.3).rotation.z=Math.PI;for(let i=0;i<3;i++){const l=ball(g,'#6d9f68',0,.53,0,.09,.035,.23);l.rotation.y=i*Math.PI/3;}}
   else if(shape==='chocolate'){rb(g,color,0,.16,0,.64,.28,.5);rb(g,'#a17151',0,.31,0,.49,.04,.35);}
   else if(shape==='meat'){ball(g,color,0,.14,0,.47,.18,.32);ball(g,'#e7b29b',-.1,.29,0,.2,.025,.14);}
   else if(shape==='dough'){const dough=mesh(g,doughSurface,color,0,.22,0,.4,.24,.36);(dough.material as MeshStandardMaterial).vertexColors=true;}
   else if(shape==='cream'){for(let i=0;i<3;i++)ball(g,color,0,.13+i*.15,0,.34-i*.08,.15,.3-i*.07);}
   else{ball(g,color,0,.22,0,.4,.24,.36);}
   g.scale.setScalar(size);bakeRigidGroup(g,stepGeometry);return g;
  }
  function mitten(p:Group){const g=group(p);g.name='tool/oven-mitt';ball(g,'#d8cbb6',0,0,0,.49,.19,.62,'cloth');ball(g,'#d8cbb6',-.43,-.01,.1,.24,.18,.32,'cloth');rb(g,'#b9aa91',0,-.01,-.61,.65,.27,.38,'cloth');for(const z of [-.25,0,.25])rb(g,'#c7b9a2',0,.185,z,.57,.012,.012,'cloth');bakeRigidGroup(g,stepGeometry);return g;}

  let lastMix:{amount:number;x:number|undefined;y:number|undefined}|null=null;
  let lastKnead:{held:number;motion:boolean}|null=null;
  // Bake changes pigment, not shadow depth, except when the oven tool appears.
  let lastBakeToolVisible:boolean|null=null;
  let lastStatic:string|null=null;
  function build(run:CookingRun){clearAmbient();lastBakeToolVisible=null;lastStatic=null;lastKnead=null;lastMix=null;openMaterials.clear();foodBatch?.dispose();foodBatch=null;completedDish?.dispose();completedDish=null;work.clear();stepGeometry.forEach(g=>g.dispose());stepGeometry.clear();ingredientGeometry.clear();ingredientCuts.clear();preparationModel=null;ingredientMaterials.forEach(m=>m.dispose());ingredientMaterials.clear();if(run.status==='done'){completedDish=createDishModel(run.recipeId);completedDish.root.position.set(0,.12,.2);completedDish.root.rotation.y=-.25;work.add(completedDish.root);camera.lookAt(0,.6,0);objects=null;return;}camera.lookAt(0,.6,0);const s=currentStep(run),body=group(work),tool=group(work),pieces:Group[]=[],steam:Mesh[]=[],flaps:Group[]=[],flames:Mesh[]=[];let liquid:Mesh|null=null,stream:Mesh|null=null;
   if(['slice','knead','fold'].includes(s.kind)){rb(body,C.edge,0,.04,.1,6.4,.28,4.5,'wood');rb(body,'#e7bd84',0,.2,.1,6.1,.08,4.2,'wood');rb(body,'#d1a56d',-2.68,.25,.1,.05,.012,3.5,'wood');}
   if(s.kind==='slice'){const visual=ingredientVisual(s.ingredient,s.shape);
    if(visual&&isVolumetricPreparation(visual.id)){
     const planes=Array.from({length:s.goal},(_,count)=>screen(cutGuide({...run,active:{...run.active,count}}),.5,.3).x);
     preparationModel=createPreparationModel(visual.id,planes,stepGeometry,ingredientMaterials);body.add(preparationModel.root);pieces.push(preparationModel.root);
    }else for(let i=0;i<Math.min(8,s.goal);i++){const p=food(body,s.shape,.95,s.ingredient,true);p.position.set(-1.9+i*3.8/(s.goal-1),.28,.05);pieces.push(p);}
    rb(tool,'#493a2e',0,.27,-.82,.22,.2,.94,'wood');mesh(tool,chefBlade,'#bec8cd',0,0,0,1,1,1,'steel').name='tool/chef-blade';for(const z of [-1.04,-.66])ball(tool,'#bec8cd',0,.375,z,.032,.012,.032,'steel');}
   if(s.kind==='knead'){pieces.push(food(body,'dough',3.8));pieces[0].position.set(0,.26,.1);mitten(tool);}
   if(s.kind==='mix'){body.position.z=1.2;mesh(body,bowl,'#a7b3b6',0,0,0,1.55,1.15,1.2,'steel');vesselRim(body,C.cream,0,1.5,0,2.76).scale.z=.78;liquid=mesh(body,waterVolume,s.ingredient.includes('珍珠')?'#b98b62':foodColors[s.shape],0,.73,0,2.24,.54,1.58,'food');for(let i=0;i<5;i++){const p=food(body,s.shape,.85,s.ingredient);p.position.set(Math.cos(i*1.3)*1.2,1.29,Math.sin(i*1.3)*.8);pieces.push(p);}rb(tool,'#ab774e',0,.5,-.7,.18,.18,2.35,'wood');ball(tool,C.wood,0,.39,.47,.4,.09,.6,'wood');}
   if(s.kind==='pan'||s.kind==='boil'){rb(body,C.mint,0,-.02,0,6,.58,4.4);rb(body,'#4e6561',0,.3,0,5.4,.1,3.9);for(const x of [-2.2,2.2])mesh(body,cylinder,C.gold,x,.33,1.75,.22,.1,.22);for(let i=0;i<5;i++){const f=mesh(body,cone,i%2?C.gold:C.red,(i-2)*.55,.55,.8,.19,.5,.18);flames.push(f);}
    mesh(body,cylinder,C.dark,0,.73,0,2.28,.47,1.85,'iron');ring(body,'#74746b',0,1.01,0,2.2).scale.z=.84;
    if(s.kind==='pan'){rb(body,C.ink,2.8,.8,.35,1.9,.23,.43);mesh(body,cylinder,'#a18b62',0,1,0,2.09,.08,1.7);for(let i=0;i<5;i++){const p=food(body,s.shape,1.4,s.ingredient);p.position.set((i%3-1)*1.2,1.07,(Math.floor(i/3)-.5)*1.25);pieces.push(p);}rb(tool,C.wood,0,.3,0,.2,.2,2,'wood');rb(tool,C.cream,0,.3,1,.74,.09,.85);}
    else{mesh(body,bowl,'#a7b3b6',0,.5,0,1.3,.65,1.15,'steel');liquid=mesh(body,waterVolume,s.ingredient.includes('珍珠')?'#68381f':'#e8c78e',0,.94,0,1.86,.36,1.5,'food');for(let i=0;i<3;i++){const p=food(body,s.shape,1,s.ingredient);p.position.set((i-1)*1.05,1.42,Math.sin(i)*.45);p.position.y+=1.24-new Box3().setFromObject(p,true).min.y;pieces.push(p);}for(let i=0;i<4;i++)steam.push(ball(body,C.cream,(i-1.5)*.85,1.5,i%2?.55:-.35,.12));rb(tool,C.wood,0,.3,-.4,.15,.17,2,'wood');ring(tool,C.cream,0,.3,.65,.5);}
   }
   if(s.kind==='bake'){rb(body,C.ink,0,-.08,-.1,6,.3,3.6);rb(body,C.mint,0,1.2,-.12,5.7,2.7,3.5);rb(body,C.cream,0,2.32,1.67,5.1,.42,.16);rb(body,C.gold,0,1.05,1.75,5.12,1.85,.13);rb(body,'#6d4b39',0,1.06,1.84,4.72,1.45,.08);rb(body,C.wood,0,.48,1.92,4.1,.12,1.5);rb(body,C.cream,0,1.97,1.86,3.3,.12,.2);for(const x of [-2.1,2.1])mesh(body,cylinder,C.cream,x,2.34,1.76,.23,.16,.23).rotation.x=Math.PI/2;for(let i=0;i<3;i++){const p=food(body,s.shape,1.45,s.ingredient);p.position.set((i-1)*1.12,.56,1.94);pieces.push(p);}mitten(tool);}
   if(s.kind==='pour'){mesh(body,bowl,'#a7b3b6',.65,0,.6,1.1,1.6,1.1,'steel');vesselRim(body,C.red,.65,2.08,.6,1.98);liquid=mesh(body,taperedWater,foodColors[s.shape],.65,.45,.6,1,.12,1,'food');const jug=group(tool);mesh(jug,bowl,'#a7b3b6',0,0,0,.7,.9,.7,'steel');vesselRim(jug,C.cream,0,1.19,0,1.25);mesh(jug,torus,C.mint,-1.1,.45,0,.6,.6,.6).rotation.y=Math.PI/2;stream=mesh(work,cylinder,foodColors[s.shape],.35,2.35,.2,.12,1.8,.12);}
   if(s.kind==='fold'){const wrap=rb(body,C.cream,0,.34,0,4.4,.06,3.5);wrap.rotation.y=Math.PI/4;pieces.push(food(body,s.shape,2.2,s.ingredient));pieces[0].position.y=.4;for(let i=0;i<4;i++){const g=group(body);g.rotation.y=i*Math.PI/2;const flap=group(g,-1.25,.4,0);rb(flap,'#f4d398',0,0,0,2.4,.06,3);flaps.push(flap);}mitten(tool);}
   if(s.kind==='plate'){mesh(body,cylinder,C.edge,0,.18,.2,3.06,.17,2.3);mesh(body,cylinder,C.cream,0,.31,.2,2.98,.16,2.23);ring(body,C.gold,0,.41,.2,2.67).scale.z=.75;rb(body,C.wood,-3.65,.16,.4,1.05,.2,3.7);for(let i=0;i<s.goal;i++)pieces.push(food(body,s.shape,1.15,s.ingredient));food(tool,s.shape,1.15,s.ingredient);}
   // Cutting, dough, folding and plating keep the original local simulation
   // on a horizontal board under the fixed work camera.
   // All bodies remain upright; board-local pressure follows the surface normal.
   body.name='kitchen/body';tool.name='kitchen/tool';
   bakeRigidGroup(body,stepGeometry,new Set([...pieces,...steam,...flaps,...flames,...(liquid?[liquid]:[])]));batchAmbient(body,[...steam,...flames]);objects={food:pieces,tool,body,steam,flaps,liquid,stream,flames};if(s.kind==='pan'||s.kind==='boil')foodBatch=createKitchenFoodBatch(body,pieces);
  }
  const baked=new Color('#bd864b'),burnt=new Color('#805335');
  function syncMaterialSides(run:CookingRun){
   // Closed, outward-wound factory primitives expose the same nearest surface
   // to both the work camera and the external directional light. Preserve open
   // vessels and preparation cut-face geometry as two-sided in both passes.
   for(const material of [...palette.values(),...ingredientMaterials.values()]){
    const closed=!openMaterials.has(material)&&!(preparationModel&&[...ingredientMaterials.values()].includes(material));
    const side=closed?FrontSide:DoubleSide;
    if(material.side!==side||material.shadowSide!==side){material.side=side;material.shadowSide=side;material.needsUpdate=true;}
   }
  }
  function update(run:CookingRun,point:{x:number;y:number}|null,time:number,motion:boolean){if(disposed)return;const nextZoom=kitchenWorkZoom(currentStep(run).kind,run.status==='done');if(nextZoom!==zoom){zoom=nextZoom;if(viewport)presentation=kitchenPresentation(viewport,zoom);}const key=`${run.recipeId}/${run.status==='done'?'dish':run.step}`;if(key!==identity){identity=key;for(const color of Object.values(foodColors))palette.get(`food/${color}`)?.color.set(color);build(run);syncMaterialSides(run);}if(run.status==='done'){render();return;}const o=objects!,s=currentStep(run),a=run.active,t=time/1000,held=a.holdAt===null?0:Math.min(1.5,(run.elapsed-a.holdAt)/s.holdMs),pulse=Math.max(0,1-(run.elapsed-a.lastAt)/320),pos=point?screen(point.x,point.y,(s.kind==='mix'?1.4:s.kind==='pan'?.8:s.kind==='boil'?1.2:.35)+(['slice','fold','plate'].includes(s.kind)?BOARD_DEPTH:0)):null;
   if(s.kind==='pan'||s.kind==='bake'){
    if(ingredientMaterials.size){for(const [color,material] of ingredientMaterials)material.color.set(color).lerp(a.amount>1?burnt:baked,Math.min(.7,a.amount*.4));}
    else mat(foodColors[s.shape],'food').color.set(foodColors[s.shape]).lerp(a.amount>1?burnt:baked,Math.min(.7,a.amount*.4));
   }
   o.tool.visible=s.kind!=='bake'||a.amount>=.6;
   if(s.kind==='slice'){if(preparationModel)preparationModel.update(a.count);else o.food.forEach((g,i)=>{const done=i<a.count,preparation=ingredientCuts.get(g);if(preparation){preparation.whole.visible=!done;preparation.cut.visible=done;}g.position.z=done?1.1:.05;g.rotation.y=done?(i-2)*.1:0;g.scale.setScalar(done?.65:.95);});const knifeHeight=preparationModel?preparationModel.surfaceHeight(screen(point?.x??cutGuide(run),.5,.3).x)+.1:.8;o.tool.position.copy(preparationModel?screen(point?.x??cutGuide(run),point?.y??.33,BOARD_DEPTH+knifeHeight):pos??screen(cutGuide(run),.33,BOARD_DEPTH+.8));o.tool.position.y+=motion?pulse*.4:0;}
   if(s.kind==='knead'){const dough=o.food[0],squash=Math.min(1,held);dough.scale.set(3.8*(1+squash*.22),3.8*(1-squash*.42),3.8*(1+squash*.13));o.body.updateMatrixWorld(true);o.tool.position.copy(o.body.localToWorld(new Vector3(0,2.6-squash*1.8,.2)));o.tool.rotation.z=motion?Math.sin(held*2)*.025:0;}
   if(s.kind==='mix'){const angle=a.amount;for(let i=0;i<o.food.length;i++){o.food[i].position.x=Math.cos(i*1.3+angle)*1.2;o.food[i].position.z=Math.sin(i*1.3+angle)*.8;}// The gesture drives a stir around the liquid, not a free-floating screen
    // cursor. A lower-half drag must never push the spoon below the counter.
    const stirAngle=point?Math.atan2(point.y-.5,point.x-.5):angle;
    o.tool.position.set(Math.cos(stirAngle)*1.4,1.5,1.2+Math.sin(stirAngle)*.8);o.tool.rotation.y=stirAngle+.6;}
   if(s.kind==='pan'){const flip=motion&&a.flipped?Math.min(1,(run.elapsed-a.lastAt)/450):1;for(const g of o.food){g.position.y=1.07+(a.flipped&&motion?Math.sin(flip*Math.PI)*1.1:0);g.rotation.x=a.flipped?Math.PI*2*flip:0;}o.tool.position.copy(pos??new Vector3(2.2,1.2,1.1));o.tool.rotation.y=-.5;}
   if(s.kind==='boil'){o.steam.forEach((b,i)=>{const size=.12+a.foam*.32;b.scale.setScalar(size);b.position.y=1.55+(motion?Math.sin(t*3+i)*.04:0);});o.tool.position.copy(pos??new Vector3(2.4,1.5,.1));o.tool.rotation.y=-.6;}
   if(s.kind==='bake'){o.tool.position.set(2.35,.95,2.6);o.tool.rotation.z=-.3;}
   if(s.kind==='pour'){o.tool.position.set(-1.4,1.8,-.1);o.tool.rotation.z=a.holdAt===null?.12:-.7;const height=.12+Math.min(1,a.amount)*1.45,level=(.45+height)/1.6,profile=[[.09,.04],[.11,.72],[.2,1.12],[.65,1.47],[1.15,1.62],[1.3,1.72]];let radius=.8;for(let i=1;i<profile.length;i++){const [y1,r1]=profile[i],[y0,r0]=profile[i-1];if(level<=y1){radius=r0+(r1-r0)*(level-y0)/(y1-y0);break;}}o.liquid!.scale.set(radius*1.1*.92,height,radius*1.1*.92);o.stream!.visible=a.holdAt!==null;}
   if(s.kind==='fold'){o.flaps.forEach((g,i)=>{g.rotation.z=i<a.count?-.85:0;g.visible=i<a.count;});o.tool.position.copy(pos??new Vector3(2.4,1.3,BOARD_DEPTH+.5));}
   if(s.kind==='plate'){o.food.forEach((g,i)=>{g.visible=i<a.count;if(g.visible){const p=plateTarget({...run,active:{...a,count:i}});o.body.updateMatrixWorld(true);g.position.copy(o.body.worldToLocal(screen(p.x,p.y,BOARD_DEPTH+.45)));}});o.tool.position.copy(pos??new Vector3(-3.5,.35,BOARD_DEPTH+.6));o.tool.visible=a.count<s.goal;}
   o.flames.forEach((f,i)=>{f.scale.y=.3+a.heat/100*.6+(motion?Math.sin(t*5+i)*.04:0);});foodBatch?.update();updateAmbient();
   // Mixing has no time-driven animation: only the stir angle and pointer move
   // its food/tool. Keep the presented frame until one of those inputs changes.
   if(s.kind==='mix'&&lastMix&&lastMix.amount===a.amount&&lastMix.x===point?.x&&lastMix.y===point?.y)return;
   if(s.kind==='knead'&&lastKnead&&lastKnead.held===held&&lastKnead.motion===motion)return;
   // These scenes have no ambient animation. Retain their actual rendered frame
   // until a visible gesture, placement, knife pulse or liquid level changes.
   const staticKey=s.kind==='slice'?`slice/${a.count}/${point?.x}/${point?.y}/${motion?pulse:0}`
    :s.kind==='fold'||s.kind==='plate'?`${s.kind}/${a.count}/${point?.x}/${point?.y}`
    :s.kind==='pour'?`pour/${a.amount}/${a.holdAt!==null}`
    :s.kind==='bake'?`bake/${a.amount}`:null;
   if(staticKey!==null&&staticKey===lastStatic)return;
   render(s.kind!=='bake'||lastBakeToolVisible!==o.tool.visible);
   lastBakeToolVisible=s.kind==='bake'?o.tool.visible:null;
   lastStatic=staticKey;
   lastKnead=s.kind==='knead'?{held,motion}:null;
   lastMix=s.kind==='mix'?{amount:a.amount,x:point?.x,y:point?.y}:null;
  }
  return {update,resize:(nextViewport:KitchenViewport,paint=true)=>{if(disposed)return;viewport=nextViewport;const next=kitchenPresentation(viewport,zoom);if(presentation&&Object.keys(next).every(key=>next[key as keyof typeof next]===presentation![key as keyof typeof next]))return;presentation=next;renderer.setSize(next.width,next.height,false);if(paint)render(false);},capture:()=>{if(disposed)throw Error('料理畫面已關閉');try{renderer.setSize(V.width,V.height,false);renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);return renderer.domElement.toDataURL('image/png');}finally{renderer.setSize(presentation?.width??V.width,presentation?.height??V.height,false);render();}},stats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),dispose};
 }catch(error){dispose();throw error;}
}
