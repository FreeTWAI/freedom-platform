/** Original, state-driven Canvas2D stage. Uses camera math, never a WebGL renderer. */
import { PerspectiveCamera } from 'three';
import { cashDeck, CLIENTS, documentTitle, RULES, stampTarget } from './domain';
import type { Stage, StageView } from './stage';
import { captureDailyFrame, cashContains, cashCardPose, dailyCamera, paperPoint, photoFraming, photoTransforms, project, type DailyView, type WorldPoint } from './daily-scene-model';
const INK = '#49362f', PAPER = '#fff1d5', GOLD = '#e8bd68', TEAL = '#608b85', ROSE = '#dd8e91';
type Transform = (p: WorldPoint) => WorldPoint;
const identity: Transform = p => p;
export function createDailyLightStage(host: HTMLElement, onLost?: () => void): Stage {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw Error('無法開啟輕量場景：瀏覽器未提供 Canvas 2D，請換用支援的瀏覽器。');
    const ctx = context;
    canvas.className = 'daily-light-canvas'; canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';
    let view: DailyView | null = null, disposed = false, observer: ResizeObserver | undefined;
    let width = 1, height = 1, aspect = 1;
    const camera = new PerspectiveCamera();
    function screen(p: WorldPoint) { const v = project(camera, p); return { x: (v.x + 1) * width / 2, y: (1 - v.y) * height / 2, z: v.z }; }
    function polygon(points: WorldPoint[], color: string, transform = identity, stroke = INK, line = 1.5) {
        const p = points.map(v => screen(transform(v)));
        if (p.some(v => v.z < -1 || v.z > 1 || !Number.isFinite(v.x + v.y))) return;
        ctx.beginPath(); p.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)); ctx.closePath();
        ctx.fillStyle = color; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = line; ctx.stroke(); }
    }
    function rect(x: number, y: number, z: number, w: number, h: number, color: string, transform = identity, stroke = INK) {
        polygon([[x-w/2,y-h/2,z],[x+w/2,y-h/2,z],[x+w/2,y+h/2,z],[x-w/2,y+h/2,z]], color, transform, stroke);
    }
    function oval(x: number, y: number, z: number, rx: number, ry: number, color: string, transform = identity, stroke = INK) {
        polygon(Array.from({ length: 32 }, (_, i) => { const a = i * Math.PI / 16; return [x + Math.cos(a) * rx, y + Math.sin(a) * ry, z] as WorldPoint; }), color, transform, stroke);
    }
    function line(a: WorldPoint, b: WorldPoint, color: string, size = 2, transform = identity) {
        const p = screen(transform(a)), q = screen(transform(b)); if (p.z < -1 || p.z > 1 || q.z < -1 || q.z > 1) return;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.strokeStyle=color; ctx.lineWidth=size; ctx.lineCap='round'; ctx.stroke();
    }
    function text(label: string, p: WorldPoint, size: number, color = INK, transform = identity) {
        const a = screen(transform(p)), b = screen(transform([p[0], p[1] + size, p[2]]));
        if (a.z < -1 || a.z > 1) return;
        ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=`700 ${Math.max(9,Math.hypot(a.x-b.x,a.y-b.y))}px system-ui, sans-serif`;
        ctx.fillText(label,a.x,a.y);
    }
    function plane(x: number, z: number, w: number, h: number, y: number, color: string, stroke = INK) {
        polygon([[x-w/2,y,z-h/2],[x+w/2,y,z-h/2],[x+w/2,y,z+h/2],[x-w/2,y,z+h/2]],color,identity,stroke);
    }
    /** Paper graphics use their projected surface axes, not a screen-space hit target. */
    function paperText(label: string, x: number, z: number, y: number, size: number, color = INK) {
        const p=screen([x,y,z]), px=screen([x+1,y,z]), pz=screen([x,y,z+1]);
        ctx.save(); ctx.setTransform(px.x-p.x,px.y-p.y,pz.x-p.x,pz.y-p.y,p.x,p.y);
        ctx.font=`700 ${size}px system-ui, sans-serif`; ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,0,0);ctx.restore();
    }
    function eyes(x: number, y: number, z: number, scale: number, transform = identity) {
        for (const side of [-1,1]) {
            oval(x+side*scale*.65,y,z,scale*.48,scale*.58,PAPER,transform);
            oval(x+side*scale*.65+scale*.08,y-scale*.02,z+.025,scale*.19,scale*.28,INK,transform,'');
            oval(x+side*scale*.65,y+scale*.19,z+.03,scale*.07,scale*.09,'#fffaf0',transform,'');
        }
    }
    function pigeon(transform: Transform, index: number) {
        const color=['#799eae','#8e9bc0','#789b9a'][index];
        oval(0,-.10,0,.39,.43,color,transform); oval(0,.10,.07,.34,.34,'#bfd1d1',transform);
        oval(0,-.27,.18,.29,.13,index===1?'#ba9bdf':'#3f9c96',transform);
        for(const side of [-1,1]) oval(side*.34,-.26,.12,.15,.29,color,transform);
        eyes(0,.14,.29,.26,transform);
        for(const side of [-1,1]) line([side*.28,.35,.34],[side*.08,.31,.34],INK,2,transform);
        oval(0,-.015,.46,.14,.07,GOLD,transform);
        for(let i=0;i<3;i++) oval((i-1)*.08,.43+(i===1?.025:0),-.01,.055,.14,color,transform);
    }
    function human(v: StageView, transform: Transform) {
        const birds=CLIENTS[v.client].id==='pigeons', coat=birds?'#c99860':TEAL;
        for(const side of [-1,1]) {
            rect(side*.29,.63,0,.16,.9,INK,transform);
            oval(side*.29,.20,.3,.26,.17,'#ce795e',transform);
            rect(side*.29,.085,.4,.47,.09,PAPER,transform);
            for(let i=0;i<3;i++) line([side*.29-.10,.25+i*.035,.5],[side*.29+.10,.25+i*.035,.5],PAPER,1.5,transform);
        }
        polygon([[-.78,.72,.1],[.78,.72,.1],[.55,2.4,.1],[-.55,2.4,.1]],coat,transform);
        rect(0,2.23,.3,.34,.4,PAPER,transform);
        for(const side of [-1,1]) {
            polygon([[side*.08,2.4,.4],[side*.46,2.4,.4],[side*.26,1.83,.4]],birds?'#f1c28c':'#b0b7cb',transform);
            oval(side*.70,1.8,.18,.19,.65,coat,transform);
            oval(side*.73,1.04,.25,.18,.23,'#f7b582',transform);
            line([side*.23,1.25,.43],[side*.55,1.25,.43],INK,2,transform);
        }
        rect(0,1.58,.45,1.25,.11,INK,transform); rect(.10,1.58,.47,.23,.17,GOLD,transform);
        for(let i=0;i<4;i++) oval(-.075,1.01+i*.28,.46,.055,.055,GOLD,transform);
        if(birds) return;
        oval(0,2.95,.1,.57,.64,'#f7b582',transform);
        for(const side of [-1,1]) oval(side*.56,2.94,.12,.13,.20,'#f7b582',transform);
        eyes(0,3.07,.43,.37,transform);
        for(const side of [-1,1]) {
            oval(side*.36,2.83,.47,.13,.07,ROSE,transform,'');
            line([side*.35,3.4,.47],[side*.13,3.37,.47],INK,3,transform);
        }
        oval(0,2.91,.62,.16,.17,'#ef986f',transform);
        line([-.10,2.62,.47],[.10,2.62,.47],INK,2,transform);
        for(const [x,y,r] of [[-.35,3.39,.24],[0,3.51,.28],[.31,3.42,.24],[-.15,3.63,.23],[.12,3.67,.23]]) oval(x,y,.12,r,r*.88,'#93482e',transform);
        polygon([[-.12,2.3,.46],[.12,2.3,.46],[0,1.86,.46]],GOLD,transform);
    }
    function photo(v: StageView) {
        ctx.fillStyle='#d6c6bd';ctx.fillRect(0,0,width,height);
        rect(0,2.6,-2.1,12,7,'#d6c5d6',identity,'');
        for(let z=-3;z<6;z++)for(let x=-6;x<6;x++)plane(x+.5,z+.5,1,1,-.03,(x+z)%2?'#e8c8af':'#f7dfc6','');
        rect(0,2.15,-1.8,3.85,4.3,'#ac98b3');
        for(const side of [-1,1]) { rect(side*2.05,1.3,-1.7,.18,2.6,PAPER); line([side*2.45,0,-.25],[side*2.45,2.8,-.25],INK,3); rect(side*2.45,2.65,-.2,.65,1.02,PAPER); }
        text('怪事照相館',[0,4.43,-1.6],.22);
        const {client,board,bird,pose}=photoTransforms(v);
        human(v,client);
        if(CLIENTS[v.client].id==='umbrella') {
            line([.8,1.45,.06],[.8,4.54,.06],GOLD,3,client);
            oval(.8,4.21,.06,1.42,.52,ROSE,client);
            polygon([[-.62,4.16,.1],[2.22,4.16,.1],[1.9,4.07,.1],[1.5,4.19,.1],[1.05,4.07,.1],[.6,4.19,.1],[.15,4.07,.1]],'#ce788e',client);
            for(const x of [-.52,.15,.8,1.45,2.12])line([.8,4.69,.12],[x,4.16,.13],'#f7d8ce',1.5,client);
            oval(.8,4.73,.06,.09,.19,GOLD,client);
        }
        if(CLIENTS[v.client].id==='pigeons')for(let i=0;i<3;i++)if(pose.birds[i]>0)pigeon(p=>bird(i,p),i);
        if(CLIENTS[v.client].id==='backdrop') {
            rect(0,1.7,0,1.75,2.82,'#d89a72',board);rect(0,1.7,.15,1.58,2.62,GOLD,board);
            for(const side of [-1,1]) { line([side*.78,1.6,.18],[side*1.12,1.74,.18],'#d96c52',8,board);oval(side*1.12,1.74,.2,.14,.14,PAPER,board);rect(side*.43,.22,.24,.28,.36,'#d96c52',board); }
            eyes(0,2.06,.25,.48,board);oval(0,1.61,.3,.25,.16,INK,board);oval(0,1.54,.32,.16,.06,ROSE,board,'');text('我也要拍',[0,.95,.3],.20,INK,board);
        }
    }
    function desk() {
        ctx.fillStyle='#b6c2bb';ctx.fillRect(0,0,width,height);
        plane(0,0,9,7,-.12,'#72948b');plane(0,0,3.6,4.2,.02,'#d6ac83');
        for(let i=-3;i<=3;i++)line([-4,.025,i],[4,.025,i],'#63897f',1);
        oval(-2.5,.5,-1.6,.35,.22,GOLD);line([-2.5,.2,-1.6],[-2.5,1.6,-1.6],INK,3);oval(-2.2,1.7,-1.6,.4,.20,ROSE);
        oval(-2.5,.30,1,.28,.32,ROSE);oval(-2.5,.55,1,.24,.10,INK);eyes(-2.5,.30,1.1,.12);
    }
    function mark(x: number, z: number, hit: boolean, label='已閱') {
        const color=hit?'#487300':'#a53c4b';
        plane(x,z,.48,.40,.10,PAPER,color);paperText(label,x,z,.105,.18,color);
    }
    function stampScene(v: DailyView) {
        desk();const s=v.stamp;if(!s)return;
        for(let i=0;i<Math.min(s.index,12);i++)plane(2.55,-.5,1.25,1.65,.05+i*.035,PAPER);
        plane(0,0,3,3.7,.064,'#d8c3ab');plane(0,0,3,3.7,.075,PAPER);
        plane(0,-1.91,.52,.24,.16,INK);plane(0,-1.88,.44,.16,.19,GOLD);
        plane(1.88,1.2,.70,.68,.23,INK);plane(1.88,1.2,.59,.57,.24,'#a34232');
        plane(0,0,3,3.7,.086,PAPER);plane(0,0,2.76,3.45,.088,PAPER,'#b8a58b');
        paperText(documentTitle(Math.min(s.index,11),s.practice),0,-1.38,.09,.19);
        paperText(s.practice?'不計時練習':`公文 ${Math.min(s.index+1,12)} / 12`,0,-1.04,.09,.13);
        for(let i=0;i<3;i++)line([-1.1,.09,-.74+i*.16],[.88-i*.15,.09,-.74+i*.16],'#d8c3ab',2);
        const target=stampTarget(s.seed,Math.min(s.index,11));
        const circle=Array.from({length:64},(_,i)=>{const a=i*Math.PI/32;return [(target.x+Math.cos(a)*RULES.stampRadius)*1.2,.092,(target.y+Math.sin(a)*RULES.stampRadius)*1.5] as WorldPoint;});
        ctx.setLineDash([6,4]);polygon(circle,'#e2e9d3',identity,TEAL,2);ctx.setLineDash([]);
        paperText('蓋這裡',target.x*1.2,target.y*1.5+.48,.095,.13,TEAL);
        s.marks.forEach(m=>mark(m.x*1.2,m.y*1.5,m.hit));
        const f=v.stampFeedback, age=f?v.seconds*1000-f.at:Infinity;
        if(f&&age>=0&&age<420){ctx.save();ctx.globalAlpha=1-age/500;mark(f.point.x*1.2,f.point.y*1.5,f.hit);ctx.restore();paperText(f.hit?'上張已閱':'沒有蓋中',0,1.5,.11,.14,f.hit?'#487300':'#a53c4b');}
        const pulse=1-Math.min(1,Math.max(0,v.seconds*1000-s.lastAt)/180), active=v.raised||pulse>0||s.endedAt!==null;
        const x=active?v.stampPoint.x*1.2:1.88,z=active?v.stampPoint.y*1.5:1.2,y=v.raised?1.15:.10+(1-Math.max(0,pulse))*.15;
        plane(x,z,.49,.47,y,INK);rect(x,y+.10,z,.46,.18,'#ce795e');polygon([[-.13,.18],[-.17,.25],[-.095,.34],[-.09,.49],[-.12,.59],[-.26,.72],[-.25,.81],[-.18,.88],[0,.91],[.18,.88],[.25,.81],[.26,.72],[.12,.59],[.09,.49],[.095,.34],[.17,.25],[.13,.18]].map(([dx,dy])=>[x+dx,y+dy,z] as WorldPoint),TEAL);
        rect(x,y+.27,z+.08,.26,.035,GOLD);rect(x,y+.58,z+.08,.26,.035,GOLD);
        const crabX=1.98+(v.motion?Math.sin(v.seconds*.8)*.12:0);
        oval(crabX,.33,.1,.34,.18,'#d98565');for(const side of [-1,1]) {line([crabX+side*.15,.4,.1],[crabX+side*.15,.8,.1],'#d98565',3);oval(crabX+side*.15,.8,.13,.075,.08,PAPER);oval(crabX+side*.15,.8,.14,.03,.04,INK);}
    }
    function cashScene(v: DailyView) {
        desk();const s=v.cash;if(!s)return;
        plane(-2.7,0,1.6,2.3,.05,'#e9ad9e');plane(2.7,0,1.6,2.3,.05,'#b9cf85');
        paperText('退票券',-2.7,-.8,.10,.24);paperText('收現金',2.7,-.8,.10,.24);
        for(let i=0;i<Math.min(24,s.index-s.rejected);i++)plane(2.7,.15,1.28,1.65,.10+i*.022,'#c8d6ac');
        for(let i=0;i<Math.min(6,s.rejected);i++)plane(-2.7,.15,1.28,1.65,.10+i*.025,'#f4c6be');
        for(let i=0;i<Math.min(8,30-s.index);i++)plane(0,0,3.2,2.15,.08+i*.026,'#a6b58f');
        if(s.endedAt!==null){paperText('盤點完成',0,0,.33,.32);return;}
        const card=cashDeck(s.seed)[Math.min(s.index,29)],pose=cashCardPose(v,aspect),x=pose.x,y=pose.y,z=pose.z;
        plane(x,z,3.2,2.15,y,card.valid?'#c8d6ac':'#f4c6be');plane(x,z,3.02,1.97,y+.002,card.valid?'#c8d6ac':'#f4c6be',card.valid?'#61866a':'#bf737b');
        // The pigeon portrait is drawn directly on the same moving bill plane.
        const portrait:Transform=p=>[x-.98+p[0]*.6,y+.005+p[2]*.005,z+p[1]*-.9];
        pigeon(portrait,card.valid?2:1);
        paperText(card.valid?'怪事銀行・道具鈔':'老闆親發・非現金',x+.38,z-.67,y+.01,.15);
        paperText(card.label,x+.38,z-.08,y+.01,card.label.length>7?.19:.31);
        paperText(card.valid?'遊戲道具，無兌換價值':'不能算進一百萬',x+.38,z+.41,y+.01,.12);
        paperText(`ODD JOBS  № ${String(card.id+1).padStart(4,'0')}`,x+.35,z+.76,y+.01,.10);
        const age=v.seconds*1000-s.lastAt;
        if(s.feedback&&age>=0&&age<600)paperText(s.feedback==='correct'?'分類正確':'再看清楚這張',0,1.56,.35,.20,s.feedback==='correct'?'#487300':'#a53c4b');
    }
    function draw() {
        if(!view||disposed)return;
        ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.setLineDash([]);
        dailyCamera(view,aspect,camera);
        if(view.game==='photo')photo(view);else if(view.game==='stamp')stampScene(view);else cashScene(view);
    }
    function resize() {
        if(disposed)return;
        const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight),scale=Math.min(window.devicePixelRatio||1,1.5,960/w,720/h);
        aspect=w/h;
        width=canvas.width=Math.max(1,Math.round(w*scale));height=canvas.height=Math.max(1,Math.round(h*scale));draw();
    }
    function dispose(){if(disposed)return;disposed=true;observer?.disconnect();canvas.remove();view=null;canvas.width=1;canvas.height=1;}
    try { host.append(canvas);observer=new ResizeObserver(() => { try { resize(); } catch (cause) { if (disposed) return; if (onLost) onLost(); else throw cause; } });observer.observe(host);resize(); }
    catch(cause){dispose();throw cause;}
    return {
        update(next){if(disposed)return;view=next;draw();},
        capture(){if(disposed||!view)throw Error('場景尚未準備好，請稍後再拍。');draw();return captureDailyFrame(canvas);},
        framing(){return view?photoFraming(view,aspect):{visible:[],blocked:false,lift:0};},
        point(x,y){return view?paperPoint(view,host.getBoundingClientRect(),x,y):null;},
        cashContains(x,y){return view?cashContains(view,host.getBoundingClientRect(),x,y):false;},
        stats(){return {calls:0,triangles:0,geometries:0,textures:0};},dispose,
    };
}
