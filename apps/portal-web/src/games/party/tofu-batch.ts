import {Group,InstancedMesh,Mesh,Sphere,type Material} from 'three';

/** Identical opaque tofu pieces share draws; transparent faces retain their own sorting. */
export function createTofuOpaqueBatch(parent:Group,copies:Group[]){
 const opaque=(copy:Group)=>copy.children.filter((child):child is Mesh=>child instanceof Mesh&&!Array.isArray(child.material)&&!child.material.transparent);
 const sources=copies.map(opaque),first=sources[0]??[];
 if(!copies.length||!first.length||copies.some(copy=>copy.parent!==parent)||sources.some(parts=>parts.length!==first.length||parts.some((part,i)=>part.geometry!==first[i].geometry||part.material!==first[i].material||part.castShadow!==first[i].castShadow||part.receiveShadow!==first[i].receiveShadow)))throw Error('Tofu instance sources must match.');
 const local=sources.map(parts=>parts.map(part=>{part.updateMatrix();return part.matrix.clone();}));
 if(local.some(parts=>parts.some((matrix,i)=>!matrix.equals(local[0][i]))))throw Error('Tofu local transforms must match.');
 // Bake local piece transforms once: root TRS stays shear-free for instance normal shading.
 const owned=first.map((part,i)=>part.geometry.clone().applyMatrix4(local[0][i]));
 const meshes=first.map((part,i)=>{const mesh=new InstancedMesh(owned[i],part.material as Material,copies.length);mesh.castShadow=part.castShadow;mesh.receiveShadow=part.receiveShadow;parent.add(mesh);return mesh;});
 let disposed=false;
 // All copies are direct children of parent, so local transforms avoid inversion/roundoff.
 const update=()=>{if(disposed)return;let count=0;for(let i=0;i<copies.length;i++){
  const copy=copies[i];if(!copy.visible)continue;copy.updateMatrix();
  for(let piece=0;piece<meshes.length;piece++)meshes[piece].setMatrixAt(count,copy.matrix);count++;
 }
 for(const mesh of meshes){mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.boundingSphere??=new Sphere();mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere);}};
 for(const parts of sources)for(const part of parts)part.removeFromParent();
 update();
 return {meshes,update,dispose:()=>{if(disposed)return;disposed=true;for(const mesh of meshes){mesh.removeFromParent();mesh.dispose();}owned.forEach(geometry=>geometry.dispose());}};
}
