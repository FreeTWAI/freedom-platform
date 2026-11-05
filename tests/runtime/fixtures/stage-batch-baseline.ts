import {Matrix4,Mesh,type BufferGeometry,type Group,type Material,type Object3D} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** UX-4: callers nominate rigid groups only. Animated descendants stay separate. */
export function bakeRigidGroup(root:Group,owned:Set<BufferGeometry>,exclude=new Set<Object3D>()) {
  root.updateWorldMatrix(true,true);
  const inverse=new Matrix4().copy(root.matrixWorld).invert();
  const batches=new Map<Material,{cast:boolean;receive:boolean;meshes:Mesh[]}[]>();
  function visit(object:Object3D){
    if(exclude.has(object))return;
    if(object instanceof Mesh&&!Array.isArray(object.material)&&!object.material.transparent){
      const variants=batches.get(object.material)??[];
      let batch=variants.find(b=>b.cast===object.castShadow&&b.receive===object.receiveShadow);
      if(!batch){batch={cast:object.castShadow,receive:object.receiveShadow,meshes:[]};variants.push(batch);batches.set(object.material,variants);}
      batch.meshes.push(object);
    }
    for(const child of object.children)visit(child);
  }
  visit(root);
  for(const [material,variants] of batches)for(const batch of variants){
    if(batch.meshes.length<2)continue;
    const pieces:BufferGeometry[]=[];
    try{
      for(const mesh of batch.meshes){const cloned=mesh.geometry.clone(),piece=cloned.index?cloned.toNonIndexed():cloned;if(piece!==cloned)cloned.dispose();pieces.push(piece);piece.applyMatrix4(new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));}
      const merged=mergeGeometries(pieces,false);if(!merged)throw Error('模型合批未能完成。');
      owned.add(merged);const combined=new Mesh(merged,material);combined.castShadow=batch.cast;combined.receiveShadow=batch.receive;
      for(const mesh of batch.meshes)mesh.removeFromParent();root.add(combined);
    }finally{for(const piece of pieces)piece.dispose();}
  }
}
