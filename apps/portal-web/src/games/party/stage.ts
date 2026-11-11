import {BoxGeometry,CanvasTexture,Color,CylinderGeometry,DataTexture,DirectionalLight,Group,HemisphereLight,Mesh,MeshBasicMaterial,MeshToonMaterial,MeshStandardMaterial,NearestFilter,NoToneMapping,ACESFilmicToneMapping,RepeatWrapping,OrthographicCamera,PCFShadowMap,PerspectiveCamera,PlaneGeometry,Raycaster,RedFormat,Scene,SphereGeometry,SRGBColorSpace,TorusGeometry,Vector2,Vector3,WebGLRenderer,type BufferGeometry,type Material,type Texture} from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {bakeRigidGroup} from '../stage-batch';
import {createTofuOpaqueBatch} from './tofu-batch';
import {partyViewport,partyBufferSize,withPartyCaptureView} from './viewport';
import {PARTY_RULES as R,type PartyGameId} from './catalog';
import {chairJump,chairWave,holidayOpen,holidayTargets,tofuAxis,tofuPosition,type PartyRun,type TofuLayer} from './domain';

export type PartyStage={update:(s:PartyRun,motion:boolean)=>void;capture:()=>string;pick:(x:number,y:number)=>number|null;anchors:()=>{hole:number;x:number;y:number}[];stats:()=>{calls:number;triangles:number;geometries:number;textures:number};dispose:()=>void};
const ORIGINAL_PALETTE={ink:'#45433b',cream:'#fff0c9',sage:'#74ae98',leaf:'#397c5e',peach:'#e99773',gold:'#f0bb53',lilac:'#b6a0c8',navy:'#627799',wood:'#c59663'};

/** PT-6: one bounded, original miniature set per mount. No network assets. */
export function createPartyStage(host:HTMLElement,game:PartyGameId,onLost:()=>void):PartyStage {
  const C=game==='chair'?{...ORIGINAL_PALETTE,ink:'#17233e',sage:'#65d4cf',leaf:'#21b9b2',peach:'#f58eab',gold:'#f5d96a',navy:'#384766',wood:'#26354d'}:game==='tofu'?{...ORIGINAL_PALETTE,ink:'#363c36',sage:'#7aaba1',leaf:'#3d6b5e',peach:'#c17e5d',gold:'#c8a266',navy:'#405b60',wood:'#81674c'}:{...ORIGINAL_PALETTE,ink:'#463957',sage:'#98bc58',leaf:'#407944',peach:'#ee835c',gold:'#f6ca64',navy:'#65609a',wood:'#b16f4a'};
  const renderer=new WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power',preserveDrawingBuffer:true});
  const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
  let resizeObserver:ResizeObserver|undefined,styleObserver:MutationObserver|undefined;
  let disposed=false,lastMotion=false,capturing=false,last:PartyRun|null=null,tofuBatch:ReturnType<typeof createTofuOpaqueBatch>|null=null;
  const key=new DirectionalLight(game==='chair'?'#ffd6a0':'#fff3dc',game==='chair'?2.1:1.4);
  let resize=()=>{},resizeSafely=()=>{};
  const lost=(e:Event)=>{e.preventDefault();if(!disposed)onLost();};
  const dispose=()=>{if(disposed)return;disposed=true;resizeObserver?.disconnect();styleObserver?.disconnect();window.removeEventListener('resize',resizeSafely);renderer.domElement.removeEventListener('webglcontextlost',lost);tofuBatch?.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());key.shadow.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
  try {
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,R.maxDpr));renderer.setSize(640,480,false);renderer.toneMapping=game==='holiday'?NoToneMapping:ACESFilmicToneMapping;renderer.toneMappingExposure=game==='chair'?1.2:1.05;renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;
    renderer.domElement.setAttribute('aria-hidden','true');renderer.domElement.addEventListener('webglcontextlost',lost);host.append(renderer.domElement);
    const scene=new Scene();scene.background=new Color(game==='holiday'?'#f4dfb1':game==='chair'?'#142039':'#dbe3d8');
    const camera=game==='chair'?new PerspectiveCamera(43,4/3,.1,80):new OrthographicCamera(-6,6,4.5,-4.5,.1,80);
    const ray=new Raycaster(),world=new Group();ray.layers.set(1);scene.add(world);
    scene.add(new HemisphereLight(game==='chair'?'#c9edff':'#fff9ed',game==='chair'?'#273759':'#a7a28e',1.1));key.position.set(-5,10,7);key.castShadow=true;key.shadow.mapSize.set(512,512);Object.assign(key.shadow.camera,{left:-8,right:8,top:9,bottom:-15,near:.5,far:30});key.shadow.normalBias=.04;scene.add(key);
    const gradient=new DataTexture(new Uint8Array([105,190,255]),3,1,RedFormat);gradient.minFilter=NearestFilter;gradient.magFilter=NearestFilter;gradient.needsUpdate=true;textures.add(gradient);
    const geo=<T extends BufferGeometry>(g:T):T=>{geometries.add(g);return g;};
    const round=geo(new RoundedBoxGeometry(1,1,1,3,.16)),box=geo(new BoxGeometry(1,1,1)),sphere=geo(new SphereGeometry(1,20,14)),cylinder=geo(new CylinderGeometry(1,1,1,24)),torus=geo(new TorusGeometry(1,.075,8,32)),plane=geo(new PlaneGeometry(1,1));
    const palette=new Map<string,MeshToonMaterial|MeshStandardMaterial>();
    function mat(color:string){let m=palette.get(color);if(!m){m=game==='holiday'?new MeshToonMaterial({color,gradientMap:gradient}):new MeshStandardMaterial({color,roughness:game==='chair'?.48:.94,metalness:game==='chair'?.22:0});materials.add(m);palette.set(color,m);}return m;}
    function mesh(p:Group,g:BufferGeometry,c:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx){const m=new Mesh(g,mat(c));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;p.add(m);return m;}
    const rb=(p:Group,c:string,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>mesh(p,round,c,x,y,z,sx,sy,sz);
    const ball=(p:Group,c:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx)=>mesh(p,sphere,c,x,y,z,sx,sy,sz);
    // Architectural beams are hard-edged set pieces, not rounded toy bodies.
    const beam=(p:Group,c:string,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>mesh(p,box,c,x,y,z,sx,sy,sz);
    const group=(p:Group,x=0,y=0,z=0)=>{const g=new Group();g.position.set(x,y,z);p.add(g);return g;};
    function canvasTexture(draw:(c:CanvasRenderingContext2D)=>void,w=256,h=256){const el=document.createElement('canvas');el.width=w;el.height=h;const ctx=el.getContext('2d');if(!ctx)throw Error('無法建立派對場景。');draw(ctx);const t=new CanvasTexture(el);t.colorSpace=SRGBColorSpace;textures.add(t);return t;}
    function decal(p:Group,t:Texture,x:number,y:number,z:number,w:number,h:number){const m=new MeshBasicMaterial({map:t,transparent:true,toneMapped:false});materials.add(m);const o=new Mesh(plane,m);o.position.set(x,y,z);o.scale.set(w,h,1);p.add(o);return o;}
    const face=canvasTexture(ctx=>{ctx.strokeStyle=C.ink;ctx.fillStyle=C.ink;ctx.lineCap='round';ctx.lineWidth=9;for(const x of [82,174]){ctx.beginPath();ctx.ellipse(x,107,8,12,0,0,Math.PI*2);ctx.fill();}ctx.beginPath();ctx.arc(128,126,23,.15,Math.PI-.15);ctx.stroke();ctx.fillStyle='#d98c7d';ctx.beginPath();ctx.ellipse(57,132,14,7,0,0,7);ctx.ellipse(199,132,14,7,0,0,7);ctx.fill();});
    function sign(p:Group,title:string,sub:string,x:number,y:number,z:number,w=2.6){const t=canvasTexture(ctx=>{ctx.fillStyle=C.leaf;ctx.fillRect(0,0,512,152);ctx.fillStyle=C.cream;ctx.font='800 43px system-ui';ctx.textAlign='center';ctx.fillText(title,256,66);ctx.font='500 22px system-ui';ctx.fillText(sub,256,112);},512,152);rb(p,C.wood,x,y,z-.06,w+.16,w*.31+.16,.14);return decal(p,t,x,y,z+.03,w,w*152/512);}
    function leaf(p:Group,x:number,y:number,z:number,scale=1){const l=ball(p,C.leaf,x,y,z,.14*scale,.32*scale,.07*scale);l.rotation.z=-.65;rb(p,C.gold,x-.02,y-.1*scale,z,.035*scale,.27*scale,.03*scale);}
    function plant(p:Group,x:number,z:number){const g=group(p,x,0,z);mesh(g,cylinder,C.peach,0,.25,0,.3,.5,.3);for(let i=0;i<3;i++){const a=i*2.2;const l=ball(g,i%2?C.sage:C.leaf,Math.cos(a)*.23,.7+i*.14,Math.sin(a)*.23,.17,.5,.13);l.rotation.z=(i-1)*.45;}bakeRigidGroup(g,geometries);return g;}
    // Three authored sets, not a single recoloured room. Textures are generated
    // once per mount and disposed with the renderer; no network or per-frame allocation.
    const floor=canvasTexture(ctx=>{
      ctx.fillStyle=game==='chair'?'#243450':game==='tofu'?'#b9a486':'#ead29c';ctx.fillRect(0,0,512,512);
      if(game==='chair'){
        ctx.strokeStyle='#465572';ctx.lineWidth=2;for(let i=0;i<=8;i++){ctx.beginPath();ctx.moveTo(i*64,0);ctx.lineTo(i*64,512);ctx.moveTo(0,i*64);ctx.lineTo(512,i*64);ctx.stroke();}
        for(const x of [132,380]){ctx.fillStyle='#54b7b7';ctx.fillRect(x,0,3,512);}
      }else if(game==='tofu'){
        for(let row=0;row<16;row++){ctx.fillStyle=row%2?'#b19a7a':'#c4b090';ctx.fillRect(0,row*32,512,30);ctx.strokeStyle='#9f8869';ctx.lineWidth=1;for(let j=0;j<3;j++){ctx.beginPath();ctx.moveTo(0,row*32+8+j*7);ctx.bezierCurveTo(150,row*32+4+j*7,350,row*32+12+j*7,512,row*32+8+j*7);ctx.stroke();}}
      }else{
        ctx.strokeStyle='#d4b77e';ctx.lineWidth=1;for(let y=0;y<512;y+=8){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y+2);ctx.stroke();}
        ctx.fillStyle='#dcbf85';for(let i=0;i<50;i++){const x=(i*97)%512,y=(i*137)%512;ctx.fillRect(x,y,2,2);}
      }
    },512,512);
    // Continuous set floor extends beyond the safe gameplay core in every aspect.
    floor.wrapS=floor.wrapT=RepeatWrapping;floor.repeat.set(4,game==='chair'?3:4);
    rb(world,game==='chair'?'#17233e':game==='tofu'?'#81674c':'#bf9062',0,-.25,-1.4,64,.5,64);
    // Construct the lit floor with its intended material, not a basic decal.
    const floorSurface=new MeshStandardMaterial({map:floor,roughness:game==='chair'?.58:.96,metalness:game==='chair'?.18:0});materials.add(floorSurface);
    const ground=new Mesh(plane,floorSurface);ground.position.set(0,.012,-1.4);ground.scale.set(64,64,1);ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;world.add(ground);
    const scenery=group(world);
    function backdrop(kind:PartyGameId){return canvasTexture(ctx=>{
      const grad=ctx.createLinearGradient(0,0,0,512);grad.addColorStop(0,kind==='chair'?'#12203c':kind==='tofu'?'#e9ede3':'#f9e9b8');grad.addColorStop(1,kind==='chair'?'#52647e':kind==='tofu'?'#c0d1c6':'#e7c68d');ctx.fillStyle=grad;ctx.fillRect(0,0,1024,512);
      if(kind==='chair'){
        ctx.fillStyle='#edc883';ctx.beginPath();ctx.arc(735,125,42,0,Math.PI*2);ctx.fill();
        for(let i=0;i<22;i++){const h=70+(i*73)%210,x=i*49;ctx.fillStyle=i%2?'#23344e':'#1b2c45';ctx.fillRect(x,512-h,45,h);ctx.fillStyle='#c9ac76';for(let y=520-h;y<500;y+=22)for(let col=0;col<3;col++)if((i+col+y)%3)ctx.fillRect(x+8+col*11,y,4,7);}
      }else if(kind==='tofu'){
        ctx.fillStyle='#d8b675';ctx.beginPath();ctx.arc(750,130,48,0,Math.PI*2);ctx.fill();
        for(let layer=0;layer<3;layer++){ctx.fillStyle=['#c2cec2','#a8bbae','#809e91'][layer];ctx.beginPath();ctx.moveTo(0,512);for(let x=0;x<=1024;x+=32)ctx.lineTo(x,250+layer*68+Math.sin(x/120+layer)*45+Math.sin(x/51)*12);ctx.lineTo(1024,512);ctx.fill();}
      }else{
        for(let i=0;i<4;i++){ctx.fillStyle=i%2?'#b5c676':'#8ead62';ctx.beginPath();ctx.ellipse(i*310,520,390,150+i%2*55,0,0,Math.PI*2);ctx.fill();}
        ctx.fillStyle='#fff5d6';for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(120+i*250,105+i%2*45,80,22,0,0,Math.PI*2);ctx.fill();}
      }
    },1024,512);}
    const panorama=backdrop(game);scene.background=panorama;
    const papers=Array.from({length:12},(_,i)=>{const p=mesh(world,box,[C.cream,C.gold,C.peach][i%3],0,0,0,.12,.025,.19);p.visible=false;return p;});
    let chair:Group|null=null,wheels:Mesh[]=[],runnerProps:{hazard:Group;cart:Group;meeting:Group;ticket:Group}[]=[],tofus:Group[]=[],activeTofu:Group|null=null,crumb:Group|null=null;
    const landing=new Group(),landingMaterial=new MeshBasicMaterial({color:C.gold,transparent:true,opacity:.65,depthWrite:false});materials.add(landingMaterial);world.add(landing);landing.visible=false;
    // UX-7: the footprint projects the real moving layer, never a second physics state.
    const landingEdges=Array.from({length:4},()=>{const edge=new Mesh(round,landingMaterial);landing.add(edge);return edge;});
    const holes:Group[]=[],sprites:{body:Group;leaf:Group;tie:Group;label:Mesh}[]=[],proxies:Mesh[]=[],anchorPositions:Vector3[]=[];
    const ghostMaterials=new MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false});materials.add(ghostMaterials);
    function tofu(p:Group){const g=group(p);rb(g,C.cream,0,0,0,1,.94,1);rb(g,'#e5d5b5',0,-.3,0,1.01,.12,1.01);const stamp=decal(g,face,-.04,.482,.02,.48,.48);stamp.rotation.x=-Math.PI/2;leaf(g,.31,.54,-.22,.55);return g;}
    if(game==='chair'){
      camera.position.set(0,5.5,8.8);camera.lookAt(0,.75,-2.7);
      beam(scenery,C.ink,0,2.5,-13,12,5,.3);decal(scenery,panorama,0,8,-12.8,64,24);
      // Tall window architecture and a continuous floor, not a coloured letterbox.
      for(const side of [-1,1])for(const z of [-12,-4,4]){beam(scenery,C.wood,side*7,5,z,.22,10,.22);beam(scenery,C.sage,side*6.85,5,z,.035,8,.035);}
      for(const y of [5,9])beam(scenery,C.wood,0,y,-12.65,48,.12,.12);
      for(const x of [-5.7,-2.85,0,2.85,5.7])beam(scenery,C.wood,x,2.5,-12.65,.09,5,.08);
      for(const z of [-9,-5,-1])for(const side of [-1,1]){beam(scenery,C.wood,side*4.6,1.6,z,.18,3.2,.18);beam(scenery,C.sage,side*4.48,1.6,z,.025,2.6,.035);beam(scenery,C.wood,side*4.6,.75,z+1,.15,.1,2.2);}
      sign(scenery,'今天準時下班','AFTER HOURS / 18:00',0,3.8,-12.5,4.2);
      for(const side of [-1,1]){beam(scenery,C.sage,side*3.6,.06,-4.5,.045,.035,19);beam(scenery,C.gold,side*3.8,.06,-4.5,.025,.025,19);}
      bakeRigidGroup(scenery,geometries);
      for(const x of [-1.5,1.5])rb(world,'#61708a',x,.028,-4.5,.035,.015,19);
      for(const x of [-5,5]){plant(world,x,-6);plant(world,x,-1);}
      // Seated long-eared bean: silhouette, sleeves, five wheel arms and tiny mug.
      chair=group(world,0,0,2.4);const seat=group(chair);
      rb(seat,C.navy,0,.9,0,.98,.22,.9);rb(seat,C.navy,0,1.42,-.34,1,.98,.2);rb(seat,C.sage,0,1.46,-.2,.78,.72,.14);
      mesh(seat,cylinder,C.ink,0,.48,0,.09,.75,.09);
      for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const arm=rb(seat,C.navy,Math.sin(a)*.26,.2,Math.cos(a)*.26,.09,.08,.62);arm.rotation.y=a;const wheel=mesh(seat,cylinder,C.ink,Math.sin(a)*.54,.13,Math.cos(a)*.54,.11,.09,.11);wheel.rotation.z=Math.PI/2;wheels.push(wheel);}
      for(const side of [-1,1]){rb(seat,C.navy,side*.57,1.14,0,.12,.08,.62);rb(seat,C.navy,side*.54,.99,-.2,.06,.35,.06);}
      ball(seat,C.sage,0,1.33,.12,.38,.47,.29);ball(seat,C.cream,0,1.94,.11,.44,.42,.38);decal(seat,face,0,1.93,.49,.72,.68);
      for(const side of [-1,1]){const ear=ball(seat,C.cream,side*.25,2.37,.07,.115,.32,.11);ear.rotation.z=-side*.2;ball(seat,C.peach,side*.26,2.41,.15,.05,.17,.025);ball(seat,C.sage,side*.38,1.38,.36,.13,.28,.12);rb(seat,C.navy,side*.23,1.01,.53,.23,.18,.46);rb(seat,C.gold,side*.23,.94,.77,.25,.16,.24);}
      const cup=group(seat,.5,1.22,.44);mesh(cup,cylinder,C.peach,0,0,0,.09,.19,.09);mesh(cup,torus,C.peach,.11,0,0,.07,.07,.07);
      bakeRigidGroup(seat,geometries,new Set(wheels));
      runnerProps=Array.from({length:4},()=>{
        const hazard=group(world),cart=group(hazard),meeting=group(hazard);
        for(const [model,low] of [[cart,true],[meeting,false]] as const){
          rb(model,low?C.peach:C.lilac,0,low?.5:.85,0,1.2,low?.25:.18,.82);
          for(const side of [-1,1])rb(model,C.ink,side*.46,low?.25:.4,0,.08,low?.5:.8,.54);
          rb(model,C.cream,-.23,low?.73:1,.06,.45,.06,.45);rb(model,C.peach,.29,low?.8:1.06,0,.22,.27,.22);
          if(!low){rb(model,C.navy,0,1.25,-.22,.72,.52,.07);decal(model,face,0,1.26,-.17,.56,.42);}
          sign(model,low?'跳！':'躲！',low?'UP':'LEFT / RIGHT',0,low?1.15:1.75,.5,.95);
          bakeRigidGroup(model,geometries);
        }
        const ticket=group(world);rb(ticket,C.gold,0,.85,0,.7,.86,.13);rb(ticket,C.cream,0,.85,.075,.58,.71,.02);leaf(ticket,0,.9,.12,.8);
        return {hazard,cart,meeting,ticket};
      });
    }else if(game==='tofu'){
      beam(scenery,C.wood,0,2.3,-5.1,11,4.6,.18);decal(scenery,panorama,0,7,-4.98,64,20);
      // Shoji posts continue upward into the portrait frame; layered mountains
      // remain visible behind the actual ceramic/wood set.
      for(const side of [-1,1]){beam(scenery,C.wood,side*6.8,5,-5.05,.14,10,.14);beam(scenery,C.wood,side*11,5,-5.05,.14,10,.14);}
      for(const y of [5.5,8.5])beam(scenery,C.wood,0,y,-5.05,28,.1,.1);
      for(const x of [-5.2,-2.6,0,2.6,5.2])beam(scenery,C.wood,x,2.3,-4.85,.08,4.5,.1);
      for(const y of [.2,2.3,4.4])beam(scenery,C.wood,0,y,-4.85,10.6,.07,.1);
      for(const side of [-1,1]){const stone=ball(scenery,'#888e80',side*4.3,.18,-2.3,.65,.3,.5);stone.rotation.y=side*.4;plant(scenery,side*4.3,-3.2);}
      sign(scenery,'豆腐建築事務所','一層一心 · SOFT TOFU',0,3.7,-4.65,3.1);bakeRigidGroup(scenery,geometries);
      mesh(world,cylinder,C.sage,0,.08,0,2.65,.17,2.65);mesh(world,cylinder,C.cream,0,.2,0,2.4,.17,2.4);mesh(world,torus,C.gold,0,.29,0,2.2,2.2,2.2).rotation.x=-Math.PI/2;
      const bottle=group(world,-3.6,.1,1.5);mesh(bottle,cylinder,C.wood,0,.5,0,.25,1,.25);rb(bottle,C.navy,0,1.06,0,.4,.2,.4);rb(bottle,C.cream,0,.5,.25,.35,.5,.03);
      const chop=rb(world,C.wood,3.4,.15,1.3,.09,.1,3);chop.rotation.y=.3;const chop2=rb(world,C.wood,3.7,.15,1.3,.09,.1,3);chop2.rotation.y=.3;
      tofus=Array.from({length:R.tofuGoal+1},()=>tofu(world));activeTofu=tofu(world);crumb=tofu(world);tofuBatch=createTofuOpaqueBatch(world,[...tofus,activeTofu,crumb]);
    }else{
      camera.position.set(3.8,8.6,9.5);camera.lookAt(0,.4,0);
      // Folded six-sided paper petals keep a readable silhouette without the
      // dense rounded-box tessellation being repeated in every shadow pass.
      const paperPetal=geo(new CylinderGeometry(1,1,1,6));
      decal(scenery,panorama,0,6,-5.3,64,20);
      const sun=mesh(scenery,cylinder,C.gold,-5.8,6.6,-5.05,1.4,.08,1.4);sun.rotation.x=Math.PI/2;
      for(const side of [-1,1]){const leaf=mesh(scenery,paperPetal,C.leaf,side*5.8,.9,3.7,1,2.3,.12);leaf.rotation.z=side*.4;}
      for(const side of [-1,1]){beam(scenery,C.wood,side*4.5,1.7,-4.5,.12,3.4,.12);for(let i=0;i<3;i++){const petal=ball(scenery,i%2?C.peach:C.gold,side*(4.25+i*.2),.55+i*.45,-3.7,.5,.7,.09);petal.rotation.z=side*(.3+i*.3);}}
      for(let i=0;i<9;i++){const flag=mesh(scenery,plane,[C.peach,C.leaf,C.navy][i%3],-4+i,2.9+Math.abs(4-i)*.09,-4.4,.65,.48,1);flag.rotation.z=(i%2?1:-1)*.12;}
      sign(scenery,'今日公休委員會','WEEKEND GARDEN CLUB',0,2,-4.5,3.8);bakeRigidGroup(scenery,geometries);
      const badgeTextures=([C.leaf,C.navy] as const).map((color,i)=>canvasTexture(ctx=>{ctx.fillStyle=C.cream;ctx.fillRect(0,0,256,128);ctx.fillStyle=color;ctx.font='900 64px "Microsoft JhengHei",sans-serif';ctx.textAlign='center';ctx.fillText(i?'開會':'休假',128,88);},256,128));
      for(let i=0;i<6;i++){
        const x=(i%3-1)*2.5,z=Math.floor(i/3)*2.6-1.35,hole=group(world,x,0,z);holes.push(hole);
        const rim=group(hole);mesh(rim,cylinder,C.wood,0,.2,0,.95,.4,.95);mesh(rim,cylinder,C.ink,0,.42,0,.79,.06,.79);mesh(rim,torus,C.gold,0,.47,0,.85,.85,.85).rotation.x=-Math.PI/2;
        for(let k=0;k<8;k++){const a=k*Math.PI/4;const petal=mesh(rim,paperPetal,i%2?C.peach:C.gold,Math.cos(a)*.91,.19,Math.sin(a)*.91,.24,.12,.33);petal.rotation.y=-a+Math.PI/2;}bakeRigidGroup(rim,geometries);
        const body=group(hole,0,.15,0);ball(body,C.cream,0,.52,0,.61,.54,.58);decal(body,face,0,.55,.55,.86,.76);
        const leaves=group(body);leaf(leaves,.07,1.15,0,1.35);leaf(leaves,-.14,1.13,0,.8);
        const tie=group(body);rb(tie,C.navy,0,1.06,0,.88,.13,.73);rb(tie,C.navy,0,1.21,-.04,.64,.25,.6);const t=rb(tie,C.peach,0,.16,.56,.18,.36,.06);t.rotation.z=.2;
        decal(leaves,badgeTextures[0],0,.29,.59,.65,.32);decal(tie,badgeTextures[1],0,.29,.59,.65,.32);
        bakeRigidGroup(leaves,geometries);bakeRigidGroup(tie,geometries);
        const labelTexture=canvasTexture(ctx=>{ctx.fillStyle=C.cream;ctx.fillRect(0,0,256,128);ctx.fillStyle=C.ink;ctx.font='900 72px system-ui';ctx.textAlign='center';ctx.fillText(String(i+1),128,92);},256,128);
        const label=decal(hole,labelTexture,0,.25,1.005,.51,.27);sprites.push({body,leaf:leaves,tie,label});
        const proxy=new Mesh(cylinder,ghostMaterials);proxy.layers.set(1);proxy.scale.set(1,.95,1);proxy.position.set(x,.85,z);proxy.userData.hole=i;world.add(proxy);proxies.push(proxy);anchorPositions.push(new Vector3(x,.85,z));
      }
    }
    const liveViewport=host.hasAttribute('data-party-live-viewport');
    let viewport=partyViewport(640,480);
    function project(){const v=viewport.view;camera.setViewOffset(v.fullWidth,v.fullHeight,v.offsetX,v.offsetY,v.width,v.height);camera.updateProjectionMatrix();}
    resize=()=>{
      if(disposed||capturing)return;
      if(liveViewport){const rect=host.getBoundingClientRect(),style=getComputedStyle(host);
        viewport=rect.width>0&&rect.height>0?partyViewport(rect.width,rect.height,parseFloat(style.getPropertyValue('--pt-scene-top'))||0,parseFloat(style.getPropertyValue('--pt-scene-bottom'))||0):partyViewport(640,480);
        const pixels=partyBufferSize(viewport.width,viewport.height,devicePixelRatio||1);renderer.setPixelRatio(1);renderer.setSize(pixels.width,pixels.height,false);
      }
      project();
      if(last)update(last,lastMotion);
    };
    function setTofu(g:Group,l:TofuLayer,y:number){g.visible=true;g.position.set(l.x,y,l.z);g.scale.set(l.width,R.tofuHeight,l.depth);}
    function update(s:PartyRun,motion:boolean){
      if(disposed)return;last=s;lastMotion=motion;const t=s.elapsed/1000,feedbackAge=s.elapsed-s.feedbackAt;
      if(s.game==='chair'&&chair){
        chair.position.set(s.x*1.5,chairJump(s),2.4);chair.rotation.z=motion?(s.lane-s.x)*-.12+(s.elapsed-s.hitAt<400?Math.sin(t*50)*.1:0):0;
        wheels.forEach(w=>{w.rotation.y=t*8;});
        const first=Math.max(0,Math.floor((s.elapsed-R.waveFirstMs)/R.waveGapMs));
        runnerProps.forEach((p,i)=>{const index=first+i,w=chairWave(s.seed,index),age=w.at-s.elapsed,visible=index<R.chairWaves&&age>=-550&&age<=R.horizonMs;
          p.hazard.visible=p.ticket.visible=visible;if(!visible)return;
          p.hazard.position.set(w.lane*1.5,0,2.4-age/1000*R.worldSpeed);p.cart.visible=w.kind==='cart';p.meeting.visible=w.kind==='meeting';p.ticket.position.set(w.ticketLane*1.5,motion?Math.sin(t*3+index)*.05:0,p.hazard.position.z);p.ticket.rotation.y=motion?Math.sin(t*2)*.15:0;
        });
      }else if(s.game==='tofu'&&activeTofu&&crumb){
        tofus.forEach((g,i)=>{g.visible=i<s.layers.length;if(g.visible)setTofu(g,s.layers[i],.52+i*R.tofuHeight);});
        const n=s.layers.length,topY=.52+n*R.tofuHeight,fall=s.fall,phase=fall?Math.min(1,(s.elapsed-fall.at)/R.tofuFallMs):0;
        activeTofu.visible=s.status!=='done';if(activeTofu.visible)setTofu(activeTofu,fall?fall.from:tofuPosition(s),topY+(1-phase*phase)*1.7);
        const projected=fall?fall.from:tofuPosition(s),top=s.layers[s.layers.length-1];landing.visible=s.status!=='done'&&!fall;
        landing.position.set(projected.x,topY-R.tofuHeight/2+.018,projected.z);landingMaterial.color.set(Math.abs(projected[tofuAxis(s)]-top[tofuAxis(s)])<=R.tofuPerfect?C.leaf:C.gold);
        landingEdges.forEach((e,i)=>{const alongX=i<2;e.position.set(alongX?0:(i===2?-1:1)*projected.width/2,0,alongX?(i===0?-1:1)*projected.depth/2:0);e.scale.set(alongX?projected.width:.045,.025,alongX?.045:projected.depth);});
        if(fall&&!fall.kept){activeTofu.position.y=topY+1.7-phase*phase*3.5;activeTofu.rotation.z=motion?phase*.5:0;}else activeTofu.rotation.z=0;
        const age=s.elapsed-s.feedbackAt;crumb.visible=motion&&!!s.feedback&&!s.feedback.includes('完美')&&age<600;
        if(crumb.visible){const top=s.layers[s.layers.length-1];setTofu(crumb,{...top,x:top.x+1.6+age/400,width:.35},topY-age/220);crumb.rotation.z=age/170;}
        const focus=(n-1)*R.tofuHeight*.46,cam=camera as OrthographicCamera,size=4.2+n*.09;cam.left=-size*4/3;cam.right=size*4/3;cam.top=size;cam.bottom=-size;cam.position.set(6,focus+6.2,8);cam.lookAt(0,focus+1.25,0);cam.updateProjectionMatrix();
      }else if(s.game==='holiday'){
        const targets=holidayTargets(s.seed,s.round),phase=s.elapsed%R.holidayRoundMs,visible=s.status==='ready'||s.status==='done'||(phase>=R.holidayOpenMs&&phase<R.holidayCloseMs);
        sprites.forEach((p,i)=>{const kind=i===targets.good?'good':i===targets.boss?'boss':'empty',pressed=!!(s.pressed&(1<<i));p.body.visible=visible&&kind!=='empty'&&!pressed;p.leaf.visible=kind==='good';p.tie.visible=kind==='boss';p.body.position.y=.25+(motion?Math.min(1,Math.max(0,(phase-R.holidayOpenMs)/120))*.14:.14);p.body.rotation.z=motion?Math.sin(t*5+i)*.055:0;});
      }
      const burst=s.game==='holiday'?s.pick&&s.elapsed-s.pick.at<500:s.game==='chair'?s.elapsed-s.hitAt<600:feedbackAge<600;
      papers.forEach((p,i)=>{p.visible=motion&&!!burst&&s.status!=='ready';if(!p.visible)return;const age=s.game==='holiday'?s.elapsed-(s.pick?.at??0):s.game==='chair'?s.elapsed-s.hitAt:feedbackAge,a=i*2.4,origin=s.game==='holiday'&&s.pick?anchorPositions[s.pick.hole]:new Vector3(s.game==='chair'?s.x*1.5:0,1,s.game==='chair'?2.4:0);p.position.set(origin.x+Math.sin(a)*age/280,origin.y+1.3+age/350-age*age/200000,origin.z+Math.cos(a)*age/400);p.rotation.set(t*3+i,t*2,age/150+i);});
      tofuBatch?.update();project();renderer.render(scene,camera);
    }
    resize();
    if(liveViewport){
      resizeSafely=()=>{try{resize();}catch{if(!disposed)onLost();}};
      resizeObserver=new ResizeObserver(resizeSafely);resizeObserver.observe(host);
      styleObserver=new MutationObserver(resizeSafely);styleObserver.observe(host,{attributes:true,attributeFilter:['style']});
      window.addEventListener('resize',resizeSafely);
    }
    return {
      update,
      pick:(x,y)=>{if(!last||last.game!=='holiday'||!holidayOpen(last))return null;const rect=host.getBoundingClientRect();if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)return null;ray.setFromCamera(new Vector2((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1),camera);return ray.intersectObjects(proxies,false)[0]?.object.userData.hole??null;},
      anchors:()=>anchorPositions.map((p,hole)=>{const v=p.clone().project(camera);return {hole,x:(v.x+1)/2,y:(1-v.y)/2};}),
      capture:()=>{if(disposed||!last)throw Error('場景已離開。');return withPartyCaptureView(
        ()=>{capturing=true;viewport=partyViewport(640,480);renderer.setPixelRatio(1);renderer.setSize(960,720,false);update(last!,lastMotion);},
        ()=>{const c=document.createElement('canvas');c.width=960;c.height=720;const ctx=c.getContext('2d');if(!ctx)throw Error('圖片未能建立。');ctx.drawImage(renderer.domElement,0,0,960,720);return c.toDataURL('image/jpeg',.9);},
        ()=>{capturing=false;if(!liveViewport){renderer.setPixelRatio(Math.min(devicePixelRatio||1,R.maxDpr));renderer.setSize(640,480,false);}resize();});},
      stats:()=>({calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures}),dispose,
    };
  }catch(error){dispose();throw error;}
}
