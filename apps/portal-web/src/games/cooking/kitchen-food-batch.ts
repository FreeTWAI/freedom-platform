import {BufferAttribute,BufferGeometry,Group,DynamicDrawUsage,InstancedMesh,Material,Matrix4,Mesh,MeshStandardMaterial,NormalBlending,Object3D,Sphere} from 'three';

function ordinaryAttribute(a:BufferAttribute){return !('isFloat16BufferAttribute' in a&&a.isFloat16BufferAttribute)&&!('isInstancedBufferAttribute' in a&&a.isInstancedBufferAttribute);}
function equalAttribute(a:BufferAttribute,b:BufferAttribute){
 if(!ordinaryAttribute(a)||!ordinaryAttribute(b)||a.gpuType!==b.gpuType||a.constructor!==b.constructor||a.itemSize!==b.itemSize||a.normalized!==b.normalized||a.count!==b.count||a.array.constructor!==b.array.constructor||a.array.byteLength!==b.array.byteLength)return false;
 const x=new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength),y=new Uint8Array(b.array.buffer,b.array.byteOffset,b.array.byteLength);
 return x.every((value,i)=>value===y[i]);
}
function equalGeometry(a:BufferGeometry,b:BufferGeometry){
 if(('isInstancedBufferGeometry' in a&&a.isInstancedBufferGeometry)||('isInstancedBufferGeometry' in b&&b.isInstancedBufferGeometry))return false;
 const keys=Object.keys(a.attributes).sort();
 if(keys.join()!==Object.keys(b.attributes).sort().join()||keys.some(k=>!['position','normal','uv'].includes(k))||!keys.includes('position')||!keys.includes('normal')||JSON.stringify(a.groups)!==JSON.stringify(b.groups)||Object.keys(a.morphAttributes).length||Object.keys(b.morphAttributes).length||a.drawRange.start!==b.drawRange.start||a.drawRange.count!==b.drawRange.count)return false;
 if(Boolean(a.index)!==Boolean(b.index)||a.index&&b.index&&!equalAttribute(a.index,b.index))return false;
 return keys.every(k=>a.attributes[k] instanceof BufferAttribute&&b.attributes[k] instanceof BufferAttribute&&equalAttribute(a.attributes[k] as BufferAttribute,b.attributes[k] as BufferAttribute));
}
function safeMaterial(m:Material):m is MeshStandardMaterial{
 return m instanceof MeshStandardMaterial&&Object.getPrototypeOf(m)===MeshStandardMaterial.prototype&&!m.transparent&&m.opacity===1&&m.alphaTest===0&&m.depthWrite&&m.depthTest&&m.blending===NormalBlending&&!m.stencilWrite&&!m.wireframe&&!m.displacementMap&&!m.clippingPlanes&&m.onBeforeCompile===Material.prototype.onBeforeCompile&&m.customProgramCacheKey===Material.prototype.customProgramCacheKey&&m.onBeforeRender===Material.prototype.onBeforeRender;
}
function uniformRoot(root:Group){if(!root.matrixAutoUpdate||!root.matrixWorldAutoUpdate||root.renderOrder!==0||!(root.scale.x>0)||root.scale.x!==root.scale.y||root.scale.x!==root.scale.z)return false;root.updateMatrix();return root.matrix.elements.every(Number.isFinite);}
/** Narrow kitchen optimization: identical opaque baked food, with positive uniform root TRS.
 * Unsupported layouts remain ordinary meshes; simulation, lighting and animation are unchanged.
 */
export function createKitchenFoodBatch(parent:Group,copies:Group[]){
 if(copies.length<2||copies.length>8||copies.some(root=>root.parent!==parent||!uniformRoot(root)))return null;
 const parts=copies.map(root=>root.children);const first=parts[0];
 if(!first.length||first.length>8||parts.some(list=>list.length!==first.length))return null;
 for(let i=0;i<first.length;i++)for(const list of parts){
  const part=list[i],reference=first[i];
  if(!(part instanceof Mesh)||!(reference instanceof Mesh)||Object.getPrototypeOf(part)!==Mesh.prototype||!part.matrixAutoUpdate||!reference.matrixAutoUpdate||!part.matrixWorldAutoUpdate||!reference.matrixWorldAutoUpdate||Array.isArray(part.material)||Array.isArray(reference.material)||!safeMaterial(part.material)||part.material!==reference.material||!part.visible||part.children.length||part.onBeforeRender!==Object3D.prototype.onBeforeRender||part.onAfterRender!==Object3D.prototype.onAfterRender||part.onBeforeShadow!==Object3D.prototype.onBeforeShadow||part.onAfterShadow!==Object3D.prototype.onAfterShadow||part.customDepthMaterial!==undefined||part.customDistanceMaterial!==undefined||part.castShadow!==reference.castShadow||part.receiveShadow!==reference.receiveShadow||part.layers.mask!==reference.layers.mask||part.renderOrder!==reference.renderOrder||!equalGeometry(part.geometry,reference.geometry))return null;
  part.updateMatrix();reference.updateMatrix();if(!part.matrix.equals(reference.matrix)||!part.matrixAutoUpdate||part.scale.x<=0||part.scale.y<=0||part.scale.z<=0||!part.matrix.elements.every(Number.isFinite))return null;
 }
 const sources=parts as Mesh[][];
 const meshes=(first as Mesh[]).map(part=>{const mesh=new InstancedMesh(part.geometry,part.material,copies.length);mesh.instanceMatrix.setUsage(DynamicDrawUsage);mesh.castShadow=part.castShadow;mesh.receiveShadow=part.receiveShadow;mesh.layers.mask=part.layers.mask;mesh.renderOrder=part.renderOrder;parent.add(mesh);return mesh;});
 const matrix=new Matrix4();let disposed=false;
 const update=()=>{
  if(disposed)return;
  const supported=copies.every(root=>root.parent===parent&&uniformRoot(root));
  for(const list of sources)for(const part of list)part.visible=!supported;
  let count=0;
  if(supported)for(const root of copies){if(!root.visible)continue;for(let i=0;i<meshes.length;i++)meshes[i].setMatrixAt(count,matrix.multiplyMatrices(root.matrix,sources[0][i].matrix));count++;}
  for(const mesh of meshes){mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.boundingSphere??=new Sphere();mesh.boundingBox!.getBoundingSphere(mesh.boundingSphere);}
 };
 update();
 return {meshes,update,dispose:()=>{if(disposed)return;disposed=true;for(const list of sources)for(const part of list)part.visible=true;for(const mesh of meshes){mesh.removeFromParent();mesh.dispose();}}};
}
