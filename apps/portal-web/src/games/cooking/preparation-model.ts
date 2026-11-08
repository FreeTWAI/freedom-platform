import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,DoubleSide,Vector3,Color} from 'three';

export const VOLUMETRIC_PREPARATION_IDS = ['potato','pumpkin','sweet-potato','mushroom'] as const;
export type PreparationId = typeof VOLUMETRIC_PREPARATION_IDS[number];
export function isVolumetricPreparation(id:string):id is PreparationId {return (VOLUMETRIC_PREPARATION_IDS as readonly string[]).includes(id);}

/** One original closed food, partitioned at the real knife planes. Internal
 * faces stay hidden until a domain-accepted cut. No textures or per-frame assets. */
export function createPreparationModel(id:PreparationId,planes:readonly number[],owned:Set<BufferGeometry>,materials:Map<string,MeshStandardMaterial>) {
 const root=new Group();root.name=`ingredient/${id}`;
 const edge=2.604,bounds=[-edge,...planes,edge],segments:Group[]=[],faces:{left:Mesh;right:Mesh}[]=[];
 const colors=id==='potato'?['#ae7942','#f3dfa5']:id==='pumpkin'?['#cd6926','#f9b83d']:id==='sweet-potato'?['#8e3c4b','#efb944']:['#9b704f','#f2dfbf'];
 const material=(color:string)=>{let m=materials.get(color);if(!m){m=new MeshStandardMaterial({color,roughness:.67,side:DoubleSide});materials.set(color,m);}return m;};
 // The same analytic cross-section is evaluated on both sides of every seam.
 // Smooth normals on skin avoid the appearance of separate stacked objects.
 const ring=(x:number,angle:number)=>{
  const u=x/edge,envelope=Math.sqrt(Math.max(0,1-u*u)),s=Math.sin(angle),c=Math.cos(angle);
  const rib=id==='pumpkin'?1+.1*Math.cos(angle*9):id==='potato'?1+.035*Math.sin(x*3+angle*3):1;
  const rz=(id==='sweet-potato'?.75:id==='mushroom'?1.24:1.06)*envelope*rib;
  const ry=(id==='pumpkin'?1.02:id==='mushroom'?.58:.72)*envelope*rib;
  // Mushroom has a broad curved cap and a flat underside, not an oval potato.
  const y=id==='mushroom'?.58+Math.max(0,s)*ry:ry*(1+s);
  return new Vector3(x,y,c*rz);
 };
 const geometry=(positions:number[],normals?:number[])=>{const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));if(normals)g.setAttribute('normal',new Float32BufferAttribute(normals,3));else g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();owned.add(g);return g;};
 const mesh=(parent:Group,g:BufferGeometry,color:string)=>{const m=new Mesh(g,material(color));m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
 const normal=(x:number,a:number)=>{const dx=ring(Math.min(edge-.0001,x+.0001),a).sub(ring(Math.max(-edge+.0001,x-.0001),a)),da=ring(x,a+.0001).sub(ring(x,a-.0001));return dx.cross(da).normalize();};
 for(let i=0;i<bounds.length-1;i++){
  const left=bounds[i],right=bounds[i+1],center=(left+right)/2,g=new Group();g.name=`preparation/segment/${i}`;g.position.x=center;g.userData.center=center;root.add(g);segments.push(g);
  const p:number[]=[],n:number[]=[],radial=40,axial=8;
  for(let j=0;j<axial;j++)for(let k=0;k<radial;k++){
   const x0=left+(right-left)*j/axial,x1=left+(right-left)*(j+1)/axial,a0=k*Math.PI*2/radial,a1=(k+1)*Math.PI*2/radial;
   for(const [x,a] of [[x0,a0],[x1,a0],[x1,a1],[x0,a0],[x1,a1],[x0,a1]]){const v=ring(x,a),vnormal=normal(x,a);p.push(v.x-center,v.y,v.z);n.push(vnormal.x,vnormal.y,vnormal.z);}
  }
  const skinGeometry=geometry(p,n),tints:number[]=[];
  for(let vertex=0;vertex<p.length;vertex+=3){const x=p[vertex]+center,y=p[vertex+1],z=p[vertex+2];let tone=1;if(id==='potato')for(const [ex,ey,ez] of [[-1.2,1.15,.35],[.3,1.35,.3],[1.25,1.05,-.15]])if(((x-ex)/.16)**2+((y-ey)/.18)**2+((z-ez)/.2)**2<1)tone=.48;tints.push(tone,tone,tone);}
  skinGeometry.setAttribute('color',new Float32BufferAttribute(tints,3));const skin=mesh(g,skinGeometry,colors[0]);(skin.material as MeshStandardMaterial).vertexColors=true;skin.name='preparation/skin';
  const cap=(x:number,side:number)=>{const points:number[]=[],normals:number[]=[],tints:number[]=[],mid=new Vector3(x,ring(x,0).y,0);
   for(let k=0;k<radial;k++){const a=ring(x,k*Math.PI*2/radial),b=ring(x,(k+1)*Math.PI*2/radial);for(const v of side<0?[mid,a,b]:[mid,b,a]){points.push(v.x-center,v.y,v.z);normals.push(side,0,0);const tint=new Color(id==='pumpkin'&&v===mid?'#8b5023':colors[1]);tints.push(tint.r,tint.g,tint.b);}}
   if(id==='mushroom'&&Math.abs(x)<.23){const z=Math.sqrt(.23*.23-x*x);for(const [y,w] of [[0,-z],[.58,-z],[.58,z],[0,-z],[.58,z],[0,z]]){points.push(x-center,y,w);normals.push(side,0,0);const tint=new Color(colors[1]);tints.push(tint.r,tint.g,tint.b);}}
   // Small raised pumpkin seeds are part of the same face geometry, not
   // independent objects or texture stamps. They only appear at accepted cuts.
   if(id==='pumpkin'&&Math.abs(x)<edge*.82){const radius=Math.sqrt(1-(x/edge)**2);for(let seed=0;seed<5;seed++){const angle=seed*Math.PI*2/5,cy=mid.y+Math.sin(angle)*.25*radius,cz=Math.cos(angle)*.32*radius;for(let j=0;j<12;j++){for(const [y,z] of [[cy,cz],[cy+Math.sin(j*Math.PI/6)*.085,cz+Math.cos(j*Math.PI/6)*.035],[cy+Math.sin((j+1)*Math.PI/6)*.085,cz+Math.cos((j+1)*Math.PI/6)*.035]]){points.push(x-center+side*.006,y,z);normals.push(side,0,0);const tint=new Color('#fff0bd');tints.push(tint.r,tint.g,tint.b);}}}}
   const geo=geometry(points,normals);geo.setAttribute('color',new Float32BufferAttribute(tints,3));const key=`cut-face/${id}`;let faceMaterial=materials.get(key);if(!faceMaterial){faceMaterial=new MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.69,side:DoubleSide});materials.set(key,faceMaterial);}const m=new Mesh(geo,faceMaterial);m.castShadow=m.receiveShadow=true;g.add(m);m.name=side<0?'preparation/left-face':'preparation/right-face';m.visible=false;return m;};
  faces.push({left:cap(left,-1),right:cap(right,1)});
 }
 // Partition the stalk at the same knife planes, including an exact central
 // cut. Its cross-section joins the cap's flesh face rather than moving whole.
 if(id==='mushroom')segments.forEach((g,i)=>{
  const left=Math.max(-.23,bounds[i]),right=Math.min(.23,bounds[i+1]);if(left>=right)return;
  const p:number[]=[],at=(x:number,k:number)=>{const z=Math.sqrt(Math.max(0,.23*.23-x*x));return new Vector3(x-g.position.x,k===1||k===2?.58:0,k<2?-z:z);};
  for(let j=0;j<12;j++)for(let k=0;k<4;k++){const x0=left+(right-left)*j/12,x1=left+(right-left)*(j+1)/12;for(const v of [at(x0,k),at(x1,k),at(x1,(k+1)%4),at(x0,k),at(x1,(k+1)%4),at(x0,(k+1)%4)])p.push(v.x,v.y,v.z);}
  mesh(g,geometry(p),colors[1]).name='preparation/stalk';
 });
 if(id==='pumpkin'){
  const x=1.7,index=bounds.findIndex((end,i)=>i>0&&x<end)-1,g=segments[index],base=ring(x,Math.PI/2).y,p:number[]=[];
  for(let k=0;k<16;k++){const a=k*Math.PI/8,b=(k+1)*Math.PI/8;for(const [y,t] of [[0,a],[.36,a],[.36,b],[0,a],[.36,b],[0,b]])p.push(x-g.position.x+.07*Math.cos(t)+y*.2,base+y,-.07+.07*Math.sin(t));}
  mesh(g,geometry(p),'#665234').name='preparation/stem';
 }
 const bottoms=segments.map(g=>g.children.reduce((bottom,part)=>Math.min(bottom,(part as Mesh).geometry.boundingBox!.min.y),Infinity));
 root.position.y=.25;
 // All separated slices share the same gentle lean, keeping their bottom
 // edges on the board. In x+.15*y coordinates their knife planes remain
 // parallel, with .035 gaps: independent yaw would intersect neighbouring food.
 // Lower each cut to its own bottom, compensating x for that vertical offset
 // so the same separation proof also holds for stalk-free mushroom cap slices.
 const update=(count:number)=>{const accepted=Math.max(0,Math.min(planes.length,Math.floor(count)));
  segments.forEach((g,i)=>{const separated=i<accepted,bottom=separated?bottoms[i]:0;g.position.set(g.userData.center-(separated?.035*(accepted-i):0)+.15*bottom,-bottom,separated?.65:0);g.rotation.set(0,0,0);g.updateMatrix();g.matrixAutoUpdate=false;if(separated)g.matrix.elements[4]=-.15;faces[i].left.visible=i>0&&i<=accepted;faces[i].right.visible=i<accepted;});
 };
 update(0);return {root,segments,faces,planes:[...planes],update,surfaceHeight:(x:number)=>.25+ring(Math.max(-edge,Math.min(edge,x)),Math.PI/2).y};
}
