import {BoxGeometry,Color,CylinderGeometry,DataTexture,DirectionalLight,DoubleSide,Group,HemisphereLight,LatheGeometry,Mesh,MeshToonMaterial,NearestFilter,NoToneMapping,OrthographicCamera,PCFShadowMap,Plane,Raycaster,RedFormat,Scene,SphereGeometry,TorusGeometry,Vector2,Vector3,WebGLRenderer,type BufferGeometry,type Material,type Texture} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {bakeRigidGroup} from '../stage-batch';
import {currentStep,cutGuide,plateTarget,type CookingRun} from './domain';
import {KITCHEN_VIEW as V,type Shape} from './catalog';

export type KitchenStage={update:(run:CookingRun,point:{x:number;y:number}|null,time:number,motion:boolean)=>void;dispose:()=>void;stats:()=>{calls:number;triangles:number;geometries:number;textures:number}};
const C={ink:'#393d40',wood:'#dfab72',edge:'#a86d42',cream:'#fff0d1',mint:'#78b9a5',red:'#e87455',gold:'#f2bb55',dark:'#555b61'};
const foodColors:Record<Shape,string>={greens:'#67a46f',carrot:'#efa052',meat:'#d68b77',rice:'#f1cb77',dough:'#f0d09a',noodle:'#e8bf70',egg:'#edb541',fruit:'#e66e68',cream:'#f2e4c8',chocolate:'#855b48',fish:'#e9987d'};

/** UX-7: original, matte toy kitchen. Rendered food never mutates cooking rules. */
export function createKitchenStage(host:HTMLElement,onLost:()=>void):KitchenStage{
 const renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'}),geometries=new Set<BufferGeometry>(),stepGeometry=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
 let disposed=false,identity='',objects:{food:Group[];tool:Group;body:Group;steam:Mesh[];flaps:Group[];liquid:Mesh|null;stream:Mesh|null;flames:Mesh[]}|null=null;
 const light=new DirectionalLight('#fff5db',1.65),lost=(e:Event)=>{e.preventDefault();if(!disposed)onLost();};
 const dispose=()=>{if(disposed)return;disposed=true;renderer.domElement.removeEventListener('webglcontextlost',lost);stepGeometry.forEach(g=>g.dispose());geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());light.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
 try{
  renderer.setSize(V.width,V.height,false);renderer.setPixelRatio(Math.min(devicePixelRatio||1,V.maxDpr));renderer.toneMapping=NoToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.addEventListener('webglcontextlost',lost);host.append(renderer.domElement);
  const scene=new Scene();scene.background=new Color('#eabf91');const camera=new OrthographicCamera(-4.65,4.65,3.255,-3.255,.1,40);camera.position.set(0,8.5,8.5);camera.lookAt(0,0,0);scene.add(new HemisphereLight('#fff8e9','#9c8b76',1.25));light.position.set(-4,9,5);light.castShadow=true;light.shadow.mapSize.set(V.shadowSize,V.shadowSize);Object.assign(light.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:25});light.shadow.normalBias=.04;scene.add(light);
  const gradient=new DataTexture(new Uint8Array([120,200,255]),3,1,RedFormat);gradient.minFilter=NearestFilter;gradient.magFilter=NearestFilter;gradient.needsUpdate=true;textures.add(gradient);
  const own=<T extends BufferGeometry>(g:T)=>{geometries.add(g);return g;},round=own(new RoundedBoxGeometry(1,1,1,3,.17)),sphere=own(new SphereGeometry(1,24,16)),cylinder=own(new CylinderGeometry(1,1,1,32)),cone=own(new CylinderGeometry(.12,1,1,24)),torus=own(new TorusGeometry(1,.08,10,40)),box=own(new BoxGeometry(1,1,1));
  const bowl=own(new LatheGeometry([new Vector2(.04,0),new Vector2(.8,.02),new Vector2(1.2,.2),new Vector2(1.55,.65),new Vector2(1.7,1.15),new Vector2(1.8,1.3)],40));
  const palette=new Map<string,MeshToonMaterial>();function mat(color:string){let m=palette.get(color);if(!m){m=new MeshToonMaterial({color,gradientMap:gradient,side:DoubleSide});palette.set(color,m);materials.add(m);}return m;}
  const group=(p:Group,x=0,y=0,z=0)=>{const g=new Group();g.position.set(x,y,z);p.add(g);return g;};
  function mesh(p:Group,g:BufferGeometry,color:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx){const m=new Mesh(g,mat(color));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=m.receiveShadow=true;p.add(m);return m;}
  const rb=(p:Group,c:string,x:number,y:number,z:number,xs:number,ys:number,zs:number)=>mesh(p,round,c,x,y,z,xs,ys,zs);
  const ball=(p:Group,c:string,x:number,y:number,z:number,xs:number,ys=xs,zs=xs)=>mesh(p,sphere,c,x,y,z,xs,ys,zs);
  const ring=(p:Group,c:string,x:number,y:number,z:number,r:number)=>{const m=mesh(p,torus,c,x,y,z,r,r,r);m.rotation.x=-Math.PI/2;return m;};
  const world=new Group(),set=new Group(),work=new Group();scene.add(world);world.add(set,work);
  rb(set,'#d5a16c',0,-.45,0,11,.6,9);rb(set,'#efc896',0,-.12,0,10.7,.13,8.7);for(const z of [-3,-1.5,0,1.5,3])rb(set,'#dcb484',0,-.042,z,10.7,.012,.018);
  // Large, legible shelf props; no dense texture noise or specular specks.
  const towel=group(set,-3.6,.02,1.9);rb(towel,'#f7e3be',0,0,0,1.1,.08,2.5);for(const x of [-.32,0,.32])rb(towel,C.red,x,.05,0,.08,.02,2.35);
  for(const [i,color]of [C.mint,C.red,C.gold].entries()){const b=group(set,2.8+i*.42,0,-2.5);mesh(b,cylinder,color,0,.35,0,.18,.7,.18);rb(b,C.cream,0,.35,.18,.24,.3,.035);mesh(b,cylinder,C.dark,0,.77,0,.14,.15,.14);}
  // The guide is an original mitten-like kitchen cat, rather than a human hand sprite.
  const cat=group(set,-3.4,.2,-2.65);ball(cat,C.mint,0,.45,0,.5,.5,.4);for(const side of [-1,1]){const ear=mesh(cat,cone,C.mint,side*.3,.93,0,.19,.35,.18);ear.rotation.z=-side*.2;ball(cat,C.ink,side*.17,.51,.36,.04,.065,.025);}ball(cat,C.red,0,.35,.4,.055,.04,.035);rb(cat,C.cream,0,.04,.05,.72,.24,.5);bakeRigidGroup(set,geometries);
  const ray=new Raycaster(),ground=new Plane(new Vector3(0,1,0),-.3),intersection=new Vector3();
  function screen(x:number,y:number,height=.3){ray.setFromCamera(new Vector2(x*2-1,1-y*2),camera);ground.constant=-height;return ray.ray.intersectPlane(ground,intersection)?.clone()??new Vector3();}
  function food(p:Group,shape:Shape,size=1){const g=group(p),color=foodColors[shape];
   if(shape==='carrot'){mesh(g,cone,color,0,.24,0,.3,.55,.3);for(const side of [-1,1]){const l=ball(g,'#6b9e62',side*.1,.59,0,.09,.25,.06);l.rotation.z=-side*.4;}}
   else if(shape==='greens'){for(let i=0;i<3;i++){const leaf=ball(g,i%2?'#8db878':color,(i-1)*.16,.17,0,.22,.09,.44);leaf.rotation.y=(i-1)*.55;}rb(g,'#b7c58d',0,.12,.18,.06,.07,.6);}
   else if(shape==='rice'){ball(g,color,0,.19,0,.4,.28,.35);for(let i=0;i<3;i++)rb(g,i%2?'#7ca571':'#e8a15e',(i-1)*.2,.36,Math.sin(i)*.15,.14,.07,.13);}
   else if(shape==='noodle'){for(let i=0;i<3;i++){const t=ring(g,color,(i-1)*.09,.13+i*.08,0,.28+i*.04);t.scale.z=.7;}rb(g,'#79a66f',.19,.35,.1,.08,.07,.28);}
   else if(shape==='fish'){rb(g,color,0,.18,0,.7,.3,.48);for(const x of [-.23,0,.23]){const line=rb(g,'#f6d4b3',x,.34,0,.04,.018,.43);line.rotation.y=-.25;}}
   else if(shape==='egg'){ball(g,'#f9e6bf',0,.09,0,.5,.1,.4);ball(g,color,.02,.2,.01,.23,.14,.23);}
   else if(shape==='fruit'){mesh(g,cone,color,0,.24,0,.3,.55,.3).rotation.z=Math.PI;for(let i=0;i<3;i++){const l=ball(g,'#6d9f68',0,.53,0,.09,.035,.23);l.rotation.y=i*Math.PI/3;}}
   else if(shape==='chocolate'){rb(g,color,0,.16,0,.64,.28,.5);rb(g,'#a17151',0,.31,0,.49,.04,.35);}
   else if(shape==='meat'){ball(g,color,0,.14,0,.47,.18,.32);ball(g,'#e7b29b',-.1,.29,0,.2,.025,.14);}
   else if(shape==='cream'){for(let i=0;i<3;i++)ball(g,color,0,.13+i*.15,0,.34-i*.08,.15,.3-i*.07);}
   else{ball(g,color,0,.22,0,.4,.24,.36);}
   g.scale.setScalar(size);bakeRigidGroup(g,stepGeometry);return g;
  }
  function mitten(p:Group){const g=group(p);ball(g,C.mint,0,0,0,.55,.22,.57);for(let i=0;i<4;i++)ball(g,C.mint,(i-1.5)*.25,0,.49,.16,.18,.23);ball(g,C.red,0,.2,.12,.22,.03,.25);rb(g,C.cream,0,-.01,-.6,.64,.3,.4);bakeRigidGroup(g,stepGeometry);return g;}
  function build(run:CookingRun){work.clear();stepGeometry.forEach(g=>g.dispose());stepGeometry.clear();const s=currentStep(run),body=group(work),tool=group(work),pieces:Group[]=[],steam:Mesh[]=[],flaps:Group[]=[],flames:Mesh[]=[];let liquid:Mesh|null=null,stream:Mesh|null=null;
   if(['slice','knead','fold'].includes(s.kind)){rb(body,C.edge,0,.04,.1,6.4,.28,4.5);rb(body,'#e7bd84',0,.2,.1,6.1,.08,4.2);rb(body,'#d1a56d',-2.68,.25,.1,.05,.012,3.5);}
   if(s.kind==='slice'){for(let i=0;i<Math.min(8,s.goal);i++){const p=food(body,s.shape,.95);p.position.set(-1.9+i*3.8/(s.goal-1),.28,.05);pieces.push(p);}rb(tool,C.dark,0,.25,-.7,.23,.2,.9);rb(tool,'#bec4bd',0,.22,.18,.19,.07,1.25);rb(tool,C.cream,0,.37,-.62,.07,.02,.43);}
   if(s.kind==='knead'){pieces.push(food(body,'dough',3.8));pieces[0].position.set(0,.26,.1);mitten(tool);}
   if(s.kind==='mix'){body.position.z=1.2;mesh(body,bowl,C.mint,0,0,0,1.55,1.15,1.2);ring(body,C.cream,0,1.5,0,2.76).scale.z=.78;liquid=mesh(body,cylinder,foodColors[s.shape],0,1.23,0,2.48,.08,1.85);for(let i=0;i<5;i++){const p=food(body,s.shape,.85);p.position.set(Math.cos(i*1.3)*1.2,1.29,Math.sin(i*1.3)*.8);pieces.push(p);}rb(tool,'#ab774e',0,.5,-.7,.18,.18,2.35);ball(tool,C.wood,0,.39,.47,.4,.09,.6);}
   if(s.kind==='pan'||s.kind==='boil'){rb(body,C.mint,0,-.02,0,6,.58,4.4);rb(body,'#4e6561',0,.3,0,5.4,.1,3.9);for(const x of [-2.2,2.2])mesh(body,cylinder,C.gold,x,.33,1.75,.22,.1,.22);for(let i=0;i<5;i++){const f=mesh(body,cone,i%2?C.gold:C.red,(i-2)*.55,.55,.8,.19,.5,.18);flames.push(f);}
    mesh(body,cylinder,C.dark,0,.73,0,2.28,.47,1.85);ring(body,'#74746b',0,1.01,0,2.2).scale.z=.84;
    if(s.kind==='pan'){rb(body,C.ink,2.8,.8,.35,1.9,.23,.43);mesh(body,cylinder,'#a18b62',0,1,0,2.09,.08,1.7);for(let i=0;i<5;i++){const p=food(body,s.shape,1.4);p.position.set((i%3-1)*1.2,1.07,(Math.floor(i/3)-.5)*1.25);pieces.push(p);}rb(tool,C.wood,0,.3,0,.2,.2,2);rb(tool,C.cream,0,.3,1,.74,.09,.85);}
    else{mesh(body,bowl,C.red,0,.5,0,1.3,.65,1.15);liquid=mesh(body,cylinder,'#e8c78e',0,1.4,0,2.06,.08,1.8);for(let i=0;i<3;i++){const p=food(body,s.shape,1);p.position.set((i-1)*1.05,1.42,Math.sin(i)*.45);pieces.push(p);}for(let i=0;i<4;i++)steam.push(ball(body,C.cream,(i-1.5)*.85,1.5,i%2?.55:-.35,.12));rb(tool,C.wood,0,.3,-.4,.15,.17,2);ring(tool,C.cream,0,.3,.65,.5);}
   }
   if(s.kind==='bake'){rb(body,C.ink,0,-.08,-.1,6,.3,3.6);rb(body,C.mint,0,1.2,-.12,5.7,2.7,3.5);rb(body,C.cream,0,2.32,1.67,5.1,.42,.16);rb(body,C.gold,0,1.05,1.75,5.12,1.85,.13);rb(body,'#6d4b39',0,1.06,1.84,4.72,1.45,.08);rb(body,C.wood,0,.48,1.92,4.1,.12,1.5);rb(body,C.cream,0,1.97,1.86,3.3,.12,.2);for(const x of [-2.1,2.1])mesh(body,cylinder,C.cream,x,2.34,1.76,.23,.16,.23).rotation.x=Math.PI/2;for(let i=0;i<3;i++){const p=food(body,s.shape,1.45);p.position.set((i-1)*1.12,.56,1.94);pieces.push(p);}mitten(tool);}
   if(s.kind==='pour'){mesh(body,bowl,C.cream,.65,0,.6,1.1,1.6,1.1);ring(body,C.red,.65,2.08,.6,1.98);liquid=mesh(body,cylinder,foodColors[s.shape],.65,.2,.6,1.85,.1,1.85);const jug=group(tool);mesh(jug,bowl,C.mint,0,0,0,.7,.9,.7);ring(jug,C.cream,0,1.19,0,1.25);mesh(jug,torus,C.mint,-1.1,.45,0,.6,.6,.6).rotation.y=Math.PI/2;stream=mesh(work,cylinder,foodColors[s.shape],.35,2.35,.2,.12,1.8,.12);}
   if(s.kind==='fold'){const wrap=rb(body,C.cream,0,.34,0,4.4,.06,3.5);wrap.rotation.y=Math.PI/4;pieces.push(food(body,s.shape,2.2));pieces[0].position.y=.4;for(let i=0;i<4;i++){const g=group(body);g.rotation.y=i*Math.PI/2;const flap=group(g,-1.25,.4,0);rb(flap,'#f4d398',0,0,0,2.4,.06,3);flaps.push(flap);}mitten(tool);}
   if(s.kind==='plate'){mesh(body,cylinder,C.edge,0,.18,.2,3.06,.17,2.3);mesh(body,cylinder,C.cream,0,.31,.2,2.98,.16,2.23);ring(body,C.gold,0,.41,.2,2.67).scale.z=.75;rb(body,C.wood,-3.65,.16,.4,1.05,.2,3.7);for(let i=0;i<s.goal;i++)pieces.push(food(body,s.shape,1.15));food(tool,s.shape,1.15);}
   bakeRigidGroup(body,stepGeometry,new Set([...pieces,...steam,...flaps,...flames,...(liquid?[liquid]:[])]));objects={food:pieces,tool,body,steam,flaps,liquid,stream,flames};
  }
  const baked=new Color('#bd864b'),burnt=new Color('#805335');
  function update(run:CookingRun,point:{x:number;y:number}|null,time:number,motion:boolean){if(disposed)return;const key=`${run.recipeId}/${run.step}`;if(key!==identity){identity=key;for(const color of Object.values(foodColors))palette.get(color)?.color.set(color);build(run);}const o=objects!,s=currentStep(run),a=run.active,t=time/1000,held=a.holdAt===null?0:Math.min(1.5,(run.elapsed-a.holdAt)/s.holdMs),pulse=Math.max(0,1-(run.elapsed-a.lastAt)/320),pos=point?screen(point.x,point.y,s.kind==='mix'?1.4:.35):null;
   if(s.kind==='pan'||s.kind==='bake')mat(foodColors[s.shape]).color.set(foodColors[s.shape]).lerp(a.amount>1?burnt:baked,Math.min(.7,a.amount*.4));
   o.tool.visible=s.kind!=='bake'||a.amount>=.6;
   if(s.kind==='slice'){o.food.forEach((g,i)=>{const done=i<a.count;g.position.z=done?1.1:.05;g.rotation.y=done?(i-2)*.1:0;g.scale.setScalar(done?.65:.95);});o.tool.position.copy(pos??screen(cutGuide(run),.33,.8));o.tool.position.y+=motion?pulse*.4:0;}
   if(s.kind==='knead'){const dough=o.food[0],squash=Math.min(1,held);dough.scale.set(3.8*(1+squash*.22),3.8*(1-squash*.42),3.8*(1+squash*.13));o.tool.position.set(0,2.6-squash*1.8,.2);o.tool.rotation.z=motion?Math.sin(held*2)*.025:0;}
   if(s.kind==='mix'){const angle=a.amount;for(let i=0;i<o.food.length;i++){o.food[i].position.x=Math.cos(i*1.3+angle)*1.2;o.food[i].position.z=Math.sin(i*1.3+angle)*.8;}o.tool.position.copy(pos??new Vector3(Math.cos(angle)*1.4,1.5,1.2+Math.sin(angle)*.8));o.tool.rotation.y=angle+.6;}
   if(s.kind==='pan'){const flip=motion&&a.flipped?Math.min(1,(run.elapsed-a.lastAt)/450):1;for(const g of o.food){g.position.y=1.07+(a.flipped&&motion?Math.sin(flip*Math.PI)*1.1:0);g.rotation.x=a.flipped?Math.PI*2*flip:0;}o.tool.position.copy(pos??new Vector3(2.2,1.2,1.1));o.tool.rotation.y=-.5;}
   if(s.kind==='boil'){o.steam.forEach((b,i)=>{const size=.12+a.foam*.32;b.scale.setScalar(size);b.position.y=1.55+(motion?Math.sin(t*3+i)*.04:0);});o.tool.position.copy(pos??new Vector3(2.4,1.5,.1));o.tool.rotation.y=-.6;}
   if(s.kind==='bake'){o.tool.position.set(2.35,.95,2.6);o.tool.rotation.z=-.3;}
   if(s.kind==='pour'){o.tool.position.set(-1.4,1.8,-.1);o.tool.rotation.z=a.holdAt===null?.12:-.7;o.liquid!.position.y=.3+a.amount*1.8;o.stream!.visible=a.holdAt!==null;}
   if(s.kind==='fold'){o.flaps.forEach((g,i)=>{g.rotation.z=i<a.count?-.85:0;g.visible=i<a.count;});o.tool.position.copy(pos??new Vector3(2.4,1.3,.5));}
   if(s.kind==='plate'){o.food.forEach((g,i)=>{g.visible=i<a.count;if(g.visible){const p=plateTarget({...run,active:{...a,count:i}});g.position.copy(screen(p.x,p.y,.45));}});o.tool.position.copy(pos??new Vector3(-3.5,.35,.6));o.tool.visible=a.count<s.goal;}
   o.flames.forEach((f,i)=>{f.scale.y=.3+a.heat/100*.6+(motion?Math.sin(t*5+i)*.04:0);});renderer.render(scene,camera);
  }
  return {update,stats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),dispose};
 }catch(error){dispose();throw error;}
}
