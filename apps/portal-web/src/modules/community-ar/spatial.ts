/** Original procedural meshes: no model downloads, executable scene files or
 * general-purpose 3D engine. Coordinates have real depth in the tracked pose. */
export type SpatialEffect='sparkle'|'halo'|'confetti';
type Vec3=readonly [number,number,number];
type MeshName='ring'|'gem'|'star'|'cube';
export type SpatialObject={mesh:MeshName;position:Vec3;rotation:Vec3;scale:Vec3;color:Vec3;opacity:number};
const lime:Vec3=[.77,1,.13],blue:Vec3=[.19,.36,1],cyan:Vec3=[.1,.85,1],pink:Vec3=[1,.31,.66];
export const IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply4(a:readonly number[],b:readonly number[]):number[]{
  return Array.from({length:16},(_,i)=>{const row=i%4,column=Math.floor(i/4);return a[row]*b[column*4]+a[row+4]*b[column*4+1]+a[row+8]*b[column*4+2]+a[row+12]*b[column*4+3];});
}
export function transform4(position:Vec3,rotation:Vec3,scale:Vec3):number[]{
  const [x,y,z]=rotation,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
  const rx=[1,0,0,0,0,cx,sx,0,0,-sx,cx,0,0,0,0,1],ry=[cy,0,-sy,0,0,1,0,0,sy,0,cy,0,0,0,0,1],rz=[cz,sz,0,0,-sz,cz,0,0,0,0,1,0,0,0,0,1];
  const matrix=multiply4(rz,multiply4(ry,rx));
  for(let column=0;column<3;column++)for(let row=0;row<3;row++)matrix[column*4+row]*=scale[column];
  matrix[12]=position[0];matrix[13]=position[1];matrix[14]=position[2];return matrix;
}
export function previewProjection(aspect:number):number[]{
  const f=1/Math.tan(Math.PI/8),near=.01,far=100;
  return [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
}
/** Same persisted effect IDs as earlier readers; upgraded presentation only. */
export function effectScene(effect:SpatialEffect,milliseconds:number):SpatialObject[]{
  const t=Number.isFinite(milliseconds)?milliseconds/1000:0;
  const objects:SpatialObject[]=[];
  const add=(mesh:MeshName,position:Vec3,rotation:Vec3,scale:Vec3,color:Vec3,opacity=1)=>objects.push({mesh,position,rotation,scale,color,opacity});
  if(effect==='halo'){
    add('ring',[0,0,.08],[0,0,t*.16],[.62,.62,.62],lime,.92);
    add('ring',[0,0,.16],[.55,.25,t*-.2],[.56,.56,.56],cyan,.78);
    add('ring',[0,0,.23],[.2,-.65,t*.27],[.49,.49,.49],blue,.88);
    add('gem',[0,0,.34+Math.sin(t*1.4)*.035],[.3,t*.65,.3],[.25,.3,.25],cyan);
    for(let i=0;i<10;i++){const a=i*Math.PI/5+t*.28;add('gem',[Math.cos(a)*.61,Math.sin(a)*.61,.14+Math.sin(a*2)*.1],[t,a,0],[.022,.035,.022],i%2?cyan:lime);}
  }else if(effect==='sparkle'){
    add('star',[0,0,.28+Math.sin(t*1.2)*.035],[.12,Math.sin(t*.6)*.5,t*.1],[.32,.32,.32],lime);
    add('ring',[0,0,.12],[.75,.1,-t*.2],[.5,.5,.5],cyan,.8);
    for(let i=0;i<12;i++){const a=i*Math.PI/6+t*.22,r=.5+.08*Math.sin(t+i);add('star',[Math.cos(a)*r,Math.sin(a)*r,.14+.17*(Math.sin(a)+1)],[.2,t*.6+i,a*.2],[.035,.035,.035],i%3===0?cyan:lime);}
  }else{
    add('cube',[0,0,.28],[t*.28,.5+t*.32,.2],[.25,.25,.25],blue);
    add('ring',[0,0,.08],[.4,.2,-t*.22],[.56,.56,.56],lime,.88);
    for(let i=0;i<24;i++){const a=i*2.399963+t*.15,r=.28+(i%5)*.065;add(i%4===0?'star':'cube',[Math.cos(a)*r,Math.sin(a)*r,.15+((i*.137+t*.14)%1)*.38],[t+i,i*.4,t*.4],[.025,.055,.018],[lime,cyan,pink][i%3]);}
  }
  return objects;
}
type Geometry={positions:Float32Array;normals:Float32Array};
export function spatialGeometry(name:MeshName):Geometry{
  const positions:number[]=[],normals:number[]=[];
  function triangle(a:Vec3,b:Vec3,c:Vec3){
    const u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal)||1;
    positions.push(...a,...b,...c);for(let i=0;i<3;i++)normals.push(...normal.map(n=>n/length));
  }
  if(name==='ring'){
    const point=(u:number,v:number):Vec3=>{const radius=1+Math.cos(v)*.025;return [Math.cos(u)*radius,Math.sin(u)*radius,Math.sin(v)*.025];};
    for(let i=0;i<48;i++)for(let j=0;j<6;j++){
      const u=i*Math.PI/24,w=(i+1)*Math.PI/24,v=j*Math.PI/3,z=(j+1)*Math.PI/3;
      triangle(point(u,v),point(w,v),point(w,z));triangle(point(u,v),point(w,z),point(u,z));
    }
  }else if(name==='gem'){
    const belt:Vec3[]=[[1,0,0],[0,1,0],[-1,0,0],[0,-1,0]];
    for(let i=0;i<4;i++){triangle(belt[i],belt[(i+1)%4],[0,0,1.5]);triangle(belt[(i+1)%4],belt[i],[0,0,-.7]);}
  }else if(name==='star'){
    const points:Vec3[]=Array.from({length:10},(_,i)=>{const a=i*Math.PI/5+Math.PI/2,r=i%2?.44:1;return [Math.cos(a)*r,Math.sin(a)*r,.14];});
    for(let i=0;i<10;i++){
      const a=points[i],b=points[(i+1)%10],backA:Vec3=[a[0],a[1],-.14],backB:Vec3=[b[0],b[1],-.14];
      triangle([0,0,.14],a,b);triangle([0,0,-.14],backB,backA);triangle(a,backA,backB);triangle(a,backB,b);
    }
  }else{
    const p:Vec3[]=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
    for(const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[1,2,6,5],[0,4,7,3]]){triangle(p[a],p[b],p[c]);triangle(p[a],p[c],p[d]);}
  }
  return {positions:new Float32Array(positions),normals:new Float32Array(normals)};
}
const VERTEX=`attribute vec3 aPosition;attribute vec3 aNormal;
uniform mat4 uMatrix;uniform mat3 uNormal;varying vec3 vNormal;varying vec3 vPosition;
void main(){vNormal=normalize(uNormal*aNormal);vPosition=aPosition;gl_Position=uMatrix*vec4(aPosition,1.0);}`;
const FRAGMENT=`precision mediump float;varying vec3 vNormal;varying vec3 vPosition;uniform vec3 uColor;uniform float uOpacity;
void main(){vec3 n=normalize(vNormal);float light=.35+.65*abs(dot(n,normalize(vec3(-.4,.7,1.0))));
float rim=pow(1.0-abs(n.z),2.0);vec3 color=uColor*light+vec3(.18,.3,.4)*rim;
gl_FragColor=vec4(color,uOpacity);}`;
type GpuMesh={position:WebGLBuffer;normal:WebGLBuffer;count:number};
export class ArSpatialRenderer{
  private gl:WebGLRenderingContext;private program:WebGLProgram;private meshes=new Map<MeshName,GpuMesh>();
  private locations:{position:number;normal:number;matrix:WebGLUniformLocation;rotation:WebGLUniformLocation;color:WebGLUniformLocation;opacity:WebGLUniformLocation};
  private lost=false;private disposed=false;
  private onLost=(event:Event)=>{event.preventDefault();this.lost=true;this.canvas.dataset.renderer='fallback';};
  static create(canvas:HTMLCanvasElement):ArSpatialRenderer|null{
    try{return new ArSpatialRenderer(canvas);}catch{canvas.dataset.renderer='fallback';return null;}
  }
  private constructor(readonly canvas:HTMLCanvasElement){
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,depth:true,powerPreference:'low-power'});
    if(!gl)throw new Error('ar_3d_unavailable');this.gl=gl;
    const program=gl.createProgram();if(!program)throw new Error('ar_3d_unavailable');this.program=program;
    const shaders:WebGLShader[]=[];
    try{
      for(const [kind,source] of [[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]] as const){const shader=gl.createShader(kind);if(!shader)throw new Error('ar_3d_unavailable');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);gl.attachShader(program,shader);}
      gl.bindAttribLocation(program,0,'aPosition');gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('ar_3d_unavailable');
      const uniform=(name:string)=>{const location=gl.getUniformLocation(program,name);if(location===null)throw new Error('ar_3d_unavailable');return location;};
      this.locations={position:0,normal:gl.getAttribLocation(program,'aNormal'),matrix:uniform('uMatrix'),rotation:uniform('uNormal'),color:uniform('uColor'),opacity:uniform('uOpacity')};
      for(const name of ['ring','gem','star','cube'] as const){
        const geometry=spatialGeometry(name),position=gl.createBuffer(),normal=gl.createBuffer();
        if(!position||!normal){if(position)gl.deleteBuffer(position);if(normal)gl.deleteBuffer(normal);throw new Error('ar_3d_unavailable');}
        this.meshes.set(name,{position,normal,count:geometry.positions.length/3});
        gl.bindBuffer(gl.ARRAY_BUFFER,position);gl.bufferData(gl.ARRAY_BUFFER,geometry.positions,gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER,normal);gl.bufferData(gl.ARRAY_BUFFER,geometry.normals,gl.STATIC_DRAW);
      }
      canvas.addEventListener('webglcontextlost',this.onLost);canvas.dataset.renderer='webgl';
    }catch(error){for(const mesh of this.meshes.values()){gl.deleteBuffer(mesh.position);gl.deleteBuffer(mesh.normal);}gl.deleteProgram(program);throw error;}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  render(effect:SpatialEffect,world:readonly number[],projection:readonly number[],dimensions:readonly [number,number],time:number,width:number,height:number):boolean{
    if(this.disposed||this.lost||world.length!==16||projection.length!==16||![...world,...projection,...dimensions,width,height].every(Number.isFinite)||dimensions.some(n=>n<=0)||width<=0||height<=0)return false;
    const gl=this.gl,ratio=Math.min(1,1280/Math.max(width,height)),w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    gl.viewport(0,0,w,h);gl.clearColor(0,0,0,0);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(this.program);
    gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    const unit=Math.min(...dimensions),base=multiply4(world,transform4([dimensions[0]/2,dimensions[1]/2,0],[0,0,0],[unit,unit,unit]));
    const scene=effectScene(effect,time);let triangles=0;
    for(const object of scene){
      const local=transform4(object.position,object.rotation,object.scale),model=multiply4(base,local),matrix=multiply4(projection,model),normal:number[]=[];
      for(let column=0;column<3;column++){const length=Math.hypot(model[column*4],model[column*4+1],model[column*4+2])||1;normal.push(model[column*4]/length,model[column*4+1]/length,model[column*4+2]/length);}
      const mesh=this.meshes.get(object.mesh)!;
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.position);gl.enableVertexAttribArray(this.locations.position);gl.vertexAttribPointer(this.locations.position,3,gl.FLOAT,false,0,0);
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.normal);gl.enableVertexAttribArray(this.locations.normal);gl.vertexAttribPointer(this.locations.normal,3,gl.FLOAT,false,0,0);
      gl.uniformMatrix4fv(this.locations.matrix,false,new Float32Array(matrix));gl.uniformMatrix3fv(this.locations.rotation,false,new Float32Array(normal));
      gl.uniform3f(this.locations.color,...object.color);gl.uniform1f(this.locations.opacity,object.opacity);gl.depthMask(object.opacity>=1);
      gl.drawArrays(gl.TRIANGLES,0,mesh.count);triangles+=mesh.count/3;
    }
    this.canvas.dataset.drawCalls=String(scene.length);this.canvas.dataset.triangles=String(triangles);return true;
  }
  clear(){if(this.disposed||this.lost)return;this.gl.clearColor(0,0,0,0);this.gl.depthMask(true);this.gl.clear(this.gl.COLOR_BUFFER_BIT|this.gl.DEPTH_BUFFER_BIT);}
  dispose(loseContext=false){
    if(this.disposed)return;this.clear();this.disposed=true;this.canvas.removeEventListener('webglcontextlost',this.onLost);
    for(const mesh of this.meshes.values()){this.gl.deleteBuffer(mesh.position);this.gl.deleteBuffer(mesh.normal);}this.meshes.clear();this.gl.deleteProgram(this.program);
    this.canvas.width=1;this.canvas.height=1;this.canvas.dataset.renderer='stopped';
    if(loseContext)this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
