import {Box3,BufferGeometry,Color,Float32BufferAttribute,Group,Mesh,Raycaster,SphereGeometry,Vector3} from 'three';
import {FoodKit,cookedColor} from './food-kit';
import {bakeRigidGroup} from '../stage-batch';
import {INGREDIENTS,newMarket,type MarketRun,type MarketId} from './market-domain';

/** UX-9: one bounded assembly for both the cooking scene and its actual, inspectable result. */
export function marketFood(run:MarketRun,kit:FoodKit){
 const root=new Group(),transient:BufferGeometry[]=[],result=run.status==='done'||(run.recipe==='corn-dog'&&run.portions.length>0&&run.portions.every(p=>p.lifted));let disposed=false;
 // Small edible details use assembly-owned low-poly geometry, never mutate the shared kit.
 // Their count is bounded independently of frame rate and all parts still batch by material.
 const morsel=new SphereGeometry(1,8,5);transient.push(morsel);
 const bite=(target:Group,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,kind:Parameters<FoodKit['mat']>[1]='food')=>kit.mesh(target,morsel,color,x,y,z,sx,sy,sz,kind);
 const vegetable=(kind:string,x:number,y:number,z:number,s=.35,target=root)=>{
  if(kind==='egg'){if(run.recipe==='egg-fried-rice'){for(let j=0;j<3;j++){const e=bite(target,'#e7bd52',x+(j-1)*s*.38,y+(j%2)*s*.14,z+(j%2)*s*.2,s*.7,s*.22,s*.45);e.rotation.set(.15*j,j*1.8,.17*(j-1));}}else{kit.ball(target,'#f0e5b8',x,y,z,s*1.7,.07,s*1.4);kit.ball(target,'#e6ae24',x,y+.08,z,s*.65,.12,s*.65);}}
  else if(kind==='lettuce'){for(let j=0;j<4;j++){const leaf=kit.mesh(target,kit.leaf,j%2?'#6c9337':'#8ba849',x+(j-1.5)*.035,y+j*.025,z,s*1.3,s,s*1.2);leaf.rotation.y=j*1.4;}}
  else if(kind==='broccoli'){kit.disk(target,'#809a45',x,y,z,s*.18,s*.8);for(let j=0;j<13;j++){const a=j*2.4,rr=Math.sqrt(j/13)*s*.75;bite(target,j%3?'#527c32':'#668e39',x+Math.cos(a)*rr,y+.2-Math.sqrt(j/13)*.05,z+Math.sin(a)*rr,s*.28,s*.24,s*.27);}}
  else if(kind==='tomato'){const d=kit.disk(target,'#c9452e',x,y,z,s,.075);d.rotation.z=.07;for(let j=0;j<5;j++)kit.ball(target,'#e5bc69',x+Math.cos(j*1.26)*s*.5,y+.055,z+Math.sin(j*1.26)*s*.5,.045,.018,.06);}
  else if(kind==='potato'){for(let j=0;j<7;j++){const layer=Math.floor(j/4),f=kit.block(target,'#d2a249',x+(j%4-1.5)*.105,y+layer*.105,z+(j%2)*.035,.095,.095,s*(1.8+(j%3)*.13));f.rotation.set(0,layer?-.3:.28,(j%2?1:-1)*.025);}}
  else if(kind==='shrimp'){for(let j=0;j<6;j++){const a=-.6+j*.52,tail=1-j*.075;const piece=bite(target,j%2?'#df9571':'#efb993',x+Math.sin(a)*s*.66,y+.04+Math.sin(a)*s*.08,z+Math.cos(a)*s*.66,s*.32*tail,s*.23*tail,s*.27*tail);piece.rotation.y=-a;}const tail=kit.mesh(target,kit.leaf,'#df9571',x+s*.65,y+.035,z-s*.2,s*.32,s*.16,s*.45);tail.rotation.y=.8;}
  else {const p=kit.block(target,INGREDIENTS[kind as keyof typeof INGREDIENTS]?.color??'#6a9443',x,y,z,s*.8,s*.3,s*.7);p.rotation.y=x+z;}
 };
 // UX-14: each serving surface has a complete profile, never stacked flat disks.
 if(result){
  if(run.recipe==='corn-dog')kit.mesh(root,kit.paperTray,'#e8d1a1',0,.16,0,1,1,1,'paper');
  else if(run.recipe==='steak-dinner'){
   kit.mesh(root,kit.servingBoard,'#af7d4d',0,0,0,1,1,1,'wood');
   kit.mesh(root,kit.ironPlatter,'#25272a',0,0,0,2.4,1,1.5,'iron');
   for(const side of [-1,1])kit.mesh(root,kit.ironEar,'#25272a',side*2.4,.23,0,1,1,1,'iron');
  }else{
   const plate=new Mesh(kit.ceramicPlate,[kit.mat('#f2eadb','ceramic'),kit.mat('#426d73','ceramic')]);plate.scale.set(2.35,1,1.85);plate.castShadow=plate.receiveShadow=true;root.add(plate);
  }
 }
 const dinnerware=new Set(root.children);
 root.userData.serving=result?(run.recipe==='steak-dinner'?'cast-iron':run.recipe==='corn-dog'?'paper-tray':'ceramic'):null;
 const base=result ? .18 : 0;
 if(run.recipe==='egg-fried-rice'){
  const rice=run.portions.filter(p=>p.kind==='rice');let riceSurface:Mesh|undefined;if(rice.length){
   const average=rice.reduce((sum,p)=>sum+(p.a+p.b)/2,0)/rice.length,color=cookedColor('#ead8ac',average*.48),height=.56+Math.min(5,rice.length)*.075;
   // A low, irregular mound with embedded short grains, not a smooth bun or noodles.
   const mound=kit.sphere.clone(),positions=mound.getAttribute('position');transient.push(mound);
   for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),a=Math.atan2(z,x),edge=1+.055*Math.sin(a*5)+.035*Math.cos(a*9);positions.setXYZ(i,x*edge,y*(1+.045*Math.sin(x*7+z*5)),z*edge);}
   mound.computeVertexNormals();riceSurface=kit.mesh(root,mound,color,0,base+.14,0,1.64,height,1.24,'rice');
   for(let i=0;i<420;i++){
    const a=i*2.39996,rr=Math.sqrt((i+.5)/420)*.96,x=Math.cos(a)*rr*1.62,z=Math.sin(a)*rr*1.22,y=base+.14+height*Math.sqrt(1-rr*rr);
    const grain=bite(root,color,x,y-.015,z,.085,.038,.036,'rice');grain.rotation.set(.12*Math.sin(i),a+i*.37,.14*Math.cos(i));
   }
  }
  // Seat each garnish's real underside on the actual sculpted mound, not a
  // constant height plane that leaves the rim ingredients visibly suspended.
  root.updateWorldMatrix(true,true);
  const seatRay=new Raycaster(new Vector3(),new Vector3(0,-1,0),0,6);
  run.portions.filter(p=>p.kind!=='rice').forEach((p,index)=>{for(let j=0;j<5;j++){
   const a=index*1.4+j*2.4,rr=.38+(j%3)*.38,x=Math.cos(a)*rr,z=Math.sin(a)*rr*.8,garnish=new Group();
   vegetable(p.kind,0,0,0,p.kind==='egg'?.19:p.kind==='shrimp'?.18:.12,garnish);
   seatRay.ray.origin.set(x,3,z);const surface=riceSurface?seatRay.intersectObject(riceSurface,false)[0]?.point.y:undefined;
   garnish.position.set(x,(surface??base+.04)-new Box3().setFromObject(garnish).min.y-.012,z);root.add(garnish);
  }});
 } else if(run.recipe==='steak-dinner'){
  const meatCount=run.portions.filter(p=>p.kind==='steak').length;let meatIndex=0,sideIndex=0;
  run.portions.forEach((p,portionIndex)=>{
   if(p.kind==='steak'){
    const index=meatIndex++,single=meatCount===1,x=single?-.28:(index%2-.5)*1.7,z=single?-.1:Math.floor(index/2)*.18,y=base+Math.floor(index/2)*.34;
    const visible=p.side?p.a:p.b,hidden=p.side?p.b:p.a,shade=(c:number)=>c>1?'#'+new Color('#ffffff').lerp(new Color('#3c2818'),Math.min(1,(c-1)*1.8)).getHexString():'#ffffff';
    const meat=new Mesh(kit.cutlet,[kit.mat(shade(visible),visible>.3?'sear':'meat'),kit.mat(shade(hidden),hidden>.3?'sear':'meat'),kit.mat('#af8059','sear')]);meat.position.set(x,y+(result?.255:.22),z);meat.scale.set(single?.95:.7,.85,single?.95:.7);meat.rotation.y=.2+index*.37;meat.castShadow=meat.receiveShadow=true;meat.userData.portion=portionIndex;root.add(meat);
    if(visible>.25){const butter=kit.block(root,'#e8c77f',x+.3,y+(result?.555:.52),z,.23,.055,.2);butter.rotation.y=.3;
     // Keep per-face picking ownership through rigid batching without adding draws.
     if(!result){butter.geometry=butter.geometry.clone();butter.geometry.setAttribute('marketPortion',new Float32BufferAttribute(new Float32Array(butter.geometry.getAttribute('position').count).fill(portionIndex),1));transient.push(butter.geometry);}
    }
   }else{
    const positions:Record<string,[number,number]>={potato:[1.15,-.55],broccoli:[1.35,.45],egg:[-.9,.85]},[x,z]=positions[p.kind]??[Math.cos(sideIndex*2.4)*1.65,Math.sin(sideIndex*2.4)*.95];
    const garnish=new Group();root.add(garnish);vegetable(p.kind,x,0,z,.35,garnish);
    // Garnishes used to float above the meat: settle their actual underside on the pan.
    garnish.position.y=(result?.15:-.04)-new Box3().setFromObject(garnish).min.y+Math.floor(sideIndex/6)*.18;sideIndex++;
   }
  });
 }
 else if(run.recipe==='shawarma'){
  const bread=run.portions.some(p=>p.kind==='bread');if(bread){
   if(run.folds>=3){
    // A soft tapered roll with a diagonal open cut and an overlapping lip.
    const wrap=kit.wrap.clone(),vertices=wrap.getAttribute('position');transient.push(wrap);
    for(let i=0;i<vertices.count;i++){const x=vertices.getX(i),y=vertices.getY(i),z=vertices.getZ(i),end=Math.abs(x)/1.55,taper=.86+.14*end;vertices.setXYZ(i,x+z*.36,(y-.48)*taper+.48+.025*Math.sin(x*3),z*taper);}
    wrap.computeVertexNormals();kit.mesh(root,wrap,'#ffffff',0,base,0,1,1,1,'bread');
    // Thin bread thickness around both slanted openings makes the cut readable
    // against the layered filling; use the same bread material and final batch.
    const rimPositions:number[]=[],rimUvs:number[]=[],rimIndices:number[]=[];
    for(const side of [-1,1]){
     const offset=rimPositions.length/3;
     for(let j=0;j<=44;j++)for(const radius of [1,.91]){
      const a=1.7+j/44*6.05,z=Math.cos(a)*.59*radius,y=.48+Math.sin(a)*.41*radius;
      rimPositions.push(side*1.55+z*.36,y+.025*Math.sin(side*1.55*3),z);rimUvs.push(j/44,radius);
     }
     for(let j=0;j<44;j++){const a=offset+j*2;rimIndices.push(a,a+1,a+2,a+1,a+3,a+2);}
    }
    const rim=new BufferGeometry();rim.setAttribute('position',new Float32BufferAttribute(rimPositions,3));rim.setAttribute('uv',new Float32BufferAttribute(rimUvs,2));rim.setIndex(rimIndices);rim.computeVertexNormals();transient.push(rim);kit.mesh(root,rim,'#ffffff',0,base,0,1,1,1,'bread');
   }
   else {kit.disk(root,'#ddbc80',0,base+.07,0,2.03,.06,1.65,'bread');if(run.folds)for(const side of [-1,1]){const f=kit.disk(root,'#d8b375',side*1.23,base+.2,0,.87,.05,1.4,'bread');f.rotation.z=side*run.folds*.23;}}
  }
  run.portions.filter(p=>p.kind!=='bread').forEach((p,i)=>{const a=i*2.39996,rr=run.folds===3?1.28:Math.sqrt((i+.5)/Math.max(1,run.portions.length))*1.2,x=run.folds===3?(i%2?1:-1)*(1.39+(i%3)*.025):Math.cos(a)*rr,z=run.folds===3?.1+(i%3-1)*.16:Math.sin(a)*rr*.65,y=base+(run.folds===3?.34:.2)+(i%3)*.075;if(p.kind==='meat'){for(let j=0;j<3;j++){const meat=kit.mesh(root,kit.leaf,cookedColor('#b87a48',p.a*.6),x+(j-1)*.065,y+j*.055,z,.48,.35,.38,'meat');meat.rotation.set(.15+j*.12,a+j*.4,.12*(j-1));}}else vegetable(p.kind,x,y,z,.27);});
 }
 else {
  run.portions.forEach((p,i)=>{
   const x=(i%3-1)*1.15,z=Math.floor(i/3)*.28,y=base+.3+Math.floor(i/3)*.3;
   const dogGroup=new Group();dogGroup.userData.portion=i;root.add(dogGroup);
   const visible=p.side?p.a:p.b,hidden=p.side?p.b:p.a;
   const shell=(c:number)=>{
    const color=new Color('#efdbad').lerp(new Color('#d29a44'),Math.max(0,Math.min(1,(c-.08)/.72)));
    color.lerp(new Color('#452719'),Math.max(0,Math.min(1,(c-1)*1.8)));
    return '#'+color.getHexString();
   };
   const material=(c:number)=>p.coated?kit.mat(shell(c),'batter'):kit.mat(cookedColor('#bf684e',c*.2),'food');
   let shellGeometry=kit.cornDog;
   if(p.coated){
    // Sculpt the existing closed shell instead of adding floating crumb draws.
    // Relief stays below the sauce clearance and preserves the two face materials.
    shellGeometry=kit.cornDog.clone();transient.push(shellGeometry);const vertices=shellGeometry.getAttribute('position');
    for(let v=0;v<vertices.count;v++){
     const px=vertices.getX(v),py=vertices.getY(v),pz=vertices.getZ(v),a=Math.atan2(py/.9,px),tip=Math.max(0,1-(pz/1.28)**2);
     const crust=tip*(.008*Math.sin(a*11+pz*19)+.006*Math.cos(a*17-pz*31)+.004*Math.sin(pz*43));
     vertices.setXYZ(v,px+Math.cos(a)*crust,py+Math.sin(a)*crust*.9,pz);
    }
    shellGeometry.computeVertexNormals();
   }
   const dog=new Mesh(shellGeometry,[material(visible),material(hidden)]);
   dog.position.set(x,y,z);dog.scale.set(p.coated?1:.72,1,p.coated?1:.86);
   dog.castShadow=dog.receiveShadow=true;dogGroup.add(dog);
   // Flattened wooden skewer and sparse angular crust, inside the same portion owner.
   kit.block(dogGroup,'#c5a875',x,y-.035,z+1.65,.065,.035,1.15,'wood');

  });
 }
 // Settle flat-plate food before projecting sauce; neither the run nor saved points move.
 if(result&&run.recipe!=='steak-dinner'&&run.recipe!=='corn-dog'){
  const meal=new Group();for(const child of [...root.children])if(!dinnerware.has(child))meal.add(child);
  if(meal.children.length){root.add(meal);meal.position.y=.085-new Box3().setFromObject(meal).min.y;}
 }
 // UX-R3: project the player's bounded control points before adding any sauce meshes.
 // At most 8 x 32 rays; interpolation adds no new surface queries or saved coordinates.
 const sauceTargets:Mesh[]=[];
 if(run.sauces.length&&run.recipe!=='corn-dog'){root.updateWorldMatrix(true,true);root.traverse(o=>{if(o instanceof Mesh)sauceTargets.push(o);});}
 const sauceRay=new Raycaster(new Vector3(),new Vector3(0,-1,0),0,12);
 function saucePosition(p:{x:number;y:number}){
  const x=(p.x-.5)*3.4,z=(p.y-.5)*2.5;let y=base+.025;
  if(run.recipe==='corn-dog')for(let k=0;k<run.portions.length;k++){
   const portion=run.portions[k],cx=(k%3-1)*1.15,cz=Math.floor(k/3)*.28,width=portion.coated?.34:.245,dx=(x-cx)/width,dz=(z-cz)/1.28;
   if(Math.abs(dx)<1&&Math.abs(dz)<1){const profile=Math.pow(Math.max(0,1-Math.pow(Math.abs(dz),5)),.4);y=Math.max(y,base+.3+Math.floor(k/3)*.3+.306*Math.sqrt(1-dx*dx)*profile+.025);}
  }else{
   sauceRay.ray.origin.set(x,10,z);const hit=sauceRay.intersectObjects(sauceTargets,false)[0];
   if(hit)y=hit.point.y+.022;
  }
  return new Vector3(x,y,z);
 }
 for(const line of run.sauces){
  const colors={ketchup:'#bc3622',mustard:'#e0b236',garlic:'#e9dfbd'},samples=line.points.map(saucePosition),points:Vector3[]=[];
  for(let i=0;i<samples.length-1;i++)for(let j=0;j<4;j++)points.push(samples[i].clone().lerp(samples[i+1],j/4));
  if(samples.length)points.push(samples[samples.length-1]);
  if(points.length>1)transient.push(kit.curve(root,colors[line.sauce],points,.032));
 }

 const merged=new Set(transient);
 // Completed plates are rigid. In the fryer, each liftable dog keeps its own parent.
 if(run.recipe==='corn-dog'&&run.status!=='done'){for(const child of root.children)if(child instanceof Group)bakeRigidGroup(child,merged);}
 else bakeRigidGroup(root,merged);
 transient.length=0;transient.push(...merged);
 return {root,geometries:transient,dispose:()=>{if(disposed)return;disposed=true;transient.forEach(g=>g.dispose());root.clear();}};
}

/** Catalog photograph only; never used as a player's completion or score. */
export function displayMarket(recipe:MarketId){const r=newMarket(recipe,42);r.status='done';r.elapsed=45000;r.temperature=185;
 const kinds=recipe==='egg-fried-rice'?['rice','rice','egg','carrot','shrimp','scallion'] as const:recipe==='steak-dinner'?['steak','steak','potato','broccoli','egg'] as const:recipe==='shawarma'?['bread','meat','meat','meat','lettuce','tomato'] as const:['sausage','sausage','sausage'] as const;
 r.portions=kinds.map(kind=>({kind,a:.7,b:.72,side:0,flips:1,coated:recipe==='corn-dog',lifted:true,drain:3000}));if(recipe==='shawarma'){r.shaves=3;r.folds=3;}if(recipe==='corn-dog')r.sauces=[{sauce:'ketchup',points:Array.from({length:18},(_,i)=>({x:.162+Math.sin(i*1.5)*.056,y:.15+i*.04}))},{sauce:'mustard',points:Array.from({length:18},(_,i)=>({x:.838+Math.sin(i*1.5)*.056,y:.15+i*.04}))}];return r;
}
