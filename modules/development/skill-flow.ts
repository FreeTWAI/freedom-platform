import {escapeHtml} from '../../packages/shared/html.js';

const escape=escapeHtml;
/** 24×24 stroke icons drawn for the public skill pages. The legend shows them next to each step. */
export const SKILL_FLOW_ICONS={
 chat:'<path d="M4.5 5.5h15v10h-8.2l-3.8 3.4v-3.4h-3z"/><path d="M8 9.2h8M8 12h5"/>',
 doc:'<path d="M7 3.5h7.2l3.8 3.8v13.2H7z"/><path d="M14 3.5v4h4M9.6 12h5.8M9.6 15.5h5.8"/>',
 book:'<path d="M5.5 5.2A1.7 1.7 0 0 1 7.2 3.5h11.3v14H7.2a1.7 1.7 0 0 0-1.7 1.7z"/><path d="M5.5 19.2a1.7 1.7 0 0 0 1.7 1.3h11.3v-3M9 7.5h6"/>',
 list:'<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5"/>',
 search:'<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/>',
 check:'<circle cx="12" cy="12" r="8"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/>',
 shield:'<path d="M12 3.5 18.5 6v5.5c0 3.8-2.7 6.6-6.5 8.5-3.8-1.9-6.5-4.7-6.5-8.5V6z"/><path d="m9 11.8 2.1 2.1 4-4.2"/>',
 lock:'<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.6"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
 key:'<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12h8.5M17 12v3M19.5 12v2"/>',
 code:'<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 6l-3 12"/>',
 terminal:'<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="m7 10 3 2.5L7 15M12 15.5h5"/>',
 sliders:'<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="8" cy="17" r="1.8"/>',
 database:'<ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v11c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-11M5.5 12c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
 cloud:'<path d="M7.5 18h9a3.8 3.8 0 0 0 .3-7.6 5 5 0 0 0-9.6-.6A3.6 3.6 0 0 0 7.5 18z"/>',
 globe:'<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.2 2.3 3.3 5 3.3 8s-1.1 5.7-3.3 8c-2.2-2.3-3.3-5-3.3-8s1.1-5.7 3.3-8z"/>',
 image:'<rect x="4" y="5" width="16" height="14" rx="1.6"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/>',
 video:'<rect x="3.5" y="6.5" width="12" height="11" rx="1.6"/><path d="m15.5 10.5 5-3v9l-5-3z"/>',
 scissors:'<circle cx="6.5" cy="7" r="2.5"/><circle cx="6.5" cy="17" r="2.5"/><path d="M8.6 8.4 19 16.5M8.6 15.6 19 7.5"/>',
 mic:'<rect x="9" y="3.5" width="6" height="10" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3.5M9 20.5h6"/>',
 music:'<path d="M9 17.5V6l10-2v11.5"/><circle cx="6.8" cy="17.5" r="2.3"/><circle cx="16.8" cy="15.5" r="2.3"/>',
 people:'<circle cx="9" cy="8.5" r="2.8"/><path d="M3.8 19c.7-3 2.7-4.6 5.2-4.6s4.5 1.6 5.2 4.6"/><path d="M15.5 6.2a2.6 2.6 0 0 1 0 5.1M16.6 14.6c1.8.5 3 2 3.5 4.4"/>',
 user:'<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.9-3.8 3.6-5.8 7-5.8s6.1 2 7 5.8"/>',
 robot:'<rect x="5" y="8" width="14" height="11" rx="2.5"/><path d="M12 8V5M9.5 4.5h5"/><circle cx="9.5" cy="13" r="1.2"/><circle cx="14.5" cy="13" r="1.2"/><path d="M9.5 16.5h5"/>',
 chart:'<path d="M4.5 19.5h15"/><path d="M7 16.5v-4M11 16.5V7.5M15 16.5v-6M19 16.5v-9"/>',
 route:'<circle cx="6" cy="17" r="2"/><circle cx="18" cy="7" r="2"/><path d="M8 17h5.5a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6H16"/>',
 spark:'<path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z"/><path d="M18.5 15.5v4M16.5 17.5h4"/>',
 bolt:'<path d="M13 3.5 6 13.5h5.5L10.5 20.5 18 10h-5.5z"/>',
 clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
 calendar:'<rect x="4" y="5.5" width="16" height="14.5" rx="1.6"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
 upload:'<path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5M5 19.5h14"/>',
 download:'<path d="M12 4.5V15M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
 window:'<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M3.5 9h17M6.5 7h.01M9 7h.01"/>',
 phone:'<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
 hub:'<circle cx="12" cy="12" r="2.6"/><circle cx="5.5" cy="6" r="1.8"/><circle cx="18.5" cy="6" r="1.8"/><circle cx="5.5" cy="18" r="1.8"/><circle cx="18.5" cy="18" r="1.8"/><path d="m7 7.3 3 3M17 7.3l-3 3M7 16.7l3-3M17 16.7l-3-3"/>',
 layers:'<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16 12 20.5l8.5-4.5"/>',
 folder:'<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2H19a1.5 1.5 0 0 1 1.5 1.5V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
 pen:'<path d="m5 19 1-4.5L15.5 5a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9.5 18z"/><path d="m13.5 7 3.5 3.5"/>',
 mail:'<rect x="3.5" y="6" width="17" height="12" rx="1.6"/><path d="m4 7 8 6 8-6"/>',
 cart:'<path d="M3.5 5h2.5l2 10h10l1.8-7H7"/><circle cx="9.5" cy="18.5" r="1.4"/><circle cx="16.5" cy="18.5" r="1.4"/>',
 store:'<path d="M4.5 9.5 6 4.5h12l1.5 5zM4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0M6 12v7.5h12V12M10 19.5V15h4v4.5"/>',
 coin:'<circle cx="12" cy="12" r="8"/><path d="M14.5 9.2c-.5-.9-1.4-1.4-2.5-1.4-1.5 0-2.6.8-2.6 2 0 2.7 5.2 1.5 5.2 4.3 0 1.2-1.1 2-2.6 2-1.2 0-2.2-.6-2.7-1.5M12 6v1.8M12 16.2V18"/>',
 translate:'<path d="M4 6h9M8.5 4v2M6 6c.6 2.7 2.4 4.9 5 6M11 6c-.7 3-2.7 5.4-6 7"/><path d="m13 20 3.5-8 3.5 8M14.2 17.3h4.6"/>',
 game:'<path d="M7.5 8.5h9a4 4 0 0 1 3.9 4.9l-.8 3.3a2 2 0 0 1-3.4.9l-2-2.1h-4.4l-2 2.1a2 2 0 0 1-3.4-.9l-.8-3.3A4 4 0 0 1 7.5 8.5z"/><path d="M8.5 11.5v3M7 13h3M15 12.5h.01M17 14h.01"/>',
 eye:'<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.6"/>',
 bell:'<path d="M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z"/><path d="M10 20.5h4"/>',
 pin:'<path d="M12 20.5s-6-5.6-6-10.5a6 6 0 0 1 12 0c0 4.9-6 10.5-6 10.5z"/><circle cx="12" cy="10" r="2.2"/>',
 light:'<path d="M9.5 17.5h5M10 20.5h4M12 3.5a5.5 5.5 0 0 0-3.2 10c.5.4.7.9.7 1.5v1h5v-1c0-.6.2-1.1.7-1.5A5.5 5.5 0 0 0 12 3.5z"/>',
 star:'<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z"/>',
} as const;
export type SkillFlowIcon=keyof typeof SKILL_FLOW_ICONS;
export type SkillFlowStep={icon:SkillFlowIcon;title:string;note:string};
export type SkillFlow={title:string;lead:string;steps:readonly [SkillFlowStep,SkillFlowStep,SkillFlowStep];loop?:boolean;caption:string};

// Layout uses an estimated text width, never browser measurement, so the server renders the same SVG every time.
const VIEW=960,PAD=20,SIDE=232,CORE=308,TONES=['neutral','accent','info'] as const;
const WIDE=/[ᄀ-ᅟ⺀-〿぀-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
const NO_LINE_START=/^[、。，．,.：:；;？?！!…）〕］｝〉》」』】%％]/u;
const OPENING=/^[（〔［｛〈《「『【(]/u,CLOSING=/[、。，．：；？！…）〕］｝〉》」』】]$/u,TOKEN=/[A-Za-z0-9@#&+._/'’:-]+|\s+|./gu;
export const SKILL_FLOW_LIMITS={sideTitle:2,coreTitle:2,coreNote:3};
function width(text:string,size:number){
 let total=0;
 for(const char of text)total+=WIDE.test(char)?size:/[A-Z0-9]/.test(char)?size*.64:/[a-z]/.test(char)?size*.55:char===' '?size*.3:size*.42;
 return total;
}
/** Greedy wrap; Latin words stay whole unless a single word is wider than the line. */
function greedyWrap(text:string,size:number,max:number){
 const tokens=text.match(TOKEN)??[],lines:string[]=[];
 let line='';
 for(const token of tokens){
  if(/^\s+$/u.test(token)){if(line)line+=' ';continue;}
  if(width(line+token,size)<=max||!line.trim()||NO_LINE_START.test(token)){
   if(width(token,size)>max&&!line.trim()){for(const char of token){if(width(line+char,size)>max&&line){lines.push(line);line='';}line+=char;}continue;}
   line+=token;continue;
  }
  lines.push(line.trimEnd());line=token;
 }
 if(line.trim())lines.push(line.trimEnd());
 return lines;
}
/**
 * What a break before tokens[index] costs: nothing after punctuation or before an opening bracket, little between
 * CJK and Latin, more between Latin words, much more inside a CJK run, where it may split a word, and most before 的.
 */
function breakCost(tokens:string[],index:number){
 const space=/^\s+$/u.test(tokens[index-1]!),before=space?tokens[index-2]!:tokens[index-1]!,after=tokens[index]!;
 if(CLOSING.test(before)||OPENING.test(after))return 0;
 const wide=WIDE.test(before.slice(-1));
 if(wide!==WIDE.test(after[0]!))return 1;
 if(!wide)return space?3:12;
 return /^[的了們]/u.test(after)?20:12;
}
/**
 * Wraps into the greedy line count with the cheapest breaks: breakCost plus one per glyph between the longest and
 * shortest line, so phrases stay whole where they fit and no line is left with a stray glyph.
 */
export function wrapFlowText(text:string,size:number,max:number){
 const greedy=greedyWrap(text,size,max),tokens=text.match(TOKEN)??[];
 if(greedy.length<2||tokens.some(token=>width(token,size)>max))return greedy;
 const line=(from:number,to:number)=>tokens.slice(from,to).join('').replace(/\s+/gu,' ').trim();
 let best={cost:Infinity,lines:greedy};
 const place=(from:number,lines:string[],cost:number)=>{
  if(lines.length===greedy.length-1){
   const all=[...lines,line(from,tokens.length)],widths=all.map(value=>width(value,size));
   const total=cost+(Math.max(...widths)-Math.min(...widths))/size;
   if(widths.every(value=>value>0&&value<=max)&&total<best.cost)best={cost:total,lines:all};
   return;
  }
  for(let index=from+1;index<tokens.length;index++){
   const value=line(from,index);
   if(width(value,size)>max)break;
   if(!value||/^\s+$/u.test(tokens[index]!)||NO_LINE_START.test(tokens[index]!)||OPENING.test(tokens[index-1]!))continue;
   place(index,[...lines,value],cost+breakCost(tokens,index));
  }
 };
 place(0,[],0);
 return best.lines;
}
const pad2=(value:number)=>String(value).padStart(2,'0');
const text=(lines:string[],x:number,y:number,step:number,cls:string,size:number)=>lines.map((line,row)=>'<text class="'+cls+'" x="'+x+'" y="'+(y+row*step)+'" font-size="'+size+'">'+escape(line)+'</text>').join('');
/** Measured once per flow; tests use it to keep every authored step inside the drawn boxes. */
export function skillFlowLines(flow:SkillFlow){
 return flow.steps.map((step,index)=>index===1?{title:wrapFlowText(step.title,17,CORE-36),note:wrapFlowText(step.note,12.5,CORE-36)}:{title:wrapFlowText(step.title,15,SIDE-32),note:[] as string[]});
}
export function skillFlowSvg(flow:SkillFlow){
 const lines=skillFlowLines(flow);
 const sideHeight=(index:number)=>40+lines[index]!.title.length*20+10;
 const coreHeight=46+lines[1]!.title.length*22+(lines[1]!.note.length?8+lines[1]!.note.length*17:0)+14;
 const core=coreHeight,top=40,middle=top+core/2;
 const boxes=[{x:PAD,w:SIDE,h:sideHeight(0)},{x:(VIEW-CORE)/2,w:CORE,h:core},{x:VIEW-PAD-SIDE,w:SIDE,h:sideHeight(2)}].map(box=>({...box,y:middle-box.h/2}));
 const [left,center,right]=boxes as [typeof boxes[0],typeof boxes[0],typeof boxes[0]];
 const wires=['M'+(left.x+left.w)+' '+middle+'H'+center.x,'M'+(center.x+center.w)+' '+middle+'H'+right.x];
 const loopY=Math.max(left.y+left.h,right.y+right.h,middle+core/2+24)+30;
 const loop=flow.loop?'M'+(right.x+right.w/2)+' '+(right.y+right.h)+'V'+loopY+'H'+(left.x+left.w/2)+'V'+(left.y+left.h):'';
 const height=Math.ceil((flow.loop?loopY:middle+core/2+24)+PAD);
 const nodes=boxes.map((box,index)=>{
  const step=lines[index]!,isCore=index===1;
  const body=isCore?text(step.title,18,48,22,'sf-lbl sf-lbl-core',17)+text(step.note,18,48+step.title.length*22+8,17,'sf-sub',12.5):text(step.title,16,46,20,'sf-lbl',15);
  return '<g class="sf-node'+(isCore?' sf-node-core':'')+'" data-tone="'+TONES[index]+'" transform="translate('+box.x+' '+box.y+')"><rect class="sf-box" width="'+box.w+'" height="'+box.h+'" rx="14"/><text class="sf-idx" x="'+(isCore?18:16)+'" y="24" font-size="11">'+pad2(index+1)+'</text>'+body+'</g>';
 }).join('');
 const halo='<ellipse class="sf-halo" cx="'+VIEW/2+'" cy="'+middle+'" rx="'+(CORE/2+30)+'" ry="'+(core/2+24)+'"/>';
 const pulse='<circle class="sf-pulse" cx="'+(VIEW/2+CORE/2+14)+'" cy="'+(middle-core/2-8)+'" r="3.6"/>';
 const flows=[...wires,...(loop?[loop]:[])].map((d,index)=>'<path class="sf-flow" data-delay="'+index+'" d="'+d+'"/>').join('');
 return '<svg class="sf-svg" viewBox="0 0 '+VIEW+' '+height+'" width="'+VIEW+'" height="'+height+'" aria-hidden="true" focusable="false">'+halo+'<path class="sf-wire" d="'+[...wires,loop].filter(Boolean).join(' ')+'"/>'+flows+nodes+pulse+'</svg>';
}
export function skillFlowIcon(icon:SkillFlowIcon,cls='sf-icon'){
 return '<svg class="'+cls+'" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">'+SKILL_FLOW_ICONS[icon]+'</svg>';
}
/** The SVG is a decorative schematic; the ordered legend carries the same steps for every reader. */
export function skillFlowFigure(flow:SkillFlow){
 const legend=flow.steps.map((step,index)=>'<li class="sf-step" data-tone="'+TONES[index]+'"><span class="sf-head"><span class="sf-chip">'+skillFlowIcon(step.icon)+'</span><span class="sf-num" aria-hidden="true">'+pad2(index+1)+'</span></span><h3 class="sf-title">'+escape(step.title)+'</h3><p class="sf-note">'+escape(step.note)+'</p></li>').join('');
 return '<figure class="sf'+(flow.loop?' sf-loop':'')+'">'+skillFlowSvg(flow)+'<ol class="sf-legend">'+legend+'</ol><figcaption class="sf-caption">'+escape(flow.caption)+'</figcaption></figure>';
}
export const skillFlowCss='.sf{margin:28px 0 0;color:var(--sp-ink)}.sf-svg{display:block;width:100%;height:auto;overflow:visible}.sf-box{fill:var(--sp-card);stroke:var(--sp-line-strong);stroke-width:1}.sf-node[data-tone="accent"] .sf-box{stroke:var(--sp-lime-ink);stroke-width:1.7}.sf-node[data-tone="info"] .sf-box{stroke:var(--sp-info)}.sf-lbl{fill:var(--sp-ink);font-weight:650}.sf-lbl-core{font-weight:800}.sf-sub{fill:var(--sp-muted)}.sf-idx{fill:var(--sp-muted);font-family:var(--sp-mono);font-weight:700;letter-spacing:.08em}.sf-node[data-tone="accent"] .sf-idx{fill:var(--sp-lime-ink)}.sf-node[data-tone="info"] .sf-idx{fill:var(--sp-info)}.sf-wire{fill:none;stroke:var(--sp-line-strong);stroke-width:1.4}.sf-flow{fill:none;stroke:var(--sp-lime-ink);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:13 19;animation:sf-flow 2.4s linear infinite}.sf-flow[data-delay="1"]{animation-delay:-.8s}.sf-flow[data-delay="2"]{animation-delay:-1.6s}.sf-halo{fill:none;stroke:var(--sp-lime-ink);stroke-width:1.6;stroke-opacity:.5;stroke-linecap:round;stroke-dasharray:2 12;animation:sf-orbit 18s linear infinite}.sf-pulse{fill:var(--sp-lime-ink);transform-box:fill-box;transform-origin:center;animation:sf-pulse 2.6s ease-out infinite}@keyframes sf-flow{to{stroke-dashoffset:-64}}@keyframes sf-orbit{to{stroke-dashoffset:-140}}@keyframes sf-pulse{0%{opacity:1;transform:scale(1)}70%,100%{opacity:.15;transform:scale(2.2)}}.sf-legend{list-style:none;margin:26px 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.sf-step{margin:0;padding:18px 0 0;border-top:1px solid var(--sp-line)}.sf-head{display:flex;align-items:center;gap:10px}.sf-chip{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--sp-chip);color:var(--sp-ink)}.sf-step[data-tone="accent"] .sf-chip{background:var(--sp-lime);color:var(--sp-ink)}.sf-step[data-tone="info"] .sf-chip{background:var(--sp-info-soft);color:var(--sp-info)}.sf-icon{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.sf-num{font-family:var(--sp-mono);font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--sp-muted)}.sf-title{margin:12px 0 4px;font-size:17px;line-height:1.4;color:var(--sp-ink)}.sf-note{margin:0;color:var(--sp-muted);font-size:15px;line-height:1.65}.sf-caption{margin:18px 0 0;font-weight:700;font-size:15px;color:var(--sp-ink)}@media (max-width:720px){.sf-svg{display:none}.sf-legend{grid-template-columns:1fr;gap:0;margin-top:8px}.sf-step{position:relative;padding:16px 18px;border:1px solid var(--sp-line);border-radius:16px;background:var(--sp-card)}.sf-step+.sf-step{margin-top:26px}.sf-step+.sf-step::before{content:"";position:absolute;left:34px;top:-27px;height:26px;border-left:2px dashed var(--sp-line-strong)}.sf-step[data-tone="accent"]{border-color:var(--sp-lime-ink)}.sf-step[data-tone="info"]{border-color:var(--sp-info)}}@media (prefers-reduced-motion:reduce){.sf-flow,.sf-halo,.sf-pulse{animation:none}}';
