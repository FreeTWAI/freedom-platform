import {DataTexture,LinearFilter,LinearMipmapLinearFilter,RepeatWrapping,RGBAFormat,SRGBColorSpace} from 'three';
export type FoodSurface='food'|'wood'|'meat'|'sear'|'bread'|'batter'|'rice'|'paper';
const hash=(x:number,y:number)=>{let h=Math.imul(x,374761393)^Math.imul(y,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
const smooth=(t:number)=>t*t*(3-2*t);
function noise(x:number,y:number){const a=Math.floor(x),b=Math.floor(y),u=smooth(x-a),v=smooth(y-b),top=hash(a,b)*(1-u)+hash(a+1,b)*u,bottom=hash(a,b+1)*(1-u)+hash(a+1,b+1)*u;return top*(1-v)+bottom*v;}
const blend=(a:number[],b:number[],t:number)=>a.map((n,i)=>n+(b[i]-n)*Math.max(0,Math.min(1,t)));

/** UX-10: original ingredient-specific pigment, crust and fibre fields. Deterministic, 256px, no image assets. */
export function foodTexture(kind:FoodSurface,size=256){
 const data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size,v=y/size,n=noise(u*9,v*9),fine=hash(x,y);let rgb=[245+fine*7,245+fine*7,245+fine*7];
  if(kind==='wood'){const grain=Math.sin(v*310+noise(u*5,v*2)*8)*.5+.5,plank=Math.floor(v*7),shade=.78+hash(plank,91)*.15+grain*.05+noise(u*45,v*4)*.05;rgb=[255*shade,246*shade,229*shade];}
  if(kind==='meat'){
   const fibres=Math.abs(Math.sin(u*54+noise(u*3,v*6)*9+v*10)),fat=Math.max(0,1-fibres/.12)*.7;
   rgb=blend([174+n*48,57+n*29,49+n*23],[241,208,171],fat);const vein=Math.max(0,.045-Math.abs(Math.sin(u*17-v*6+noise(u*4,v*4)*3)))/.045;rgb=blend(rgb,[225,178,143],vein*.65);
  }
  if(kind==='sear'){
   const edge=Math.min(1,Math.hypot((u-.5)*1.8,(v-.5)*1.8)),crust=noise(u*72,v*68),scorch=Math.max(0,(noise(u*27,v*29)-.45)*.95)+Math.max(0,edge-.7)*.55;
   rgb=blend([159+crust*35,91+crust*28,42+crust*21],[66,37,19],scorch);if(fine>.986)rgb=blend(rgb,[83,47,22],.45);
   const bands=Math.abs(Math.sin((u+v*.28)*28+noise(u*3,v*3)*.7));if(bands<.1)rgb=blend(rgb,[54,34,19],.55);
  }
  if(kind==='bread'){
   const patch=noise(u*29,v*31)*.8+n*.2,brown=Math.max(0,(patch-.64)*3.5);rgb=blend([248,224,173],[133,76,33],brown);if(fine>.994)rgb=blend(rgb,[162,116,61],.5);
  }
  if(kind==='batter'){
   const crisp=noise(u*43,v*61),shade=.84+crisp*.12+n*.04;rgb=[255*shade,249*shade,236*shade];const freckle=Math.max(0,(noise(u*71,v*89)-.68)*2);rgb=blend(rgb,[181,159,131],freckle*.35);
  }
  if(kind==='paper'){const fibre=Math.sin(u*420+v*17)*.5+.5;rgb=[248+n*7,246+n*7,239+n*8].map(c=>c*(.985+fibre*.015));}
  if(kind==='rice'){
   rgb=[242+n*10,221+n*12,171+n*18];const cx=Math.floor(x/9),cy=Math.floor(y/8),angle=hash(cx,cy)*6.28,dx=x%9-4.5,dy=y%8-4,a=dx*Math.cos(angle)+dy*Math.sin(angle),b=-dx*Math.sin(angle)+dy*Math.cos(angle),grain=a*a/16+b*b/2.7;if(grain<1)rgb=blend(rgb,[253,236,191],.28*(1-grain));
  }
  const i=(y*size+x)*4;for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,Math.round(rgb[c])));data[i+3]=255;
 }
 const t=new DataTexture(data,size,size,RGBAFormat);t.wrapS=t.wrapT=RepeatWrapping;t.magFilter=LinearFilter;t.minFilter=LinearMipmapLinearFilter;t.generateMipmaps=true;t.colorSpace=SRGBColorSpace;t.needsUpdate=true;return t;
}


/** UX-11: height and roughness describe microgeometry, independently of pigment. */
export function foodRelief(kind: FoodSurface, size = 256) {
 const height = new Uint8Array(size * size * 4), roughness = new Uint8Array(size * size * 4);
 for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const u=x/size, v=y/size, micro=hash(x,y), soft=noise(u*58,v*73);
  let h=.5+(soft-.5)*.12+(micro-.5)*.09, r=.76+(soft-.5)*.12;
  if(kind==='batter') {const pore=Math.max(0,(noise(u*99,v*121)-.64)*2);h=.52-pore*.25+(micro-.5)*.06;r=.71+pore*.16;}
  if(kind==='meat'||kind==='sear') {const fibre=Math.sin(u*155+noise(u*9,v*13)*3);h=.5+fibre*.035+(soft-.5)*.17;r=(kind==='meat'?.54:.67)+(soft-.5)*.2;}
  if(kind==='wood') {h=.5+Math.sin(v*310+noise(u*5,v*2)*8)*.07;r=.91;}
  if(kind==='paper') {h=.5+(micro-.5)*.1;r=.94;}
  const i=(y*size+x)*4;
  for(let c=0;c<3;c++){height[i+c]=Math.round(h*255);roughness[i+c]=Math.round(r*255);}height[i+3]=roughness[i+3]=255;
 }
 function texture(data:Uint8Array){const t=new DataTexture(data,size,size,RGBAFormat);t.wrapS=t.wrapT=RepeatWrapping;t.magFilter=LinearFilter;t.minFilter=LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;}
 return {height:texture(height),roughness:texture(roughness)};
}
