import {Group,Mesh} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {FoodKit} from './food-kit';
import {bakeRigidGroup} from '../stage-batch';
import {cornDogPresentation} from './corn-dog-presentation';
import type {MarketRun} from './market-domain';

/** Original compact fryer: rolled steel edges, indigo enamel, amber oil and a
 * removable drain rack. All resources remain owned by the stage's FoodKit. */
export function createCornDogStall(kit:FoodKit){
 const root=new Group(),body=new Group(),dial=new Group();root.add(body);
 const rounded=kit.own(new RoundedBoxGeometry(1,1,1,2,.08));
 const part=(color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,kind:Parameters<FoodKit['mat']>[1]='metal')=>kit.mesh(body,rounded,color,x,y,z,sx,sy,sz,kind);
 part('#334f5b',-.55,-.06,0,4.5,.5,4.25,'plain');
 // A dark inset under the oil reads as a basin, rather than a yellow tabletop.
 part('#414b49',-.55,.19,0,4.18,.1,3.94);
 kit.block(body,'#c3a34d',-.55,.245,0,4.02,.035,3.78,'oil');
 for(const side of [-1,1]){
  part('#b1bab5',-.55+side*2.15,.31,0,.16,.24,4.25);
  part('#c3c8bb',-.55,.31,side*2.04,4.35,.24,.16);
  // Small dark feet separate the cooker from the wooden worktop.
  for(const z of [-1.65,1.65])part('#303735',-.55+side*1.8,-.28,z,.35,.13,.35,'plain');
 }
 part('#71817d',2.67,.1,-.3,.88,.15,3.62);
 part('#374f55',2.67,.19,-.3,.75,.06,3.46,'plain');
 for(let i=0;i<9;i++)part('#bdc4ba',2.67,.25,-1.7+i*.35,.84,.045,.055);
 // Front enamel control panel. Labels remain accessible HTML, not texture text.
 part('#283e48',-.55,.03,2.15,3.9,.3,.12,'plain');
 const knob=kit.disk(body,'#bdc4ba',-.85,.05,2.28,.15,.09,.15,'metal');knob.rotation.x=Math.PI/2;
 bakeRigidGroup(body,kit.geometries);
 dial.position.set(-.85,.05,2.34);
 const tick=new Mesh(kit.box,kit.mat('#f3dfb5','plain'));tick.position.y=.075;tick.scale.set(.025,.09,.015);dial.add(tick);root.add(dial);
 const lampMaterial=kit.mat('#a14e29','plain');lampMaterial.emissive.set('#e99441');lampMaterial.emissiveIntensity=0;
 const lamp=new Mesh(kit.sphere,lampMaterial);lamp.position.set(-.36,.06,2.27);lamp.scale.set(.06,.06,.025);root.add(lamp);
 return {root,dial,lamp,update(run:MarketRun){const view=cornDogPresentation(run);dial.rotation.z=-view.dialAngle;lampMaterial.emissiveIntensity=view.heaterGlow;}};
}
