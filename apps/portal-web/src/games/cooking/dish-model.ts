import {Box3,CatmullRomCurve3,CylinderGeometry,DataTexture,DoubleSide,ExtrudeGeometry,Group,LatheGeometry,Mesh,MeshPhysicalMaterial,NearestFilter,RedFormat,Shape,SphereGeometry,TorusGeometry,TubeGeometry,Vector2,Vector3,type BufferGeometry,type Material,type Texture} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {bakeRigidGroup} from '../stage-batch';
import {FoodKit,foodTexture} from './food-kit';
import {marketFood,displayMarket} from './market-food';
import {marketOf,type MarketRun} from './market-domain';
import {dishDesign} from './dish-designs';
import {ceramicPlateGeometry,ironPlatterGeometry,ironEarGeometry,servingBoardGeometry,cutletGeometry} from './food-geometry';

export type DishModel={root:Group;dispose:()=>void;geometries:ReadonlySet<BufferGeometry>};
export type {Mesh as DishMesh} from 'three';

/** UX-8: original bounded food assemblies. Smooth rice, material-specific gloss, no surface glitter. */
export function createDishModel(recipeId:string,snapshot?:MarketRun):DishModel{
 const market=marketOf(recipeId);if(market){const kit=new FoodKit(),food=marketFood(snapshot??displayMarket(market),kit);const geometries=new Set([...kit.geometries,...food.geometries]);return {root:food.root,geometries,dispose:()=>{food.dispose();kit.dispose();}};}
 const design=dishDesign(recipeId),root=new Group(),geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
 let disposed=false;const dispose=()=>{if(disposed)return;disposed=true;geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());root.clear();};
 try{
 const own=<T extends BufferGeometry>(g:T)=>{geometries.add(g);return g;};
 const round=own(new RoundedBoxGeometry(1,1,1,3,.16)),sphere=own(new SphereGeometry(1,24,16)),cylinder=own(new CylinderGeometry(1,1,1,32)),dome=own(new SphereGeometry(1,28,14,0,Math.PI*2,0,Math.PI/2)),ring=own(new TorusGeometry(1,.12,10,40)),cone=own(new CylinderGeometry(.7,1,1,28));
 const drinkFill=own(new CylinderGeometry(.85,.72,1,32)),doughnut=own(new TorusGeometry(1,.44,12,40));
 const triangleShape=new Shape();triangleShape.moveTo(-.7,0);triangleShape.quadraticCurveTo(-1,0,-.8,.3);triangleShape.lineTo(-.14,1.35);triangleShape.quadraticCurveTo(0,1.55,.14,1.35);triangleShape.lineTo(.8,.3);triangleShape.quadraticCurveTo(1,0,.7,0);triangleShape.closePath();
 const triangle=own(new ExtrudeGeometry(triangleShape,{depth:.65,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.11,bevelThickness:.1}));
 const bowl=own(new LatheGeometry([new Vector2(0,0),new Vector2(.75,0),new Vector2(1.2,.22),new Vector2(1.65,.75),new Vector2(1.8,1.12),new Vector2(1.73,1.18),new Vector2(1.56,.8),new Vector2(1.14,.3),new Vector2(.6,.13),new Vector2(0,.13)],40));
 const cup=own(new LatheGeometry([new Vector2(0,0),new Vector2(.76,0),new Vector2(.93,2.4),new Vector2(.85,2.43),new Vector2(.69,.14),new Vector2(0,.14)],36));
 const surface=foodTexture(['rice','onigiri'].includes(design.family)?'rice':['pancake','pizza','sandwich','toast','doughnut','cookies','tart','waffle','cupcake'].includes(design.family)?'bread':'food'),woodSurface=foodTexture('wood');textures.add(surface);textures.add(woodSurface);
 const palette=new Map<string,MeshPhysicalMaterial>();
 function mat(color:string,glass=false){const key=color+(glass?'/glass':'');let m=palette.get(key);if(!m){const ceramic=['#f2eadb','#426d73','#eadfbd','#f6e9c9','#7b9e91','#81aaa0','#eadfba','#b8c6b2','#99b4a4','#9bbcb0','#d8dfcc'].includes(color),iron=color==='#25272a',wood=['#c69b70','#d6ad7e','#9b734f','#cba67c'].includes(color),map=wood?woodSurface:surface;m=new MeshPhysicalMaterial({color,...(!ceramic&&!iron?{map,bumpMap:map,bumpScale:.006}:{}),metalness:iron?.6:0,roughness:iron?.65:glass?.12:ceramic?.2:wood?.95:.59,clearcoat:wood?0:iron?.12:glass||ceramic?.8:.28,clearcoatRoughness:glass||ceramic?.18:.3,side:DoubleSide,...(glass?{transparent:true,opacity:.24,depthWrite:false}: {})});palette.set(key,m);materials.add(m);}return m;}
 const group=(parent=root,x=0,y=0,z=0)=>{const g=new Group();g.position.set(x,y,z);parent.add(g);return g;};
 function mesh(parent:Group,g:BufferGeometry,color:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx){const m=new Mesh(g,mat(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
 const rb=(p:Group,c:string,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>mesh(p,round,c,x,y,z,sx,sy,sz);
 const ball=(p:Group,c:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx)=>mesh(p,sphere,c,x,y,z,sx,sy,sz);
 const disk=(p:Group,c:string,x:number,y:number,z:number,r:number,h:number,rz=r)=>mesh(p,cylinder,c,x,y,z,r,h,rz);
 const torus=(p:Group,c:string,x:number,y:number,z:number,r:number)=>{const m=mesh(p,ring,c,x,y,z,r);m.rotation.x=-Math.PI/2;return m;};
 const leaf=(p:Group,x:number,y:number,z:number,angle=0,c=design.accent)=>{const l=ball(p,c,x,y,z,.2,.045,.45);l.rotation.y=angle;return l;};
 function sprig(p:Group,x:number,y:number,z:number){for(let i=0;i<3;i++)leaf(p,x+(i-1)*.17,y+.02*i,z+(i%2)*.18,(i-1)*.6);}
 let servingFloor:number|null=null;
 function plate(wood=false){
  if(family==='steak'){
   mesh(root,own(servingBoardGeometry()),'#c69b70',0,0,0,1);mesh(root,own(ironPlatterGeometry()),'#25272a',0,0,0,2.4,1,1.5);const ear=own(ironEarGeometry());for(const side of [-1,1])mesh(root,ear,'#25272a',side*2.4,.23,0,1);servingFloor=.15;
  }else if(wood){mesh(root,own(servingBoardGeometry()),'#c69b70',0,0,0,1);servingFloor=.12;}
  else{const p=new Mesh(own(ceramicPlateGeometry()),[mat('#f2eadb'),mat('#426d73')]);p.scale.set(2.35,1,1.85);p.castShadow=p.receiveShadow=true;root.add(p);servingFloor=.085;}
 }
 function vessel(soupColor=design.base){mesh(root,bowl,'#81aaa0',0,.04,0,1.16,.95,1.02);torus(root,'#eadfba',0,1.13,0,2.02).scale.z=.89;disk(root,soupColor,0,.91,0,1.73,.08,1.54);}
 function egg(p:Group,x:number,y:number,z:number){ball(p,'#f2e3bc',x,y,z,.64,.09,.48);ball(p,'#e7b44e',x+.04,y+.12,z,.26,.12,.25);}
 function mushroom(p:Group,x:number,y:number,z:number,s=.4){mesh(p,cylinder,'#e3caa2',x,y,z,s*.32,s*.65,s*.3);mesh(p,dome,design.top,x,y+s*.28,z,s,s*.6,s*.85);}
 function berry(p:Group,x:number,y:number,z:number,s=.24){const b=ball(p,design.accent,x,y,z,s,s*1.15,s*.85);b.rotation.z=.2;leaf(p,x,y+s,z,0,'#70916a').scale.set(.14,.03,.16);}
 function chunks(p:Group,color:string,y:number,count=5,size=.36){for(let i=0;i<count;i++){const a=i*Math.PI*2/count+.3,r=count===1?0:.85;const m=rb(p,color,Math.cos(a)*r,y,Math.sin(a)*r,size,size*.7,size*.8);m.rotation.y=a*.7;}}
 function noodles(p:Group,color:string,y:number){for(let i=0;i<5;i++){const points=[];for(let j=0;j<9;j++){const a=j/8*Math.PI*2+i*.4;points.push(new Vector3(Math.cos(a)*(1.1-i*.09),y+.06*Math.sin(j*1.4+i),Math.sin(a)*(.75-i*.04)));}const geometry=own(new TubeGeometry(new CatmullRomCurve3(points),32,.085,7,false));mesh(p,geometry,color,0,0,0,1);}}
 const family=design.family;
 if(['rice','noodles','soup','salad','curry'].includes(family))vessel();else if(!['glass','mug','sundae'].includes(family))plate(['sushi','onigiri','rolls','sandwich','toast'].includes(family));
 const dinnerware=new Set(root.children);

 if(family==='rice'){
  ball(root,design.base,0,.86,0,1.56,.62,1.27);
  if(design.detail.includes('curry')){ball(root,design.top,.5,1.14,.24,1.1,.16,.88);chunks(root,design.accent,1.34,4,.45);}
  else if(design.detail.includes('mushroom'))for(const [x,z]of [[-.7,-.3],[.5,.1],[-.4,.6]])mushroom(root,x,1.43,z,.42);
  else chunks(root,design.top,1.39,design.detail==='fried'?6:5,design.detail==='pork'?.4:.29);
  if(design.detail.includes('egg'))egg(root,0,1.56,-.1);sprig(root,-.7,1.44,-.47);
  if(design.detail==='egg-greens')for(let i=0;i<4;i++)leaf(root,.9,1.42,(i-1.5)*.3,-.9);
 }
 else if(family==='noodles'){
  noodles(root,'#e7c47e',1.05);for(let i=0;i<3;i++){const m=ball(root,design.top,(i-1)*.62,1.2,-.54,.45,.12,.38);m.rotation.y=-.3;rb(root,'#dfb08a',(i-1)*.62,1.33,-.54,.4,.018,.035);}
  if(design.detail==='ramen'){ball(root,'#f3e2b9',1.02,1.23,.45,.46,.15,.55);ball(root,'#dbac55',1.02,1.38,.45,.22,.04,.28);rb(root,'#416451',-1.13,1.45,-.25,.5,.85,.07).rotation.z=.2;}sprig(root,-.8,1.2,.6);
 }
 else if(family==='soup'){
  if(design.detail==='pumpkin'){for(let i=0;i<3;i++){const r=torus(root,design.top,0,1.01,0,.3+i*.23);r.scale.z=.75;}sprig(root,.65,1.08,-.2);}
  else{for(const [x,z]of [[-.8,-.4],[.5,-.3],[-.25,.5]])rb(root,design.top,x,1.04,z,.58,.35,.5);for(const [x,z]of [[-.95,.65],[.9,.4],[0,-.8]])leaf(root,x,1.02,z,.7);}
 }
 else if(family==='sushi'){
  for(const [x,z]of [[-.88,-.45],[.65,-.55],[-.6,.68],[.9,.57]]){const g=group(root,x,.34,z);ball(g,design.base,0,.2,0,.61,.3,.4);rb(g,design.top,0,.51,0,1.12,.17,.73);for(const q of [-.35,0,.35])rb(g,'#edc5a0',q,.605,0,.065,.018,.65).rotation.y=-.3;}sprig(root,1.65,.4,-1);
 }
 else if(family==='onigiri'){
  for(const [x,z,a]of [[-.8,.1,-.2],[.82,-.1,.22]]){const g=group(root,x,.34,z);mesh(g,triangle,design.base,0,0,-.35,1);rb(g,design.top,0,.28,.45,.67,.59,.09);leaf(g,.4,1.05,.28,.6,design.accent);}
 }
 else if(family==='pancake'){
  disk(root,design.base,0,.4,0,1.67,.25,1.3);disk(root,design.top,0,.55,0,1.24,.04,1);
  for(let i=0;i<5;i++){leaf(root,Math.cos(i*1.3),.6,Math.sin(i*1.3)*.75,i*.6);if(design.detail==='seafood'||design.detail==='oyster')ball(root,'#dec9a4',Math.cos(i*1.5)*.8,.65,Math.sin(i*1.5)*.65,.24,.12,.2);}
  if(design.detail==='scallion'){for(const x of [-.65,0,.65])rb(root,'#aa7e51',x,.58,0,.026,.025,2.15).rotation.y=.4;}
 }
 else if(family==='bites'||family==='meatballs'){
  if(family==='meatballs'||['rice-cake','glazed','beef'].includes(design.detail))disk(root,design.top,0,.36,0,1.6,.1,1.2);
  for(let i=0;i<7;i++){const a=i*2.4,r=.38+Math.floor(i/3)*.4,x=Math.cos(a)*r,z=Math.sin(a)*r,y=.6+(i>4?.35:0);if(design.detail==='rice-cake'||design.detail==='fish-cake'){const m=rb(root,design.base,x,y,z,.45,.35,.9);m.rotation.y=a;}else{const b=ball(root,design.base,x,y,z,.45,.34,.39);b.rotation.y=a;if(design.detail==='glazed')ball(root,design.top,x,y+.25,z,.32,.06,.28);}}sprig(root,1.32,.52,-.8);
 }
 else if(family==='pizza'){
  disk(root,design.base,0,.43,0,1.75,.25);disk(root,design.top,0,.58,0,1.54,.07);torus(root,'#e8ba77',0,.59,0,1.61);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;ball(root,'#eddbac',Math.cos(a),.64,Math.sin(a),.39,.06,.31);leaf(root,Math.cos(a+.3)*.73,.74,Math.sin(a+.3)*.73,a,design.accent);}
 }
 else if(family==='pasta'||family==='bowties'){
  if(family==='pasta'){noodles(root,design.base,.47);for(let i=0;i<4;i++)ball(root,design.top,Math.cos(i*1.7)*.6,.56,Math.sin(i*1.7)*.6,.43,.1,.32);}
  else for(let i=0;i<8;i++){const a=i*2.4,g=group(root,Math.cos(a)*(i%3)*.52,.5+Math.floor(i/4)*.13,Math.sin(a)*.85);g.rotation.y=a;for(const side of [-1,1]){const f=mesh(g,cone,design.base,side*.22,0,0,.35,.25,.35);f.rotation.z=side*Math.PI/2;}rb(g,design.top,0,.1,0,.16,.2,.4);}
  sprig(root,.55,.72,-.65);chunks(root,'#e5cda2',.6,3,.14);
 }
 else if(family==='lasagna'||family==='brownie'||family==='cake'){
  const cake=family==='cake',roundCake=cake&&design.detail==='strawberry';
  for(let i=0;i<(family==='lasagna'?5:cake?4:2);i++){const c=i%2?design.top:design.base;if(roundCake)disk(root,c,0,.43+i*.29,0,1.35,.29);else rb(root,c,0,.42+i*.23,0,2.7,.24,1.9);}
  const top=family==='lasagna'?1.53:cake?1.5:.78;
  if(roundCake){disk(root,design.top,0,top,0,1.36,.13);for(let i=0;i<5;i++)berry(root,Math.cos(i*1.26)*.95,top+.26,Math.sin(i*1.26)*.95,.23);}
  else if(family==='lasagna'){rb(root,design.accent,0,top,0,2.6,.08,1.8);for(const x of [-.8,0,.8])rb(root,'#bb8c56',x,top+.055,0,.12,.016,1.4);sprig(root,.8,top+.1,-.2);}
  else if(family==='brownie'){for(const x of [-.75,0,.75])for(const z of [-.45,.45])rb(root,design.top,x,.8,z,.25,.08,.2);}
  else{rb(root,design.top,0,top-.2,0,2.7,.13,1.9);for(let i=0;i<3;i++)ball(root,'#e8d9b5',(i-1)*.65,top,.1,.22,.16,.22);}
 }
 else if(family==='vegetables'||family==='skewers'){
  for(let row=0;row<3;row++){const g=group(root,(row-1)*.8,.4,0);g.rotation.y=(row-1)*.2;if(family==='skewers'){const stick=mesh(g,cylinder,'#b48a5a',0,.1,.1,.035,3.1,.035);stick.rotation.x=Math.PI/2;}
   for(let i=0;i<3;i++){const c=[design.top,design.accent,'#d8bb72'][(i+row)%3],m=rb(g,c,0,.25,(i-1)*.7,.64,.43,.59);m.rotation.y=i*.25;if(i===1)mushroom(g,0,.28,0,.32);}}
 }
 else if(family==='rolls'){
  for(let i=0;i<6;i++){const g=group(root,(i%3-1)*.91,.38,(Math.floor(i/3)-.5)*1.05);if(design.detail==='egg'){rb(g,design.base,0,.24,0,.77,.48,.83);rb(g,design.top,0,.49,0,.51,.015,.52);}
   else{disk(g,design.top,0,.22,0,.43,.43);disk(g,design.base,0,.45,0,.36,.035);for(const [x,z,c]of [[-.12,0,design.accent],[.11,.1,'#df975f'],[0,-.16,'#7f9e6b']] as const)rb(g,c,x,.48,z,.18,.02,.21);}}
 }
 else if(family==='burger'){
  disk(root,design.base,0,.42,0,1.26,.35);for(let i=0;i<6;i++)leaf(root,Math.cos(i*1.05)*.9,.66,Math.sin(i*1.05)*.9,i,design.accent).scale.multiplyScalar(1.6);
  disk(root,design.top,0,.85,0,1.17,.29);rb(root,'#e9be60',0,1.02,0,2.26,.08,1.75).rotation.y=.35;disk(root,'#ce8065',0,1.13,0,1.09,.12);mesh(root,dome,design.base,0,1.21,0,1.25,.78,1.15);
 }
 else if(family==='fish-chips'){
  if(design.detail==='shrimp')for(let i=0;i<3;i++){const g=group(root,(i-1)*.7,.42,(i%2-.5)*.5);g.rotation.y=(i-1)*.3;ball(g,design.base,0,.18,0,.35,.23,.9);for(const side of [-1,1])leaf(g,side*.12,.17,-.87,side*.6,design.top);}
  else{ball(root,design.base,-.6,.55,0,.7,.29,1.17);for(let i=0;i<5;i++)rb(root,design.top,.65+(i%2)*.37,.43+Math.floor(i/3)*.2,(i-2)*.31,.2,.23,1.15).rotation.y=-.4;}
  const lemon=disk(root,'#e1c56e',1.32,.45,.85,.4,.12);lemon.rotation.z=.15;sprig(root,-1.4,.43,.8);
 }
 else if(family==='steak'){
  mesh(root,own(cutletGeometry()),design.base,-.35,.53,0,.95,.85,.95);for(let i=0;i<4;i++)rb(root,'#76533e',-.95+i*.38,.82,0,.06,.018,1.2).rotation.y=-.45;
  for(let i=0;i<3;i++)ball(root,design.top,1.18,.48,(i-1)*.6,.44,.25,.34);sprig(root,-.8,.84,-.5);
 }
 else if(family==='spring-rolls'){
  for(let i=0;i<3;i++){const g=group(root,(i-1)*.98,.56,0);g.rotation.y=-.18;rb(g,design.base,0,0,0,.74,.52,2.2);for(let j=0;j<3;j++){leaf(g,0,.28,(j-1)*.6,.2,design.accent);ball(g,design.top,0,.34,(j-1)*.6,.2,.06,.24);}}sprig(root,-1.5,.37,1.05);
 }
 else if(family==='paella'){
  disk(root,'#657773',0,.36,0,1.9,.25,1.5);for(const side of [-1,1])torus(root,'#657773',side*2,.4,0,.28);ball(root,design.base,0,.55,0,1.7,.3,1.3);
  for(let i=0;i<4;i++){const a=i*1.57;const shrimp=ball(root,design.top,Math.cos(a)*1.05,.78,Math.sin(a)*.8,.45,.14,.22);shrimp.rotation.y=a;ball(root,'#506a69',Math.cos(a+.8)*.8,.8,Math.sin(a+.8)*.7,.24,.17,.37);}sprig(root,0,.83,0);
 }
 else if(family==='curry'){for(let i=0;i<5;i++){const a=i*1.25;rb(root,design.top,Math.cos(a),1.06,Math.sin(a)*.7,.65,.42,.52);}torus(root,'#e6c491',0,1.1,0,.78).scale.z=.6;sprig(root,.3,1.23,0);}
 else if(family==='sandwich'||family==='toast'){
  if(family==='toast'){rb(root,design.base,0,.4,0,2.6,.3,2);rb(root,'#e4c397',0,.57,0,2.3,.04,1.75);for(let i=0;i<6;i++){const a=ball(root,design.top,(i-2.5)*.32,.68,0,.3,.11,.73);a.rotation.y=-.3;}berry(root,.85,.79,.5,.22);}
  else if(design.detail==='taco'){for(const side of [-1,1]){const shell=ball(root,design.base,side*.55,.8,0,.17,.8,1.18);shell.rotation.z=-side*.3;}chunks(root,design.top,.94,5,.36);for(let i=0;i<4;i++)leaf(root,(i-1.5)*.25,1.05,(i%2-.5)*.6,i);}
  else for(const x of [-.8,.8]){const g=group(root,x,.4,0);for(let layer=0;layer<5;layer++){const c=[design.base,design.accent,design.top,'#b47d5e',design.base][layer];const m=mesh(g,triangle,c,0,layer*.2,-.65,.88,.88,.22);m.rotation.x=-Math.PI/2;}rb(g,'#be9867',0,.9,0,.05,.8,.05);}
 }
 else if(['doughnut','macaron','cookies','cupcake','tart','waffle'].includes(family)){
  if(family==='waffle'){rb(root,design.base,0,.46,0,2.8,.3,2.3);for(let i=0;i<5;i++){rb(root,design.top,(i-2)*.48,.63,0,.06,.03,2.1);rb(root,design.top,0,.63,(i-2)*.4,2.6,.03,.055);}for(let i=0;i<4;i++)berry(root,Math.cos(i*1.6)*.75,.79,Math.sin(i*1.6)*.55,.22);ball(root,'#e9d8b1',0,.83,0,.35,.21,.32);}
  else for(let i=0;i<3;i++){const x=(i-1)*1.15,z=i%2?.55:-.35,g=group(root,x,.35,z);
   if(family==='doughnut'){mesh(g,doughnut,design.base,0,.21,0,.43).rotation.x=-Math.PI/2;mesh(g,doughnut,i===1?'#e1c690':design.top,0,.31,0,.43,.29,.43).rotation.x=-Math.PI/2;for(let j=0;j<4;j++)rb(g,design.accent,Math.cos(j*1.57)*.47,.35,Math.sin(j*1.57)*.47,.12,.04,.05).rotation.y=j*.7;}
   if(family==='macaron'){const c=[design.base,design.top,design.accent][i];ball(g,c,0,.41,0,.55,.19,.48);disk(g,'#e8d7b2',0,.24,0,.51,.13,.44);ball(g,c,0,.1,0,.55,.15,.48);}
   if(family==='cookies'){disk(g,design.base,0,.08,0,.6,.18,.52);for(let j=0;j<5;j++)rb(g,design.top,Math.cos(j*1.26)*.35,.19,Math.sin(j*1.26)*.3,.13,.05,.12);}
   if(family==='cupcake'){mesh(g,cone,'#c8aa89',0,.38,0,.57,.72,.55);disk(g,design.base,0,.77,0,.59,.15,.56);for(let j=0;j<3;j++)ball(g,i%2?design.accent:design.top,0,.89+j*.15,0,.49-j*.11,.18,.46-j*.1);berry(g,0,1.3,0,.14);}
   if(family==='tart'){disk(g,design.base,0,.15,0,.6,.3,.54);torus(g,'#c29461',0,.3,0,.51).scale.z=.9;disk(g,design.top,0,.32,0,.46,.06,.4);}
  }
 }
 else if(family==='glass'||family==='mug'){
  // Glass has one restrained transparent shell. Drinks and fruit are real interior meshes.
  const shell=new Mesh(cup,mat(family==='glass'?'#d8dfcc':'#9bbcb0',family==='glass'));root.add(shell);shell.castShadow=false;
  mesh(root,drinkFill,design.base,0,1.02,0,1,1.93,1);torus(root,'#b8c6b2',0,2.4,0,.9);
  if(family==='mug'){const handle=mesh(root,ring,'#9bbcb0',1.02,1.28,0,.68);handle.rotation.y=Math.PI/2;disk(root,design.top,0,2.02,0,.8,.06);if(design.detail==='marshmallow')for(const [x,z]of [[-.35,-.2],[.3,-.12],[0,.37]])rb(root,design.top,x,2.17,z,.4,.28,.38);else{torus(root,'#c1d0a0',0,2.07,0,.43);leaf(root,0,2.1,0,.4,design.accent);}}
  else{const straw=mesh(root,cylinder,'#cb7959',.35,2.1,-.2,.055,2.1,.055);straw.rotation.z=-.12;if(design.detail==='pearls')for(let i=0;i<7;i++){const a=-.65+i*.23;ball(root,design.top,Math.sin(a)*.75,.26+(i%2)*.2,Math.cos(a)*.75,.14);}else for(let i=0;i<4;i++){const a=-.3+i*.42,f=disk(root,design.top,Math.sin(a)*.78,.65+(i%3)*.42,Math.cos(a)*.78,.24,.1);f.rotation.x=Math.PI/2;f.rotation.z=i*.4;}if(design.detail==='citrus'){const f=disk(root,design.top,.68,2.37,0,.4,.11);f.rotation.z=Math.PI/2;sprig(root,-.2,2.1,0);}}
  disk(root,'#cba67c',0,-.05,0,1.22,.1);
 }
 else if(family==='pudding'){mesh(root,cone,design.base,0,.85,0,1.2,1.15,1.02);disk(root,design.top,0,1.44,0,.86,.07,.73);ball(root,design.accent,.2,1.55,0,.32,.16,.28);leaf(root,.42,1.65,.1,.4,'#71996b');}
 else if(family==='sundae'||family==='ice'){
  if(family==='sundae'){mesh(root,bowl,'#99b4a4',0,.52,0,.8,.8,.8);disk(root,'#99b4a4',0,.2,0,.2,.8);disk(root,'#c7b18e',0,-.12,0,.9,.16);}
  const h=family==='sundae'?1.4:.55;ball(root,design.base,0,h,0,1.2,.8,1);if(family==='ice'){chunks(root,design.top,1.1,7,.44);ball(root,design.top,0,1.37,0,.48,.35,.44);}
  else{ball(root,design.top,-.55,2,0,.63,.62,.6);ball(root,design.base,.5,2.05,.05,.64,.6,.6);ball(root,design.accent,0,2.55,0,.58,.56,.55);berry(root,0,3.11,0,.2);rb(root,'#d2a570',.8,2.7,-.2,.15,1.6,.24).rotation.z=-.3;}
 }
 else if(family==='salad'){for(let i=0;i<8;i++){const a=i*Math.PI/4;const l=leaf(root,Math.cos(a)*.8,1.1+(i%2)*.13,Math.sin(a)*.8,a,design.base);l.scale.multiplyScalar(1.8);}chunks(root,design.top,1.35,4,.35);chunks(root,design.accent,1.4,3,.25);}
 else if(family==='sweet-potato'){for(const x of [-.72,.72]){ball(root,design.base,x,.55,0,.6,.37,1.3);ball(root,design.top,x,.8,0,.48,.09,1.08);rb(root,design.accent,x,.91,.1,.43,.16,.4);}sprig(root,0,.47,1.2);}

 if(servingFloor!==null){const meal=new Group();for(const child of [...root.children])if(!dinnerware.has(child))meal.add(child);if(meal.children.length){root.add(meal);meal.position.y=servingFloor-new Box3().setFromObject(meal).min.y;}}
 root.userData.recipeId=recipeId;root.userData.family=family;
 // Glass remains separately sorted; all opaque rigid food can share per-colour draws.
 const transparent=new Set<Group|Mesh>();root.traverse(o=>{if(o instanceof Mesh&&Array.isArray(o.material)===false&&(o.material as Material).transparent)transparent.add(o);});
 bakeRigidGroup(root,geometries,transparent);
 return {root,geometries,dispose};
 }catch(cause){dispose();throw cause;}
}
