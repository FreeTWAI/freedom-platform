import {preparationSpan} from './ingredient-visuals';
import {BufferGeometry,Float32BufferAttribute,Group,Mesh,MeshStandardMaterial,DoubleSide,Vector3,Color} from 'three';

export const VOLUMETRIC_PREPARATION_IDS = ['potato','pumpkin','sweet-potato','mushroom'] as const;
export type PreparationId = typeof VOLUMETRIC_PREPARATION_IDS[number];
export function isVolumetricPreparation(id:string):id is PreparationId {return (VOLUMETRIC_PREPARATION_IDS as readonly string[]).includes(id);}

/** One original closed food, partitioned at the real knife planes. Internal
 * faces stay hidden until a domain-accepted cut. No textures or per-frame assets. */
export function createPreparationModel(id:PreparationId,planes:readonly number[],owned:Set<BufferGeometry>,materials:Map<string,MeshStandardMaterial>) {
 const root=new Group();root.name=`ingredient/${id}`;
 const edge=id==='mushroom'?9.3*preparationSpan(id)/2:2.604,bounds=[-edge,...planes,edge],segments:Group[]=[],faces:{left:Mesh;right:Mesh}[]=[];
 const colors=id==='potato'?['#ae7942','#f3dfa5']:id==='pumpkin'?['#cd6926','#f9b83d']:id==='sweet-potato'?['#8e3c4b','#efb944']:['#79543d','#f7eedc'];
 const material=(color:string)=>{let m=materials.get(color);if(!m){m=new MeshStandardMaterial({color,roughness:.67,side:DoubleSide});materials.set(color,m);}return m;};
 // The same analytic cross-section is evaluated on both sides of every seam.
 // Smooth normals on skin avoid the appearance of separate stacked objects.
 const ring=(x:number,angle:number)=>{
  const u=x/edge,envelope=Math.sqrt(Math.max(0,1-u*u)),s=Math.sin(angle),c=Math.cos(angle);
  // Root vegetables have a fixed centre, not a centre that sinks with
  // each radius. Their tips and lower shoulders therefore curve off the board.
  let y:number,z:number;
  if(id==='mushroom'){
   // Shorter long axis and a deeper dome read as a cap, not a capsule.
   // Keep the original depth; the food must not fill more of the board.
   z=c*1.18*envelope;
   y=1.25+(s>=0?1.02*s*envelope:.12*s*envelope);
  }else if(id==='pumpkin'){
   z=c*1.35*envelope;
   // Meridional lobes run from stem to base around the vertical axis, rather
   // than the horizontal stripes of a ribbed loaf. Keep x knife planes fixed.
   const azimuth=Math.atan2(z,x),polarRadius=Math.min(1,Math.hypot(x/edge,z/1.35)),lobe=1+.065*Math.cos(azimuth*10)*polarRadius;
   z*=lobe;
   const poleDent=.20*Math.exp(-(x*x+z*z)/.22);
   y=1.55+1.50*s*envelope*lobe-Math.max(0,s)*poleDent;
  }else{
   const irregular=id==='potato'?1+.035*Math.sin(x*3+angle*3):1;
   z=c*(id==='sweet-potato'?.75:1.06)*envelope*irregular;
   y=.78+.72*s*envelope*irregular+(id==='sweet-potato'?.10*u:0);
  }
  return new Vector3(x,y,z);
 };
 // A gently waisted stalk flares into the cap and has a real flat foot.
 const stalkRadius=(y:number)=>.42-.10*Math.sin(Math.PI*y/1.25);
 const stalkWidth=(x:number,y:number)=>Math.sqrt(Math.max(0,stalkRadius(y)**2-x*x));
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
  for(let vertex=0;vertex<p.length;vertex+=3){const x=p[vertex]+center,y=p[vertex+1],z=p[vertex+2];let tone=1;if(id==='potato')for(const [ex,ey,ez] of [[-1.2,1.15,.35],[.3,1.35,.3],[1.25,1.05,-.15]])if(((x-ex)/.16)**2+((y-ey)/.18)**2+((z-ez)/.2)**2<1)tone=.48;if(id==='mushroom'){
    // Original vertex colour, not a painted image: cap skin and the radially
    // shaded underside occupy different surface triangles of the same solid.
    const tint=new Color(y<1.25-1e-6?'#bc9f85':colors[0]);
    if(y<1.25-1e-6)tint.multiplyScalar(.9+.1*Math.cos(12*Math.atan2(z,x))**2);
    tints.push(tint.r,tint.g,tint.b);
   }else tints.push(tone,tone,tone);}
  skinGeometry.setAttribute('color',new Float32BufferAttribute(tints,3));const skin=mesh(g,skinGeometry,id==='mushroom'?'#ffffff':colors[0]);(skin.material as MeshStandardMaterial).vertexColors=true;skin.name='preparation/skin';
  const cap=(x:number,side:number)=>{const points:number[]=[],normals:number[]=[],tints:number[]=[],mid=new Vector3(x,ring(x,0).y,0);
   const faceTriangle=(vertices:Vector3[],color:string)=>{for(const v of side<0?vertices:[...vertices].reverse()){points.push(v.x-center,v.y,v.z);normals.push(side,0,0);const tint=new Color(color);tints.push(tint.r,tint.g,tint.b);}};
   for(let k=0;k<radial;k++){
    const a=ring(x,k*Math.PI*2/radial),b=ring(x,(k+1)*Math.PI*2/radial);
    if(id==='mushroom'){
     // A thin real border follows the curved cap, surrounding pale flesh.
     // Top skin is brown; the lower edge belongs to the lighter underside.
     const ia=a.clone().lerp(mid,.045),ib=b.clone().lerp(mid,.045),border=k<radial/2?colors[0]:'#bc9f85';
     faceTriangle([mid,ia,ib],colors[1]);faceTriangle([ia,a,b],border);faceTriangle([ia,b,ib],border);
    }else for(const v of side<0?[mid,a,b]:[mid,b,a]){points.push(v.x-center,v.y,v.z);normals.push(side,0,0);const tint=new Color(id==='pumpkin'&&v===mid?'#8b5023':colors[1]);tints.push(tint.r,tint.g,tint.b);}
   }
   if(id==='mushroom'&&Math.abs(x)<.42)for(let j=0;j<12;j++){
    const y0=1.25*j/12,y1=1.25*(j+1)/12,z0=stalkWidth(x,y0),z1=stalkWidth(x,y1);
    const a=new Vector3(x,y0,-z0),b=new Vector3(x,y1,-z1),c=new Vector3(x,y1,z1),d=new Vector3(x,y0,z0);
    faceTriangle([a,c,b],colors[1]);faceTriangle([a,d,c],colors[1]);
   }
   // Small raised pumpkin seeds are part of the same face geometry, not
   // independent objects or texture stamps. They only appear at accepted cuts.
   if(id==='pumpkin'&&Math.abs(x)<edge*.82){const radius=Math.sqrt(1-(x/edge)**2);for(let seed=0;seed<5;seed++){const angle=seed*Math.PI*2/5,cy=mid.y+Math.sin(angle)*.25*radius,cz=Math.cos(angle)*.32*radius;for(let j=0;j<12;j++){for(const [y,z] of [[cy,cz],[cy+Math.sin(j*Math.PI/6)*.085,cz+Math.cos(j*Math.PI/6)*.035],[cy+Math.sin((j+1)*Math.PI/6)*.085,cz+Math.cos((j+1)*Math.PI/6)*.035]]){points.push(x-center+side*.006,y,z);normals.push(side,0,0);const tint=new Color('#fff0bd');tints.push(tint.r,tint.g,tint.b);}}}}
   const geo=geometry(points,normals);geo.setAttribute('color',new Float32BufferAttribute(tints,3));const key=`cut-face/${id}`;let faceMaterial=materials.get(key);if(!faceMaterial){faceMaterial=new MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.69,side:DoubleSide});if(id==='mushroom'){faceMaterial.emissive.set('#f7eedc');faceMaterial.emissiveIntensity=.08;}materials.set(key,faceMaterial);}const m=new Mesh(geo,faceMaterial);m.castShadow=m.receiveShadow=true;g.add(m);m.name=side<0?'preparation/left-face':'preparation/right-face';m.visible=false;return m;};
  faces.push({left:cap(left,-1),right:cap(right,1)});
 }
 // Partition the stalk at the same knife planes, including an exact central
 // cut. Its cross-section joins the cap's flesh face rather than moving whole.
 if(id==='mushroom')segments.forEach((g,i)=>{
  const left=Math.max(-.42,bounds[i]),right=Math.min(.42,bounds[i+1]);if(left>=right)return;
  const p:number[]=[],n:number[]=[],vertex=(x:number,y:number,side:number)=>new Vector3(x-g.position.x,y,side*stalkWidth(x,y));
  const emit=(vertices:Vector3[],capNormal=0)=>{for(const v of vertices){p.push(v.x,v.y,v.z);const r=stalkRadius(v.y),slope=-.10*Math.PI/1.25*Math.cos(Math.PI*v.y/1.25),normal=capNormal?new Vector3(0,capNormal,0):new Vector3(v.x+g.position.x,-r*slope,v.z).normalize();n.push(normal.x,normal.y,normal.z);}};
  for(let row=0;row<12;row++)for(let col=0;col<12;col++){
   const y0=1.25*row/12,y1=1.25*(row+1)/12;
   const at=(y:number,f:number)=>{const r=stalkRadius(y),lo=Math.max(-r,Math.min(r,left)),hi=Math.max(-r,Math.min(r,right));return lo+(hi-lo)*f;};
   for(const side of [-1,1]){const a=vertex(at(y0,col/12),y0,side),b=vertex(at(y1,col/12),y1,side),c=vertex(at(y1,(col+1)/12),y1,side),d=vertex(at(y0,(col+1)/12),y0,side);emit(side>0?[a,c,b,a,d,c]:[a,b,c,a,c,d]);}
  }
  for(const y of [0,1.25])for(let col=0;col<12;col++){
   const x0=left+(right-left)*col/12,x1=left+(right-left)*(col+1)/12,a=vertex(x0,y,-1),b=vertex(x1,y,-1),c=vertex(x1,y,1),d=vertex(x0,y,1);emit(y===0?[a,b,c,a,c,d]:[a,c,b,a,d,c],y===0?-1:1);
  }
  mesh(g,geometry(p,n),colors[1]).name='preparation/stalk';
 });
 if(id==='pumpkin'){
  const x=.16,index=bounds.findIndex((end,i)=>i>0&&x<end)-1,g=segments[index],base=ring(x,Math.PI/2).y,p:number[]=[];
  for(let k=0;k<16;k++){const a=k*Math.PI/8,b=(k+1)*Math.PI/8;for(const [y,t] of [[0,a],[.36,a],[.36,b],[0,a],[.36,b],[0,b]])p.push(x-g.position.x+ .12*Math.cos(t)+y*.35,base+y,-.05+.12*Math.sin(t));}
  mesh(g,geometry(p),'#665234').name='preparation/stem';
 }
 const bottoms=segments.map(g=>g.children.reduce((bottom,part)=>Math.min(bottom,(part as Mesh).geometry.boundingBox!.min.y),Infinity));
 root.position.y=.25;let remainingBottom=0;
 // All separated slices share the same gentle lean, keeping their bottom
 // edges on the board. In x+.15*y coordinates their knife planes remain
 // parallel, with .035 gaps: independent yaw would intersect neighbouring food.
 // Lower each cut to its own bottom, compensating x for that vertical offset
 // so the same separation proof also holds for stalk-free mushroom cap slices.
 const update=(count:number)=>{const accepted=Math.max(0,Math.min(planes.length,Math.floor(count)));
  // Once the last stalk section is cut, settle the connected cap as one body.
  // Its x planes stay fixed, and the knife uses this same vertical offset.
  remainingBottom=Math.min(...bottoms.slice(accepted));
  segments.forEach((g,i)=>{const separated=i<accepted,bottom=separated?bottoms[i]:remainingBottom;g.position.set(g.userData.center-(separated?.035*(accepted-i):0)+(separated?.15*bottom:0),-bottom,separated?.65:0);g.rotation.set(0,0,0);g.updateMatrix();g.matrixAutoUpdate=false;if(separated)g.matrix.elements[4]=-.15;faces[i].left.visible=i>0&&i<=accepted;faces[i].right.visible=i<accepted;});
 };
 update(0);return {root,segments,faces,planes:[...planes],update,surfaceHeight:(x:number)=>.25-remainingBottom+ring(Math.max(-edge,Math.min(edge,x)),Math.PI/2).y};
}
