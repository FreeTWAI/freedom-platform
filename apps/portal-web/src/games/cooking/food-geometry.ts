import {BufferGeometry,ExtrudeGeometry,Float32BufferAttribute,LatheGeometry,Path,Shape,Vector2} from 'three';

/** UX-14: continuous ceramic well, curved rim, underside and a real foot ring. */
export function ceramicPlateGeometry(){
 const profile=[[0,-.035],[.66,-.035],[.69,-.07],[.69,-.14],[.73,-.15],[.77,-.13],[.78,-.05],[.9,.015],[.98,.105],[1.015,.17],[1.018,.195],[1.012,.215],[.999,.222],[.988,.211],[.98,.185],[.96,.14],[.88,.102],[.74,.085],[0,.085]];
 const g=new LatheGeometry(profile.map(([r,y])=>new Vector2(r,y)),96),index=g.getIndex()!,uv=g.getAttribute('uv'),body:number[]=[],rim:number[]=[];
 // Two contiguous draw groups; the thin glaze band is part of the plate surface.
 for(let i=0;i<index.count;i+=3){const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2),v=(uv.getY(a)+uv.getY(b)+uv.getY(c))/3;(v>10.9/18&&v<12.1/18?rim:body).push(a,b,c);}
 g.setIndex([...body,...rim]);g.clearGroups();g.addGroup(0,body.length,0);g.addGroup(body.length,rim.length,1);return g;
}

/** Seasoned cast iron has a recessed cooking floor and a thick rolled lip. */
export function ironPlatterGeometry(){
 return new LatheGeometry([[0,.11],[.7,.11],[.91,.11],[.98,.14],[1,.2],[1,.32],[.985,.36],[.96,.365],[.94,.34],[.935,.23],[.9,.17],[.82,.15],[0,.15]].map(([r,y])=>new Vector2(r,y)),96);
}

export function ironEarGeometry(){
 const shape=new Shape();shape.absellipse(0,0,.5,.25,0,Math.PI*2,false,0);
 const hole=new Path();hole.absellipse(0,0,.29,.11,0,Math.PI*2,true,0);shape.holes.push(hole);
 const g=new ExtrudeGeometry(shape,{depth:.1,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:3,curveSegments:32});g.rotateX(-Math.PI/2);return g;
}

export function servingBoardGeometry(){
 const shape=new Shape();shape.absellipse(0,0,2.7,1.85,0,Math.PI*2,false,0);
 const g=new ExtrudeGeometry(shape,{depth:.16,bevelEnabled:true,bevelSize:.065,bevelThickness:.055,bevelSegments:3,curveSegments:64});g.rotateX(-Math.PI/2);g.translate(0,-.095,0);return g;
}

/** UX-10: a sculpted cutlet with rounded thickness, never a straight extrusion. */
export function cutletGeometry(){
 const positions:number[]=[],uv:number[]=[],indices:number[]=[],segments=56,rings=9,stride=segments+1;
 for(const side of [1,-1])for(let row=0;row<=rings;row++)for(let col=0;col<=segments;col++){
  const a=col/segments*Math.PI*2,t=row/rings,r=(1+.11*Math.sin(a*3)+.065*Math.cos(a*5))*t,x=Math.cos(a)*r*1.35,z=Math.sin(a)*r*.88;
  const puff=Math.pow(Math.max(0,1-t*t),.55)*.27,edge=.065+Math.sin(a*7)*.012,y=side*(edge+puff)+(side>0?Math.sin(x*5+z*4)*.012*t:0);positions.push(x,y,z);uv.push(x/3.2+.5,z/2.2+.5);
 }
 const half=(rings+1)*stride;
 for(let side=0;side<2;side++)for(let r=0;r<rings;r++)for(let c=0;c<segments;c++){const a=side*half+r*stride+c,b=a+stride;if(side===0)indices.push(a,a+1,b,a+1,b+1,b);else indices.push(a,b,a+1,a+1,b,b+1);}
 const topCount=indices.length/2;for(let c=0;c<segments;c++){const a=rings*stride+c,b=half+a;indices.push(a,a+1,b,a+1,b+1,b);}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);g.addGroup(0,topCount,0);g.addGroup(topCount,topCount,1);g.addGroup(topCount*2,indices.length-topCount*2,2);g.computeVertexNormals();return g;
}

/** A thin rolled flatbread with open ends and an overlapping seam. */
export function wrapGeometry(){
 const positions:number[]=[],uv:number[]=[],indices:number[]=[],lengths=14,around=44;
 for(let i=0;i<=lengths;i++)for(let j=0;j<=around;j++){const u=i/lengths,v=j/around,a=1.7+v*6.05,x=(u-.5)*3.1,wrinkle=Math.sin(u*27+v*11)*.015;positions.push(x,.48+Math.sin(a)*(.41+wrinkle),Math.cos(a)*(.59+wrinkle));uv.push(u,v);}
 for(let i=0;i<lengths;i++)for(let j=0;j<around;j++){const a=i*(around+1)+j,b=a+around+1;indices.push(a,b,a+1,a+1,b,b+1);}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();return g;
}

export function leafGeometry(){
 const p:number[]=[],uv:number[]=[],idx:number[]=[],rows=10,cols=6;
 for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){const u=r/rows,v=c/cols-.5,width=Math.sin(u*Math.PI)*.8;const x=u*1.1-.55,z=v*width,y=Math.pow(Math.abs(v)*2,2)*.12+Math.sin(u*18+v*8)*Math.abs(v)*.05;p.push(x,y,z);uv.push(u,v+.5);}
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const a=r*(cols+1)+c,b=a+cols+1;idx.push(a,b,a+1,a+1,b,b+1);}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}


/** UX-11: a continuous, closed, slightly uneven batter shell, long axis Z. */
export function cornDogGeometry() {
 const positions: number[] = [], uv: number[] = [], top: number[] = [], bottom: number[] = [];
 const rows = 44, sides = 48, stride = sides + 1;
 for (let row = 0; row <= rows; row++) {
  const t = row / rows, z = -Math.cos(t * Math.PI) * 1.28;
  const profile = Math.pow(Math.sin(t * Math.PI), .37) * .34;
  for (let side = 0; side <= sides; side++) {
   const a = side / sides * Math.PI * 2;
   const thickness = 1 + .018 * Math.sin(a * 5 + z * 4) + .012 * Math.cos(a * 9 - z * 7);
   const r = profile * thickness;
   positions.push(Math.cos(a) * r + .018 * Math.sin(z * 2), Math.sin(a) * r * .9, z);
   uv.push(side / sides, t);
  }
 }
 for (let row = 0; row < rows; row++) for (let side = 0; side < sides; side++) {
  const a = row * stride + side, b = a + stride;
  const face = Math.sin((side + .5) / sides * Math.PI * 2) >= 0 ? top : bottom;
  face.push(a, a + 1, b, a + 1, b + 1, b);
 }
 const g = new BufferGeometry();
 g.setAttribute('position', new Float32BufferAttribute(positions, 3));
 g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
 g.setIndex([...top, ...bottom]);
 g.addGroup(0, top.length, 0); g.addGroup(top.length, bottom.length, 1);
 g.computeVertexNormals();
 return g;
}

/** An original folded paper food tray with a flat centre and rounded flared walls. */
export function paperTrayGeometry() {
 const positions: number[] = [], uv: number[] = [], indices: number[] = [], sides = 64;
 const profile = [[0, .015], [.79, .015], [.88, .08], [1, .39], [1.015, .405]];
 for (const [r, y] of profile) for (let i = 0; i <= sides; i++) {
  const a = i / sides * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
  const x = Math.sign(c) * Math.pow(Math.abs(c), .42) * 2.32 * r;
  const z = Math.sign(s) * Math.pow(Math.abs(s), .42) * 1.86 * r;
  positions.push(x, y + Math.abs(x * z) * r * .004, z);
  uv.push(x / 5 + .5, z / 4 + .5);
 }
 for (let row = 0; row < profile.length - 1; row++) for (let side = 0; side < sides; side++) {
  const a = row * (sides + 1) + side, b = a + sides + 1;
  indices.push(a, a + 1, b, a + 1, b + 1, b);
 }
 const g = new BufferGeometry();
 g.setAttribute('position', new Float32BufferAttribute(positions, 3));
 g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
 g.setIndex(indices); g.computeVertexNormals();
 return g;
}
