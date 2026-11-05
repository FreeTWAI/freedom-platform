import {BufferAttribute,Material,Matrix4,Mesh,MeshStandardMaterial,MeshPhysicalMaterial,MeshToonMaterial,Object3D,type BufferGeometry,type Group} from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';


/** Check original layouts too: cloning/merging can erase special attribute flags. */
function hasExactIndexLayout(geometry:BufferGeometry):boolean {
  if(Object.keys(geometry.morphAttributes).length||
    (geometry as BufferGeometry&{isInstancedBufferGeometry?:boolean}).isInstancedBufferGeometry)return false;
  const count=geometry.getAttribute('position')?.count;
  if(!count||!Number.isInteger(count))return false;
  return Object.values(geometry.attributes).every(a=>a instanceof BufferAttribute&&a.count===count&&
    !(a as BufferAttribute&{isFloat16BufferAttribute?:boolean}).isFloat16BufferAttribute&&
    !(a as BufferAttribute&{isInstancedBufferAttribute?:boolean}).isInstancedBufferAttribute&&
    Number.isInteger(a.itemSize)&&a.itemSize>0);
}

/** Index only identical raw attribute tuples, never spatial/tolerance welding.
 * Unsupported layouts or exceeded work limits keep the original unchanged.
 * Triangle order, groups, draw range, bounds and signed zero survive.
 */
export function indexExactAttributes(geometry:BufferGeometry):boolean {
  if(geometry.index||!hasExactIndexLayout(geometry))return false;
  const entries=Object.entries(geometry.attributes),count=geometry.getAttribute('position').count;
  // Bounds apply before allocation or hashing, including adversarial input.
  const inputBytes=entries.reduce((sum,[,a])=>sum+a.array.byteLength,0);
  if(entries.length>32||count%3||count>1_000_000||inputBytes>16*1024*1024)return false;
  let comparisons=0;
  const comparisonBudget=Math.min(inputBytes*4,32*1024*1024);
  const attributes=entries.map(([name,a])=>({name,a:a as BufferAttribute,
    bytes:new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength),stride:a.itemSize*a.array.BYTES_PER_ELEMENT}));
  const seen=new Map<number,number[]>(),sources:number[]=[],indices:number[]=[];
  for(let i=0;i<count;i++){
    let hash=2166136261;
    for(const {bytes,stride} of attributes)for(let j=i*stride;j<(i+1)*stride;j++)hash=Math.imul(hash^bytes[j],16777619);
    const bucket=seen.get(hash)??[];
    // Hashes only select candidates: collisions never merge unequal bits.
    let index:number|undefined;
    for(const candidate of bucket){
      let equal=true;
      for(const {bytes,stride} of attributes){
        const source=sources[candidate];
        for(let j=0;j<stride;j++){
          if(++comparisons>comparisonBudget)return false;
          if(bytes[source*stride+j]!==bytes[i*stride+j]){equal=false;break;}
        }
        if(!equal)break;
      }
      if(equal){index=candidate;break;}
    }
    if(index===undefined){
      // A bounded bucket avoids collision-heavy quadratic comparison growth.
      if(bucket.length>=64)return false;
      index=sources.length;sources.push(i);bucket.push(index);seen.set(hash,bucket);
    }
    indices.push(index);
  }
  const stride=attributes.reduce((sum,a)=>sum+a.stride,0),indexBytes=sources.length>65535?4:2;
  if(sources.length*stride+count*indexBytes>=count*stride)return false;
  const replacements=attributes.map(({name,a,bytes,stride})=>{
    const array=new (a.array.constructor as {new(length:number):typeof a.array})(sources.length*a.itemSize);
    const target=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    sources.forEach((source,i)=>target.set(bytes.subarray(source*stride,(source+1)*stride),i*stride));
    const attribute=new BufferAttribute(array,a.itemSize,a.normalized);attribute.name=a.name;attribute.setUsage(a.usage);attribute.gpuType=a.gpuType;
    return {name,attribute};
  });
  for(const {name,attribute} of replacements)geometry.setAttribute(name,attribute);
  geometry.setIndex(indices);return true;
}

/** Only the audited built-in opaque shaders: custom shaders may use gl_VertexID. */
function canIndexMaterial(material:Material,meshes:Mesh[]):boolean {
  return [MeshStandardMaterial,MeshPhysicalMaterial,MeshToonMaterial].some(type=>material.constructor===type)&&
    material.onBeforeCompile===Material.prototype.onBeforeCompile&&
    material.customProgramCacheKey===Material.prototype.customProgramCacheKey&&
    material.onBeforeRender===Material.prototype.onBeforeRender&&
    meshes.every(mesh=>mesh.constructor===Mesh&&!mesh.customDepthMaterial&&!mesh.customDistanceMaterial&&
      mesh.onBeforeRender===Object3D.prototype.onBeforeRender&&mesh.onBeforeShadow===Object3D.prototype.onBeforeShadow);
}

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
    const eligible=canIndexMaterial(material,batch.meshes)&&batch.meshes.every(mesh=>hasExactIndexLayout(mesh.geometry));
    const pieces:BufferGeometry[]=[];
    try{
      for(const mesh of batch.meshes){const cloned=mesh.geometry.clone(),piece=cloned.index?cloned.toNonIndexed():cloned;if(piece!==cloned)cloned.dispose();pieces.push(piece);piece.applyMatrix4(new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld));}
      const merged=mergeGeometries(pieces,false);if(!merged)throw Error('模型合批未能完成。');
      if(eligible)indexExactAttributes(merged);
      owned.add(merged);const combined=new Mesh(merged,material);combined.castShadow=batch.cast;combined.receiveShadow=batch.receive;
      for(const mesh of batch.meshes)mesh.removeFromParent();root.add(combined);
    }finally{for(const piece of pieces)piece.dispose();}
  }
}
