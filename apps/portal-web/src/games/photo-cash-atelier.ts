/** Standalone art-direction prototypes. Never imported by the live portal.
 * Original procedural props; canonical game domain, no accounts/storage/network.
 */
import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {CLIENTS, RULES, cashDeck, newCash, sortCash, photoPose, gradePhoto, clamp, type PhotoGrade} from './domain';

type Mode = 'photo' | 'cash';
const C = {paper:'#f8f2e8', ink:'#392f2c', gold:'#d8b879', green:'#243f3b', red:'#8f372c'};

// The playable set covers the camera, rather than fitting a miniature cabinet
// into it. Cash stays a top-down work surface in both portrait and landscape.
export function atelierLayout(width:number,height:number,photo:boolean){
 const aspect=Math.max(1,width)/Math.max(1,height);
 const extent=photo?Math.max(8,4.6/aspect):Math.max(6.4,5.4/aspect);
 const viewWidth=extent*aspect;
 return {extent,viewWidth,benchWidth:Math.max(6.4,viewWidth+2),benchDepth:Math.max(4.9,extent*Math.sqrt(89)/8+3),backdropWidth:Math.max(6.8,viewWidth+6),backdropHeight:Math.max(12,extent*1.4+4)};
}

// Original engraved-paper drawing, not currency imagery or a downloaded asset.
export function paintAtelierBanknote(c:CanvasRenderingContext2D,label:string,valid:boolean,id:number){
 const ink='#192247',paper=valid?'#edf0d8':'#ffe1dc',accent=valid?'#376a62':'#a14065';
 c.fillStyle=paper;c.fillRect(0,0,1024,560);
 c.fillStyle=ink;c.fillRect(24,24,976,64);c.fillRect(24,478,976,58);
 c.strokeStyle=ink;c.lineWidth=3;c.strokeRect(16,16,992,528);c.strokeRect(32,102,960,360);
 // Interlaced, deterministic guilloche rings around the left medallion.
 c.strokeStyle=accent;c.lineWidth=1.2;
 for(let ring=0;ring<24;ring++){c.beginPath();for(let i=0;i<=240;i++){const a=i*Math.PI/120,r=92+ring*2+Math.sin(a*12+ring*.18)*7;const x=207+Math.cos(a)*r,y=280+Math.sin(a)*r;if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.stroke();}
 for(const x of [42,968])for(let y=112;y<454;y+=14){c.beginPath();c.moveTo(x,y);c.lineTo(x+14,y+7);c.lineTo(x,y+14);c.stroke();}
 c.fillStyle=paper;c.beginPath();c.arc(207,280,72,0,Math.PI*2);c.fill();c.strokeStyle=accent;c.lineWidth=3;c.stroke();
 c.fillStyle=accent;c.textAlign='center';c.font='900 60px Georgia,serif';c.fillText(valid?'P':'?',207,298);
 c.font='600 17px system-ui';c.fillText('PLAY MONEY',207,325);
 c.fillStyle=paper;c.textAlign='left';c.font='700 25px system-ui';c.fillText('PAPER PARADE',48,66);c.textAlign='right';c.font='600 22px system-ui';c.fillText('NO. '+String(id+1).padStart(4,'0'),970,65);
 c.fillStyle=accent;c.textAlign='left';c.font='600 22px system-ui';c.fillText(valid?'COUNT WHAT IS REAL':'A PROMISE IS NOT CASH',395,158);
 c.fillStyle=ink;c.font=valid?'900 126px Georgia,serif':'900 72px system-ui';c.fillText(label,395,307,540);
 c.strokeStyle=accent;c.lineWidth=2;c.beginPath();c.moveTo(395,337);c.lineTo(940,337);c.stroke();
 c.fillStyle=accent;c.font='600 24px system-ui';c.fillText(valid?'純屬遊戲道具':'承諾很多，現金沒有。',395,385);
 c.font='18px monospace';c.fillText('PP / 042  —  '+String(id+1).padStart(4,'0'),395,427);
 c.fillStyle=paper;c.textAlign='center';c.font='600 24px system-ui';c.fillText('遊戲道具 · NOT LEGAL TENDER',512,516);
}

export function mountPhotoCashAtelier(host: HTMLElement, logoUrl: string, mode: Mode) {
 const photo=mode==='photo';
 const style=document.createElement('style');
 style.textContent=`
 .night-atelier{position:relative;height:100dvh;min-height:320px;width:100%;overflow:hidden;isolation:isolate;background:#172c2a;color:#f8f2e8;font:14px/1.6 system-ui,sans-serif}
 .night-atelier,.night-atelier *{box-sizing:border-box}.night-atelier canvas{display:block;width:100%;height:100%;touch-action:none;outline:none}.night-atelier:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,transparent 35%,#071a1c70);pointer-events:none}
 .night-atelier button{min-width:44px;min-height:44px;border:1px solid #d8b87966;border-radius:8px;background:#172c2ae8;color:#f8f2e8;font:600 14px/1.5 system-ui,sans-serif;cursor:pointer;padding:8px 14px}.night-atelier button:disabled{opacity:.55;cursor:default}.night-atelier :focus-visible{outline:3px solid #b9cf85;outline-offset:3px}
 .night-heading{position:absolute;top:max(26px,env(safe-area-inset-top));left:max(28px,env(safe-area-inset-left));z-index:2;border-left:1px solid #d8b879;padding-left:18px;pointer-events:none}.night-heading img{display:block;width:90px;height:30px;object-fit:contain;background:#f8f2e8;padding:3px;border-radius:3px}.night-kicker{margin:17px 0 3px;color:#d8b879;font-size:10px;letter-spacing:.18em}.night-heading h1{font:500 32px/1.3 Georgia,"Noto Serif TC",serif;letter-spacing:.04em;margin:0}.night-heading p{margin:8px 0 0;font-size:14px;color:#e1d3bd}
 .night-controls{position:absolute;top:26px;right:28px;display:flex;gap:8px;z-index:2}.night-controls button{border-radius:50%;padding:0}.night-counter{position:absolute;top:90px;right:28px;text-align:right;z-index:2;pointer-events:none}.night-counter strong{font:500 30px/1.2 Georgia,serif;display:block}.night-counter span{color:#d8b879;font-size:11px;letter-spacing:.12em}
 .night-note{position:absolute;top:28px;left:50%;transform:translateX(-50%);z-index:2;border:1px solid #d8b87944;border-radius:24px;padding:4px 12px;background:#172c2a99;font-size:14px;white-space:nowrap}
 .night-footer{position:absolute;bottom:max(28px,env(safe-area-inset-bottom));left:max(28px,env(safe-area-inset-left));right:max(28px,env(safe-area-inset-right));z-index:2;display:flex;justify-content:space-between;align-items:flex-end;gap:20px;pointer-events:none}.night-footer>*{pointer-events:auto}.night-step{font-size:10px;letter-spacing:.15em;color:#d8b879}.night-instruction{margin:6px 0 0;font-size:14px;max-width:32ch}.night-feedback{margin:0 0 12px;font-size:14px;max-width:36ch;text-shadow:0 1px 4px #071a1c}.night-primary{text-align:right}.night-atelier [data-action]{background:#8f372c;border-color:#ce8c7555;padding:12px 24px;box-shadow:0 3px 0 #4d211d;min-height:56px;font-size:17px}.night-buttons{display:flex;gap:10px;justify-content:flex-end}.night-atelier [data-reject]{background:#f8f2e8;color:#392f2c;min-height:56px}
 .night-frame{position:absolute;left:50%;top:50%;width:44%;height:62%;transform:translate(-50%,-50%);pointer-events:none;z-index:1;border:1px solid #fff5d577;box-shadow:0 0 0 1px #172c2a33}.night-frame:before,.night-frame:after{content:"";position:absolute;width:22px;height:22px;border-color:#f8f2e8;border-style:solid}.night-frame:before{top:-2px;left:-2px;border-width:3px 0 0 3px}.night-frame:after{bottom:-2px;right:-2px;border-width:0 3px 3px 0}.night-reticle{position:absolute;left:50%;top:50%;width:20px;height:20px;border:1px solid #f8f2e877;border-radius:50%;transform:translate(-50%,-50%)}
 .night-panel{position:absolute;inset:0;z-index:5;background:#071a1c99;backdrop-filter:blur(5px);display:grid;place-items:center;padding:20px}.night-panel[hidden]{display:none}.night-dialog{max-width:400px;padding:28px;background:#f8f2e8;color:#392f2c;border-radius:20px}.night-dialog h2{font-size:24px;margin:0 0 10px}.night-dialog p{font-size:16px;margin:0 0 20px}.night-dialog button{background:#8f372c;color:#f8f2e8}.night-atelier[data-flash=true] canvas{filter:brightness(1.8)}
 @media(max-width:600px){.night-heading{top:16px;left:16px;padding-left:10px}.night-heading img{width:72px;height:24px}.night-kicker{font-size:9px;margin-top:12px}.night-heading h1{font-size:25px}.night-heading p{display:none}.night-controls{right:16px;top:16px;gap:5px}.night-counter{right:16px;top:77px}.night-counter strong{font-size:25px}.night-note{top:153px;font-size:14px;max-width:94%;white-space:normal;text-align:center}.night-frame{width:70%;height:50%}.night-footer{left:16px;right:16px;bottom:max(24px,env(safe-area-inset-bottom));display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px}.night-primary{display:contents}.night-feedback{grid-column:1/-1;grid-row:1;max-width:none;text-align:left;margin:0}.night-guide{grid-row:2;grid-column:1}.night-buttons{grid-row:2;grid-column:2;flex-direction:column;gap:8px}.night-instruction{max-width:17ch}.night-atelier [data-action],.night-atelier [data-reject]{font-size:14px;min-height:44px;padding:8px 14px}}
 @media(orientation:landscape) and (max-height:600px){.night-heading{top:14px;left:16px}.night-heading img,.night-kicker,.night-heading p,.night-step{display:none}.night-heading h1{font-size:22px}.night-controls{top:14px;right:16px}.night-counter{top:70px;right:16px}.night-note{top:16px;font-size:14px}.night-footer{bottom:16px;left:16px;right:16px}.night-feedback{max-width:27ch;margin-bottom:6px}.night-instruction{max-width:24ch}.night-atelier [data-action],.night-atelier [data-reject]{min-height:44px;padding:8px 14px;font-size:14px}}
 `;
 // Separate art direction, scoped to the isolated prototype only.
 style.textContent+=`
 .night-atelier[data-game=photo]{background:#071423;color:#eef7ff}
 [data-game=photo] .night-heading{border-color:#71d7ed}
 [data-game=photo] .night-heading h1{font-family:system-ui,sans-serif;font-weight:800;letter-spacing:-.04em}
 [data-game=photo] .night-kicker,[data-game=photo] .night-step,[data-game=photo] .night-counter span{color:#8fdbed;font-size:14px;letter-spacing:.08em}
 [data-game=photo] .night-note{border-radius:3px;border-color:#8fdbed66;background:#071423de}
 [data-game=photo] button{background:#102638;border-color:#78cfe766;border-radius:3px}
 [data-game=photo] [data-action]{background:#eec783;color:#15273c;border-color:#fff1c2;box-shadow:0 3px 0 #987b48}
 [data-game=photo] .night-frame{border:0;box-shadow:none;background:linear-gradient(#8fdbed22,#8fdbed22) 33.33% 0/1px 100% no-repeat,linear-gradient(#8fdbed22,#8fdbed22) 66.66% 0/1px 100% no-repeat,linear-gradient(#8fdbed22,#8fdbed22) 0 33.33%/100% 1px no-repeat,linear-gradient(#8fdbed22,#8fdbed22) 0 66.66%/100% 1px no-repeat}
 .night-atelier[data-game=cash]{background:#f6d93d;color:#182044}
 .night-atelier[data-game=cash]:after{background:linear-gradient(180deg,#fff9e9b0,transparent 24%,transparent 72%,#fff9e9d9)}
 [data-game=cash] .night-heading{border-left:5px solid #192247;padding-left:14px}
 [data-game=cash] .night-heading h1{font:900 36px/1.2 system-ui,sans-serif;letter-spacing:-.06em}
 [data-game=cash] .night-heading p,[data-game=cash] .night-counter span,[data-game=cash] .night-kicker,[data-game=cash] .night-step{color:#182044;font-size:14px}
 [data-game=cash] .night-counter strong{font:900 36px/1.2 system-ui,sans-serif}
 [data-game=cash] button{border:2px solid #192247;border-radius:4px;background:#fff9e9;color:#192247;box-shadow:3px 3px 0 #192247}
 [data-game=cash] .night-note{border:2px solid #192247;border-radius:0;background:#fff9e9;box-shadow:4px 4px 0 #192247;font-weight:800}
 [data-game=cash] .night-feedback{text-shadow:none;font-weight:700;background:#fff9e9;padding:5px 10px;border-left:4px solid #192247}
 [data-game=cash] [data-action]{background:#225fe5;border-color:#192247;box-shadow:4px 4px 0 #192247;color:white}
 [data-game=cash] [data-reject]{background:#ff719e;color:#192247}
 [data-game=cash] :focus-visible{outline-color:#192247}
 @media(max-width:600px){[data-game=cash] .night-heading h1{font-size:27px}[data-game=cash] .night-counter strong{font-size:27px}[data-game=cash] .night-heading{padding-left:9px}[data-game=cash] .night-kicker,[data-game=photo] .night-kicker{font-size:14px;letter-spacing:0}[data-game=cash] .night-counter span{max-width:10ch;display:block;margin-left:auto}}
 @media(orientation:landscape) and (max-height:600px){[data-game=cash] .night-heading h1{font-size:22px}[data-game=cash] .night-counter strong{font-size:25px}}
 `;
 // Left means reject, right means keep, in every viewport and input mode.
 style.textContent+=`
 [data-game=cash] .night-footer{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-items:end}
 [data-game=cash] .night-primary{display:contents}
 [data-game=cash] .night-guide{grid-area:1/1;text-align:center;justify-self:center}
 [data-game=cash] .night-instruction{max-width:none;margin:0}
 [data-game=cash] .night-step{display:none}
 [data-game=cash] .night-feedback{grid-area:2/1;justify-self:center;text-align:center;max-width:100%;margin:0}
 [data-game=cash] .night-buttons{grid-area:3/1;display:flex;flex-direction:row;width:100%;justify-content:space-between;gap:24px}
 [data-game=cash] [data-reject],[data-game=cash] [data-action]{width:clamp(120px,28vw,220px);min-height:56px}
 [data-game=cash] [data-reject]:before{content:'← ';font-size:20px}
 [data-game=cash] [data-action]:after{content:' →';font-size:20px}
 [data-game=cash] .night-counter strong{font-size:26px}
 [data-game=cash]:before{content:'';position:absolute;z-index:1;inset:0;pointer-events:none;opacity:0}
 [data-game=cash][data-decision=keep]:before{background:linear-gradient(90deg,transparent 55%,#225fe599);animation:cash-classified .65s ease-out}
 [data-game=cash][data-decision=reject]:before{background:linear-gradient(270deg,transparent 55%,#ff719e99);animation:cash-classified .65s ease-out}
 @keyframes cash-classified{0%{opacity:.75}100%{opacity:0}}
 @media(max-width:600px){[data-game=cash] .night-counter strong{font-size:22px}[data-game=cash] .night-feedback{font-size:14px;padding:4px 8px}}
 @media(orientation:landscape) and (max-height:450px){[data-game=cash] .night-guide{display:none}[data-game=cash] [data-reject],[data-game=cash] [data-action]{min-height:44px}}
 @media(prefers-reduced-motion:reduce){[data-game=cash][data-decision]:before{animation:none}}
 `;
 style.textContent+=`
 .night-atelier[data-game=cash]{background:#141a18;color:#f1e4c8}
 .night-atelier[data-game=cash]:after{background:radial-gradient(ellipse at 50% 47%,transparent 30%,#070c10a6 100%);z-index:1}
 [data-game=cash] .night-heading{border-left:1px solid #bfa574}
 [data-game=cash] .night-heading h1{font:600 32px/1.25 Georgia,'Noto Serif TC',serif;letter-spacing:.06em}
 [data-game=cash] .night-heading p,[data-game=cash] .night-counter span,[data-game=cash] .night-kicker{color:#dacbac;text-shadow:0 2px 8px #000}
 [data-game=cash] .night-note{background:#111d1de8;border:1px solid #bfa57466;color:#f1e4c8;box-shadow:0 4px 20px #0005;letter-spacing:.08em}
 [data-game=cash] button{background:#182724ed;color:#f1e4c8;border:1px solid #bfa57488;box-shadow:0 4px 12px #0006;border-radius:3px}
 [data-game=cash] [data-action]{background:#d4b57e;color:#17201d;border-color:#f3dbac;box-shadow:0 3px 0 #695437,0 5px 20px #0006}
 [data-game=cash] [data-reject]{background:#382624;color:#f1d9cf;border-color:#ac8273;box-shadow:0 3px 0 #1d1413,0 5px 20px #0006}
 [data-game=cash] .night-feedback{background:#121c19e8;color:#f1e4c8;border-left:2px solid #bfa574;font-weight:500;letter-spacing:.04em}
 [data-game=cash] .night-instruction{color:#e0d4bc;text-shadow:0 2px 6px #000}
 [data-game=cash] :focus-visible{outline-color:#fff1bf}
 [data-game=cash][data-decision=keep]:before{background:linear-gradient(90deg,transparent 55%,#d4b57e55)}
 [data-game=cash][data-decision=reject]:before{background:linear-gradient(270deg,transparent 55%,#ac827355)}
 @media(max-width:600px){[data-game=cash] .night-heading h1{font-size:26px}[data-game=cash] .night-counter strong{font-size:20px}}
 @media(orientation:landscape) and (max-height:450px){[data-game=cash] .night-heading h1{font-size:22px}}
 `;
 host.append(style);
 const root=document.createElement('section');root.className='night-atelier';root.dataset.game=mode;root.setAttribute('aria-label',photo?'午夜照相館：可操作 3D 預覽':'百萬盤點室：可操作 3D 預覽');
 root.innerHTML=`<header class="night-heading"><img alt="自由工坊"><div class="night-kicker">${photo?'STUDIO 01 / AFTER DARK':'THE LAST COUNT / 23:47'}</div><h1>${photo?'午夜照相館':'百萬盤點室'}</h1><p>${photo?'替不太正常的客人，留一張好照片。':'最後一班，留下真鈔，退回空話。'}</p></header><nav class="night-controls" aria-label="遊戲控制"><button data-pause aria-label="暫停">Ⅱ</button><button data-reset aria-label="重新開始">↻</button><button data-full aria-label="切換全螢幕">⛶</button></nav><div class="night-counter"><strong data-progress></strong><span>${photo?'CLIENTS / 03':'遊戲道具 · 非真實金錢'}</span></div><div class="night-note" data-note></div>${photo?'<div class="night-frame"><i class="night-reticle"></i></div>':''}<footer class="night-footer"><div class="night-guide"><span class="night-step">${photo?'01 / FRAME THE MOMENT':'03 / READ BEFORE YOU KEEP'}</span><p class="night-instruction">${photo?'拖曳畫面取景，按快門拍下。':'左退大餅，右收鈔票。滑動或按左右兩邊。'}</p></div><div class="night-primary"><p class="night-feedback" role="status"></p><div class="night-buttons">${photo?'':'<button data-reject aria-label="退回大餅">退回大餅</button>'}<button data-action aria-label="${photo?'按下快門':'收下鈔票'}">${photo?'按下快門':'收下鈔票'}</button></div></div></footer><div class="night-panel" hidden><div class="night-dialog" role="dialog" aria-modal="true" aria-labelledby="night-title"><h2 id="night-title">休息一下</h2><p data-panel-copy>進度留在這裡。準備好再繼續。</p><button data-resume>繼續遊戲</button></div></div>`;
 root.querySelector('img')!.src=logoUrl;host.append(root);
 const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,RULES.maxDpr));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=photo?1.15:1.05;
 const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('role','application');canvas.setAttribute('aria-label',photo?'照相館。拖曳畫面取景，再按快門。':'盤點桌面。向右滑收下，向左滑退回，或使用具名按鈕。');root.prepend(canvas);
 const scene=new THREE.Scene();scene.background=new THREE.Color(photo?'#071423':'#111816');
 const camera=new THREE.OrthographicCamera(-6,6,4,-4,.1,50);
 const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
 const geom=<T extends THREE.BufferGeometry>(g:T)=>{geometries.add(g);return g;};
 const rounded=geom(new RoundedBoxGeometry(1,1,1,3,.07)),sphere=geom(new THREE.SphereGeometry(1,24,16)),cylinder=geom(new THREE.CylinderGeometry(1,1,1,32));
 const palette=new Map<string,THREE.MeshStandardMaterial>();
 function mat(color:string,metal=0){const key=color+metal;let m=palette.get(key);if(!m){m=new THREE.MeshStandardMaterial({color,roughness:metal?.3:.74,metalness:metal});materials.add(m);palette.set(key,m);}return m;}
 function mesh(g:THREE.BufferGeometry,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number,parent:THREE.Object3D=scene,metal=0){const m=new THREE.Mesh(g,mat(color,metal));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 const box=(color:string,x:number,y:number,z:number,w:number,h:number,d:number,parent:THREE.Object3D=scene)=>mesh(rounded,color,x,y,z,w,h,d,parent);
 function texture(w:number,h:number,paint:(c:CanvasRenderingContext2D)=>void){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw Error('無法建立原創材質');paint(ctx);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());textures.add(t);return t;}
 function mapped(g:THREE.BufferGeometry,t:THREE.Texture,parent:THREE.Object3D=scene){const m=new THREE.MeshStandardMaterial({map:t,roughness:.85});materials.add(m);const p=new THREE.Mesh(g,m);p.receiveShadow=true;parent.add(p);return p;}
 scene.add(new THREE.HemisphereLight(photo?'#c5eaff':'#b8c7c4',photo?'#10182c':'#111b19',photo?1.5:.72));const key=new THREE.DirectionalLight(photo?'#ffd39b':'#ffe0a7',photo?3.8:1.8);key.position.set(-3,8,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:25});key.shadow.bias=-.001;key.shadow.normalBias=.025;scene.add(key);const fill=new THREE.DirectionalLight(photo?'#49c9ff':'#8ca9ba',photo?3.2:.65);fill.position.set(5,3,-3);scene.add(fill);
 const wood=texture(512,512,c=>{c.fillStyle='#49362f';c.fillRect(0,0,512,512);for(let i=0;i<420;i++){c.strokeStyle=i%3?'#a1795622':'#20161044';c.lineWidth=1;c.beginPath();c.moveTo(0,i*1.3);for(let x=0;x<=512;x+=16)c.lineTo(x,i*1.3+Math.sin(x/65+i)*2);c.stroke();}});wood.wrapS=wood.wrapT=THREE.RepeatWrapping;wood.repeat.set(3,3);
 const floor=photo?mesh(geom(new THREE.PlaneGeometry(30,30)),'#101f31',0,0,0,1,1,1):mapped(geom(new THREE.PlaneGeometry(30,30)),texture(512,512,c=>{c.fillStyle='#f4da4c';c.fillRect(0,0,512,512);c.fillStyle='#e9c82e';for(let y=0;y<8;y++)for(let x=0;x<8;x++){c.beginPath();c.arc(x*64+32,y*64+32,5,0,Math.PI*2);c.fill();}}));floor.rotation.x=-Math.PI/2;floor.position.y=-.08;
 // An actual tabletop / studio stage, with brass hardware and original textures.
 let bestPhoto:PhotoGrade|null=null;
 let cash=newCash(42),clientIndex=0,film=0,elapsed=0,totalStars=0,ended=false,paused=false,lost=false,disposed=false,frame=0,last=performance.now(),flashUntil=0;
 let cashMotionUntil=0,lastCashRender=-Infinity;
 let pointer:number|null=null,startX=0,startY=0,dragX=0,dragY=0,panX=0,panY=0,dragIndex=0;
 const progress=root.querySelector<HTMLElement>('[data-progress]')!,note=root.querySelector<HTMLElement>('[data-note]')!,feedback=root.querySelector<HTMLElement>('[role=status]')!,panel=root.querySelector<HTMLElement>('.night-panel')!,resume=root.querySelector<HTMLButtonElement>('[data-resume]')!,action=root.querySelector<HTMLButtonElement>('[data-action]')!,reject=root.querySelector<HTMLButtonElement>('[data-reject]');
 const controls=root.querySelector<HTMLElement>('.night-controls')!,footer=root.querySelector<HTMLElement>('.night-footer')!;
 let humanFace=new THREE.Group();let subject=new THREE.Group(),board=new THREE.Group(),umbrella=new THREE.Group(),birds:THREE.Group[]=[],cardGroup=new THREE.Group();
 const anchors=new Map<string,THREE.Object3D>();let bill:THREE.Mesh|undefined;let billTexture:THREE.Texture|undefined;
 const receipts:THREE.Mesh[]=[];
 const fullSet:{mesh:THREE.Mesh;kind:'bench'|'lane'|'backdrop'|'rig'}[]=[];
 if(photo){
  // Cold soundstage: seamless cyclorama, overhead rig and luminous practicals.
  box('#152c43',0,0,0,30,.12,10);fullSet.push({mesh:box('#183c58',0,2.6,-1.8,6.8,5.2,.16),kind:'backdrop'});
  for(const x of [-3.15,3.15]){box('#0b1828',x,2.5,-1.55,.2,5,.3);box('#73d5ee',x,2.5,-1.36,.045,4.6,.035);}
  fullSet.push({mesh:box('#07131f',0,4.95,-1.3,6.8,.18,.22),kind:'rig'});
  for(let i=0;i<7;i++){const rig=box('#47657a',-3+i,4.95,-1.1,.035,.45,.035);rig.rotation.z=.65;}
  mesh(cylinder,'#0c1c2b',0,.06,.3,2.1,.12,1.55);mesh(cylinder,'#294e65',0,.13,.3,1.96,.04,1.42);
  const stageMark=box('#d3ad6b',0,.158,.8,.5,.008,.035);stageMark.rotation.y=.45;
  for(const x of [-2.65,2.65]){
   mesh(cylinder,'#08121c',x,.08,.7,.38,.1,.38);mesh(cylinder,'#50677c',x,1.5,.7,.035,2.9,.035,scene,.7);
   const softbox=new THREE.Group();softbox.position.set(x,2.9,.7);softbox.rotation.y=x<0?.55:-.55;scene.add(softbox);
   box('#091522',0,0,0,.85,1.05,.18,softbox);box(x<0?'#ffe2ad':'#8fe9ff',0,0,.105,.72,.92,.025,softbox);
   for(const z of [-1,1]){const flap=box('#142a3d',z*.47,0,.17,.18,1.05,.04,softbox);flap.rotation.y=z*.5;}
  }
  // Foreground camera on its table, not part of the framing target.
  box(C.ink,-2.3,.7,2.4,1.3,.12,.9);for(const x of [-2.8,-1.8])box(C.ink,x,.32,2.4,.07,.7,.65);
  const vintage=new THREE.Group();vintage.position.set(-2.3,1.16,2.4);vintage.rotation.y=.25;scene.add(vintage);box('#222e2c',0,0,0,.9,.65,.45,vintage);box(C.gold,0,.32,0,.92,.07,.48,vintage);box(C.ink,0,.44,0,.35,.2,.3,vintage);const lens=mesh(cylinder,C.gold,0,0,.3,.24,.3,.24,vintage,.7);lens.rotation.x=Math.PI/2;const glass=mesh(cylinder,'#102c34',0,0,.48,.18,.025,.18,vintage,.5);glass.rotation.x=Math.PI/2;
  scene.add(subject);subject.position.z=.35;subject.add(humanFace);
  const head=mesh(sphere,'#d3a57f',0,2.8,0,.36,.42,.34,humanFace);anchors.set('head',head);
  box('#b68b58',0,1.65,0,.94,1.55,.6,subject);mesh(sphere,'#b68b58',0,2.25,0,.48,.2,.3,subject);
  for(const x of [-.24,.24]){box('#39443d',x,.58,0,.25,.7,.3,subject);box(C.ink,x,.24,.14,.3,.2,.55,subject);mesh(sphere,C.ink,x*.5,2.87,.31,.032,.032,.026,humanFace);}
  mesh(sphere,'#c08f68',0,2.77,.335,.065,.085,.06,humanFace);for(const x of [-.095,.095]){const brow=box(C.ink,x,2.96,.31,.12,.025,.035,humanFace);brow.rotation.z=x<0?-.12:.12;mesh(sphere,C.ink,x*.5,2.67,.33,.07,.022,.026,humanFace);}for(const x of [-.39,.39])mesh(sphere,'#d3a57f',x,2.8,0,.065,.13,.095,humanFace);
  const feet=new THREE.Object3D();feet.position.set(0,.17,.2);subject.add(feet);anchors.set('feet',feet);
  mesh(cylinder,C.ink,0,3.12,0,.45,.06,.38,humanFace);mesh(cylinder,C.ink,0,3.25,0,.31,.25,.29,humanFace);
  for(const x of [-.62,.62]){const arm=box('#b68b58',x,1.95,0,.24,.95,.3,subject);arm.rotation.z=x<0?-.18:.18;mesh(sphere,'#d3a57f',x,1.43,0,.13,.17,.13,subject);}
  // Tailored silhouette: ivory shirt, angular lapels, belt and welt pockets.
  box('#ece0c1',0,2.29,.305,.25,.38,.035,subject).castShadow=false;
  for(const side of [-1,1]){const lapel=new THREE.Shape();lapel.moveTo(side*.11,2.47);lapel.lineTo(side*.42,2.29);lapel.lineTo(side*.2,1.96);lapel.lineTo(side*.04,2.19);lapel.closePath();const piece=mesh(geom(new THREE.ShapeGeometry(lapel)),'#947047',0,0,.325,1,1,1,subject);piece.castShadow=false;const pocket=box('#947047',side*.29,1.35,.315,.25,.035,.045,subject);pocket.rotation.z=side*.12;pocket.castShadow=false;}
  box('#947047',0,1.65,.32,.85,.07,.04,subject).castShadow=false;box(C.gold,0,1.65,.35,.14,.12,.035,subject).castShadow=false;
  for(let i=0;i<3;i++)mesh(sphere,C.gold,0,1.18+i*.23,.35,.027,.027,.02,subject,.7).castShadow=false;
  // Fine spectacles and a grosgrain hat band add character without new controls.
  for(const x of [-.12,.12]){mesh(geom(new THREE.TorusGeometry(.082,.009,6,24)),C.gold,x,2.87,.337,1,1,1,humanFace,.7).castShadow=false;box('#3d332f',Math.sign(x)*.31,3.01,.04,.07,.21,.19,humanFace);}
  box(C.gold,0,2.87,.341,.08,.012,.013,humanFace).castShadow=false;mesh(cylinder,'#947047',0,3.17,0,.315,.055,.295,humanFace);

  umbrella=new THREE.Group();subject.add(umbrella);mesh(cylinder,C.gold,.6,3.13,0,.025,2,.025,umbrella,.7);const canopy=mesh(geom(new THREE.SphereGeometry(1,32,12,0,Math.PI*2,0,Math.PI/2)),C.red,.6,3.85,0,1.1,.55,1.1,umbrella);anchors.set('umbrella',canopy);
  const boardTex=texture(600,1040,c=>{c.fillStyle='#c4b497';c.fillRect(0,0,600,1040);c.strokeStyle='#f8f2e8';c.lineWidth=3;c.strokeRect(24,24,552,992);c.textAlign='center';c.fillStyle=C.ink;c.font='700 58px system-ui';c.fillText('背景也要上鏡',300,470);c.font='24px system-ui';c.fillText('PLEASE PHOTOGRAPH ME',300,530);});
  scene.add(board);const boardMesh=mapped(geom(new THREE.PlaneGeometry(1.5,2.6)),boardTex,board);boardMesh.position.y=1.75;board.position.z=1;anchors.set('board',boardMesh);for(const x of [-.55,.55])box(C.ink,x,.4,0,.05,.8,.3,board);
  for(let i=0;i<3;i++){const bird=new THREE.Group();subject.add(bird);bird.position.set((i-1)*.34,2.95,.25);mesh(sphere,i===1?'#a8b2ac':'#7f9994',0,0,0,.16,.24,.17,bird);mesh(sphere,'#b9c5bc',0,.17,.01,.14,.14,.14,bird);mesh(sphere,C.ink,.05,.2,.135,.025,.025,.02,bird);const beak=mesh(geom(new THREE.ConeGeometry(.06,.16,12)),C.gold,0,.14,.19,1,1,1,bird);beak.rotation.x=Math.PI/2;birds.push(bird);anchors.set('bird'+i,bird);}
 }else{
  // Night-shift counting desk, composed around paper, light and physical trays.
  // The walnut surface extends past every camera edge; nothing is a UI card.
  fullSet.push({mesh:box('#171611',0,-.17,0,6.4,.38,4.9),kind:'bench'});
  const bed=mapped(geom(new THREE.PlaneGeometry(1,1)),wood);bed.rotation.x=-Math.PI/2;bed.position.y=.035;fullSet.push({mesh:bed,kind:'bench'});
  const leather=texture(512,512,c=>{c.fillStyle='#203832';c.fillRect(0,0,512,512);for(let i=0;i<2200;i++){const x=(i*137)%512,y=(i*193)%512;c.fillStyle=i%2?'#76917b18':'#07130e22';c.fillRect(x,y,1+(i%3),1);}c.strokeStyle='#b39b6555';c.lineWidth=2;c.strokeRect(12,12,488,488);});
  const pad=mapped(geom(new THREE.PlaneGeometry(3.35,4.1)),leather);pad.rotation.x=-Math.PI/2;pad.position.y=.08;
  for(const x of [-2.05,2.05]){
   box('#191c17',x,.16,0,1.14,.2,2.65);box('#29382f',x,.275,0,1.02,.03,2.48);
   for(const edge of [-.55,.55])box('#a48a55',x+edge,.3,0,.035,.1,2.65);
   for(const z of [-1.3,1.3])box('#a48a55',x,.3,z,1.14,.1,.035);
  }
  const label=(title:string,x:number)=>{const t=texture(512,160,c=>{c.fillStyle='#c5b585';c.fillRect(0,0,512,160);c.fillStyle='#202d27';c.font='600 54px system-ui';c.textAlign='center';c.fillText(title,256,100);});const p=mapped(geom(new THREE.PlaneGeometry(1,.31)),t);p.rotation.x=-Math.PI/2;p.position.set(x,.32,1.05);};label('退回大餅',-2.05);label('收下鈔票',2.05);
  scene.add(cardGroup);for(let i=0;i<7;i++){const sheet=box(i%2?'#c5bda0':'#e3dcc5',Math.sin(i)*.025,.15+i*.015,0,3,.013,1.64,cardGroup);sheet.rotation.y=Math.sin(i)*.025;}
  bill=mapped(geom(new THREE.PlaneGeometry(3,1.64)),texture(1024,560,()=>{}),cardGroup);bill.rotation.x=-Math.PI/2;bill.position.y=.27;
  for(let i=0;i<10;i++){const r=box('#b7bea2',2.05,.32+i*.025,-.2,.92,.016,.53);r.rotation.y=Math.sin(i)*.06;r.visible=false;receipts.push(r);}
  // An original brass banker's lamp gives the shot a motivated warm light pool.
  mesh(cylinder,'#8b7548',-2.05,.16,-2.15,.38,.15,.38,scene,.7);
  mesh(cylinder,'#9d8959',-2.05,.87,-2.15,.035,1.35,.035,scene,.7);
  const arm=box('#9d8959',-1.83,1.48,-2.15,.53,.055,.055);arm.rotation.z=-.15;
  const shade=mesh(geom(new THREE.CylinderGeometry(.25,.47,.35,32,1,true)),'#224a3b',-1.55,1.48,-2.15,1,1,1);shade.rotation.z=.15;
  const bulb=mesh(sphere,'#ffe7a3',-1.55,1.33,-2.15,.15,.055,.15);bulb.castShadow=false;(bulb.material as THREE.MeshStandardMaterial).emissive.set('#b6944d');
  const practical=new THREE.SpotLight('#ffe0a7',25,12,.82,.85,2);practical.position.set(-1.55,1.4,-2);practical.target.position.set(0,0,0);scene.add(practical,practical.target);
  // Ledger, clipped audit slip and pencil sit at the frame edges, not over money.
  const ledger=box('#202921',1.65,.13,-2.2,1.4,.16,.85);ledger.rotation.y=-.15;
  box('#b6a37e',1.65,.22,-2.2,1.2,.025,.68).rotation.y=-.15;
  for(let i=0;i<5;i++){const line=box('#5b6250',1.65,.238,-2.42+i*.09,.9,.004,.009);line.rotation.y=-.15;line.castShadow=false;}
  const pencil=mesh(cylinder,'#aa8751',1.4,.14,1.95,.025,1.2,.025);pencil.rotation.z=Math.PI/2;pencil.rotation.y=.2;
  const slip=mapped(geom(new THREE.PlaneGeometry(.8,1.3)),texture(320,520,c=>{c.fillStyle='#d8cfb0';c.fillRect(0,0,320,520);c.fillStyle='#394335';c.font='600 28px monospace';c.fillText('LAST COUNT',35,70);c.font='22px monospace';for(let i=0;i<7;i++)c.fillText('00'+(i+1)+'  ______',35,130+i*44); }));slip.rotation.x=-Math.PI/2;slip.rotation.z=.13;slip.position.set(-1.55,.1,2.25);

 }
 function paintBill(){if(!bill)return;const card=cashDeck(42)[cash.index];if(!card){cardGroup.visible=false;return;}const t=texture(1024,560,c=>paintAtelierBanknote(c,card.label,card.valid,card.id));const old=billTexture??(bill.material as THREE.MeshStandardMaterial).map;if(old){old.dispose();textures.delete(old);}billTexture=t;(bill.material as THREE.MeshStandardMaterial).map=t;cardGroup.visible=true;}
 function updatePose(){if(!photo)return;const client=CLIENTS[clientIndex];if(!client)return;const pose=photoPose(client.id,elapsed/1000,42);subject.position.y=pose.lift*.55;subject.rotation.z=pose.sway;board.visible=client.id==='backdrop';board.position.x=pose.boardX+1.65;umbrella.visible=client.id==='umbrella';birds.forEach((b,i)=>{b.visible=client.id==='pigeons'&&pose.birds[i]>0;b.position.y=2.9+pose.birds[i];});humanFace.visible=client.id!=='pigeons';const head=anchors.get('head')!;head.visible=humanFace.visible;}
 function refresh(){root.dataset.index=String(photo?clientIndex:cash.index);root.dataset.ended=String(ended);root.dataset.mistakes=String(cash.mistakes);root.dataset.film=String(film);root.dataset.stars=String(totalStars);root.dataset.elapsed=String(Math.floor(elapsed));progress.textContent=photo?`${Math.min(clientIndex+1,3)} / 03`:`${(cash.amount/10000).toFixed(0)} / 100 萬`;note.textContent=ended?'本局完成 · 尚未上線':photo?`${CLIENTS[clientIndex].title} · 底片 ${RULES.film-film} 張`:`${String(cash.index+1).padStart(2,'0')} / 30 · ${cashDeck(42)[cash.index]?.label??'已完成'}`;action.disabled=ended;if(reject)reject.disabled=ended;receipts.forEach((r,i)=>r.visible=i<cash.index/3);updatePose();}
 function render(){if(disposed||lost)return;updatePose();const started=performance.now();renderer.render(scene,camera);root.dataset.native='true';root.dataset.drawCalls=String(renderer.info.render.calls);root.dataset.triangles=String(renderer.info.render.triangles);root.dataset.renderMs=(performance.now()-started).toFixed(2);root.dataset.panX=String(panX);root.dataset.panY=String(panY);}
 function updateCamera(){const layout=atelierLayout(root.clientWidth,root.clientHeight,photo),{extent,viewWidth}=layout;for(const part of fullSet){if(part.kind==='bench'){part.mesh.scale.x=layout.benchWidth;if(part.mesh.geometry.type==='PlaneGeometry')part.mesh.scale.y=layout.benchDepth;else part.mesh.scale.z=layout.benchDepth;}else if(part.kind==='lane')part.mesh.scale.z=layout.benchDepth;else{part.mesh.scale.x=layout.backdropWidth;if(part.kind==='backdrop'){part.mesh.scale.y=layout.backdropHeight;part.mesh.position.y=layout.backdropHeight/2-2;}}}root.dataset.sceneCoverage='full-viewport';camera.left=-viewWidth/2;camera.right=viewWidth/2;camera.top=extent/2;camera.bottom=-extent/2;if(photo){camera.position.set(panX,4.2+panY,10);camera.lookAt(panX,2+panY,0);}else{camera.position.set(0,8,5);camera.lookAt(0,0,0);}camera.updateProjectionMatrix();camera.updateMatrixWorld();}
 function cancelPointer(){const id=pointer;pointer=null;if(id!==null&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);cardGroup.position.x=0;cardGroup.rotation.z=0;}
 function nextClient(grade:PhotoGrade){cancelPointer();totalStars+=grade.stars;feedback.textContent=grade.caption;clientIndex++;film=0;bestPhoto=null;elapsed=0;panX=0;panY=0;if(clientIndex===CLIENTS.length){ended=true;root.dataset.flash='false';feedback.textContent=`三位客人已拍完 · ${totalStars} / 9 星`;stop();}updateCamera();refresh();render();}
 function capture(){if(paused||lost||disposed||ended)return;updatePose();scene.updateMatrixWorld(true);camera.updateMatrixWorld();const fr=root.querySelector<HTMLElement>('.night-frame')!.getBoundingClientRect(),cr=canvas.getBoundingClientRect();const visible:string[]=[];for(const [id,o] of anchors){if(!o.visible)continue;const bounds=new THREE.Box3().setFromObject(o);if(bounds.isEmpty()){const center=o.getWorldPosition(new THREE.Vector3());bounds.setFromCenterAndSize(center,new THREE.Vector3(.82,.15,.5));}let inside=true;for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const p=new THREE.Vector3(x,y,z).project(camera),px=cr.left+(p.x+1)*cr.width/2,py=cr.top+(1-p.y)*cr.height/2;if(px<fr.left||px>fr.right||py<fr.top||py>fr.bottom)inside=false;}if(inside)visible.push(id);}const head=anchors.get('head')!.getWorldPosition(new THREE.Vector3()).project(camera);const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(head.x,head.y),camera);const blocked=board.visible&&ray.intersectObjects(board.children,false).length>0;const client=CLIENTS[clientIndex];const grade=gradePhoto(client.id,visible,elapsed/1000,blocked,photoPose(client.id,elapsed/1000,42).lift);if(!bestPhoto||grade.stars>bestPhoto.stars)bestPhoto=grade;film++;flashUntil=performance.now()+90;root.dataset.flash=String(!matchMedia('(prefers-reduced-motion: reduce)').matches);feedback.textContent=`${grade.stars} 星 · ${grade.details}`;if(film===RULES.film)nextClient(bestPhoto);else refresh();render();}
 function sort(accept:boolean){if(photo||paused||lost||disposed||ended)return;const previousAmount=cash.amount,card=cashDeck(42)[cash.index];const result=sortCash(cash,cash.index,accept,performance.now());if(result.kind==='ignored'){render();return;}cash=result.state;lastCashRender=-Infinity;cashMotionUntil=result.kind!=='wrong'&&!matchMedia('(prefers-reduced-motion: reduce)').matches?performance.now()+180:0;delete root.dataset.decision;if(result.kind!=='wrong'){void root.offsetWidth;root.dataset.decision=accept?'keep':'reject';}feedback.textContent=result.kind==='wrong'?(card.valid?'這是鈔票，向右收下。':'這是大餅，向左退回。'):accept?`＋${(cash.amount-previousAmount)/10000} 萬 · 已分類 ${cash.index} / 30 張`:`大餅退回！已分類 ${cash.index} / 30 張`;ended=cash.endedAt!==null;if(ended){cashMotionUntil=0;cardGroup.position.y=0;root.dataset.cashSettled='true';stop();feedback.textContent=`100 萬盤點完成 · 誤判 ${cash.mistakes} 次`;}cancelPointer();paintBill();refresh();render();start();}
 function stop(){cancelAnimationFrame(frame);frame=0;}
 function animate(t:number){frame=0;if(paused||lost||disposed||ended)return;if(!photo&&t<cashMotionUntil&&t-lastCashRender<1000/30){frame=requestAnimationFrame(animate);return;}lastCashRender=t;elapsed+=Math.max(0,t-last);last=t;if(!photo){const remaining=Math.max(0,(cashMotionUntil-t)/180);cardGroup.position.y=.18*remaining*remaining;root.dataset.cashSettled=String(remaining===0);}if(photo&&elapsed>=RULES.photoMs)nextClient(bestPhoto??{stars:0,caption:'還沒按快門，客人先走了。',details:''});if(performance.now()>=flashUntil)root.dataset.flash='false';if(photo)refresh();render();if((photo||t<cashMotionUntil)&&!paused&&!lost&&!ended)frame=requestAnimationFrame(animate);}
 function start(){last=performance.now();if((photo||cashMotionUntil>last)&&!frame&&!ended&&!paused&&!lost)frame=requestAnimationFrame(animate);}
 function pause(){if(disposed||paused)return;paused=true;cancelPointer();stop();panel.hidden=false;controls.inert=true;footer.inert=true;canvas.inert=true;root.dataset.paused='true';resume.focus();}
 function unpause(){if(lost)return;if(!photo){cashMotionUntil=0;cardGroup.position.y=0;root.dataset.cashSettled='true';}paused=false;panel.hidden=true;controls.inert=false;footer.inert=false;canvas.inert=false;root.dataset.paused='false';canvas.focus();render();start();}
 function reset(){cashMotionUntil=0;cardGroup.position.y=0;root.dataset.cashSettled='true';delete root.dataset.decision;cancelPointer();stop();cash=newCash(42);clientIndex=0;film=0;bestPhoto=null;elapsed=0;totalStars=0;ended=false;panX=0;panY=0;root.dataset.flash='false';feedback.textContent=photo?CLIENTS[0].request:'鈔票與大餅混在一起，先讀再決定。';paintBill();updateCamera();refresh();render();start();}
 const down=(e:PointerEvent)=>{if(paused||lost||ended||pointer!==null||!e.isPrimary||e.button!==0)return;e.preventDefault();canvas.focus();pointer=e.pointerId;startX=e.clientX;startY=e.clientY;dragX=panX;dragY=panY;dragIndex=photo?clientIndex:cash.index;canvas.setPointerCapture(pointer);};
 const move=(e:PointerEvent)=>{if(e.pointerId!==pointer||paused||lost)return;e.preventDefault();const dx=e.clientX-startX,dy=e.clientY-startY;if(photo){panX=clamp(dragX-dx/root.clientWidth*5,-2,2);panY=clamp(dragY+dy/root.clientHeight*5,-1,2);updateCamera();}else{cardGroup.position.x=clamp(dx/root.clientWidth*8,-2,2);cardGroup.rotation.z=-cardGroup.position.x*.035;}render();};
 const up=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;const dx=e.clientX-startX,dy=e.clientY-startY,index=dragIndex;cancelPointer();if(!photo&&index===cash.index&&Math.abs(dx)>=RULES.swipePx&&Math.abs(dx)>Math.abs(dy)){sort(dx>0);return;}render();};
 const cancel=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;cancelPointer();render();};canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
 root.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();paused?unpause():pause();}else if(paused&&e.key==='Tab'){e.preventDefault();resume.focus();}else if(e.target===canvas&&photo&&(e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();capture();}});
 action.addEventListener('click',()=>photo?capture():sort(true));reject?.addEventListener('click',()=>sort(false));root.querySelector('[data-pause]')!.addEventListener('click',pause);root.querySelector('[data-reset]')!.addEventListener('click',reset);resume.addEventListener('click',unpause);root.querySelector('[data-full]')!.addEventListener('click',()=>{const p=document.fullscreenElement===root?document.exitFullscreen():root.requestFullscreen?.();void p?.catch(()=>feedback.textContent='瀏覽器未允許全螢幕，目前仍可繼續遊戲。');});
 function resize(){if(disposed)return;updateCamera();renderer.setSize(Math.max(1,root.clientWidth),Math.max(1,root.clientHeight),false);render();}
 const observer=new ResizeObserver(resize);observer.observe(root);const visibility=()=>{if(document.hidden)pause();};const blur=()=>pause();document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',blur);
 const contextLost=(e:Event)=>{e.preventDefault();pause();lost=true;root.dataset.native='lost';root.querySelector('[data-panel-copy]')!.textContent='3D 畫面中斷，進度保留。等待瀏覽器恢復。';resume.disabled=true;};const restore=()=>{lost=false;root.querySelector('[data-panel-copy]')!.textContent='畫面已恢復，進度仍在。';resume.disabled=false;resize();};canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',restore);
 reset();resize();
 return {dispose(){if(disposed)return;disposed=true;cancelPointer();stop();observer.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',blur);canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',restore);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());key.shadow.dispose();renderer.dispose();renderer.forceContextLoss();root.remove();style.remove();}};
}
