import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {transformSync} from 'esbuild';
import {EXPERIENCE_PROFILES} from '../../apps/portal-web/src/experience-profiles.js';

const source=readFileSync(new URL('../../apps/portal-web/src/modules/WorkbenchPanel.tsx',import.meta.url),'utf8');
const readCss=(file:string)=>readFileSync(new URL(`../../apps/portal-web/src/${file}`,import.meta.url),'utf8');

test('only the community work pagination action imports and uses its own paired-color rule',()=>{
  assert.match(source,/import ['"]\.\/WorkbenchPanel\.css['"]/);
  assert.equal((source.match(/workbench-load-more/g)??[]).length,1);
  assert.match(source,/className="btn btn-secondary btn-small workbench-load-more" disabled=\{loadingMore\}/);
  const css=readCss('modules/WorkbenchPanel.css');
  const selector='.workbench-load-more.btn-secondary';
  const rule=css.match(/\.workbench-load-more\.btn-secondary\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);assert.match(rule,/background:\s*var\(--bg-elev\)/);assert.match(rule,/color:\s*var\(--ink\)/);
  assert.match(rule,/border:\s*1px solid var\(--line\)/);
  assert.ok(css.includes(selector+':hover:not(:disabled)'));assert.ok(css.includes(selector+':focus-visible'));
  assert.match(css,/outline:\s*2px solid var\(--focus\)/);
  for(const match of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{/g)){
    assert.ok(match[1].split(',').every(value=>value.trim().startsWith(selector)),'no global or neighboring action selectors');
  }
  assert.doesNotMatch(css,/min-height|padding|font-size|opacity|pointer-events/,'retain existing small-button geometry and disabled behavior');
});

// This checks source tokens, not CSS cascade or native-browser contrast.
test('all five real profile palettes pair readable pagination text and focus with their surface',()=>{
  const tokens=(file:string)=>Object.fromEntries([...readCss(file).matchAll(/(--(?:ink|bg-elev|focus))\s*:\s*(#[\da-fA-F]+)/g)].map(m=>[m[1],m[2]]));
  const luminance=(hex:string)=>{
    const value=hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex;
    const c=[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return c[0]*.2126+c[1]*.7152+c[2]*.0722;
  };
  const ratio=(a:string,b:string)=>{const v=[luminance(a),luminance(b)].sort((a,b)=>a-b);return(v[1]+.05)/(v[0]+.05);};
  assert.equal(Object.values(EXPERIENCE_PROFILES).length,5);
  for(const profile of Object.values(EXPERIENCE_PROFILES)){
    const palette={...tokens('styles.css'),...tokens('rpg-theme.css'),...(profile.baseTheme!=='dark'?tokens('light-theme.css'):{}),...(profile.baseTheme==='versefolk'?tokens('versefolk-theme.css'):{}),...(profile.skin==='dragon'?tokens('dragon-theme.css'):{})};
    assert.ok(ratio(palette['--ink'],palette['--bg-elev'])>=4.5,profile.id+' text');
    assert.ok(ratio(palette['--focus'],palette['--bg-elev'])>=3,profile.id+' focus');
  }
});

type Element={type:any;props:Record<string,any>};
// Executes the actual TSX with a small hook model. This is not React lifecycle,
// DOM, CSS cascade, session-authorization or native-browser evidence.
function workbenchModel(nextCursor:string|null='opaque/cursor'){
  const first={work_item_id:'first'};
  const dashboard={summary:{accepted_count:0},now:[],next:[],review_queue:[],gained:[]};
  const slots:any[]=[false,false,null,'',dashboard,[first],nextCursor];let cursor=0;
  const calls:string[]=[];let get:(path:string)=>Promise<unknown>=async()=>{throw Error('No synthetic response');};
  const hooks={useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],(next:any)=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useCallback:(fn:unknown)=>fn,useEffect:()=>{}};
  const jsx=(type:any,props:any)=>({type,props});
  const module={exports:{} as {WorkbenchPanel:()=>Element}};
  const dependencies:Record<string,unknown>={
    react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},
    '../api':{requireCursorPage:(value:unknown)=>value,requireDashboard:(value:unknown)=>value},
    '../portal-session':{client:{get:(path:string)=>{calls.push(path);return get(path);}},usePortal:()=>({session:{user:{user_id:'synthetic'}},pending:null,mutate:()=>{throw Error('Unexpected mutation');}})},
    '../portal-feedback':{Section:'section',EmptyState:'empty',ErrorPanel:'error'},
    './ModuleBanner':{ModuleBanner:'banner'},'./BenefitObservations':{},'./ContributionOutcomes':{},'../format':{},'./WorkbenchPanel.css':{},
  };
  new Function('module','exports','require',transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code)(module,module.exports,(id:string)=>{
    assert.ok(Object.hasOwn(dependencies,id),'Unexpected dependency: '+id);return dependencies[id];
  });
  const flatten=(node:any):Element[]=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(flatten)];
  const render=()=>{cursor=0;return flatten(module.exports.WorkbenchPanel());};
  return {render,calls,slots,setGet:(reader:typeof get)=>{get=reader;},button:()=>render().find(n=>n.type==='button'&&['載入較早的社群工作','正在載入…'].includes(n.props.children))};
}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('pagination visibility and loading disable remain driven by cursor and pending request',async()=>{
  assert.equal(workbenchModel(null).button(),undefined);
  const model=workbenchModel();let release!:(value:unknown)=>void;
  model.setGet(()=>new Promise(resolve=>{release=resolve;}));
  const button=model.button()!;assert.equal(button.props.type,'button');assert.equal(button.props.disabled,false);
  button.props.onClick();const pending=model.button()!;
  assert.equal(pending.props.children,'正在載入…');assert.equal(pending.props.disabled,true);
  pending.props.onClick();assert.deepEqual(model.calls,['/work-items/page?cursor=opaque%2Fcursor']);
  release({items:[],next_cursor:null});await flush();assert.equal(model.button(),undefined);
});

test('failed pagination preserves existing items and cursor for an enabled retry without duplicates',async()=>{
  const model=workbenchModel();model.setGet(async()=>{throw Error('Synthetic unavailable page');});
  model.button()!.props.onClick();await flush();
  assert.equal(model.button()!.props.disabled,false);assert.equal(model.slots[3],'較早的社群工作暫時無法載入。');
  assert.deepEqual(model.slots[5],[{work_item_id:'first'}]);assert.equal(model.slots[6],'opaque/cursor');
  model.setGet(async()=>({items:[{work_item_id:'first'},{work_item_id:'second'}],next_cursor:null}));
  model.button()!.props.onClick();await flush();
  assert.equal(model.slots[3],'');assert.deepEqual(model.slots[5],[{work_item_id:'first'},{work_item_id:'second'}]);
  assert.equal(model.button(),undefined);assert.equal(model.calls.length,2);
});

test('native focus checks do not assume the existing dark Workbench ancestor is a solid surface',()=>{
  assert.match(readCss('LayoutDesign.css'),/\.main\s*\{\s*background:\s*linear-gradient\(/,'the current dark page uses a gradient');
  const e2e=readFileSync(new URL('../e2e/work-pagination.spec.ts',import.meta.url),'utf8');
  const helper=e2e.slice(e2e.indexOf('async function expectWorkPaginationColors'),e2e.indexOf("for(const profile of ['light'"));
  assert.match(helper,/Focus contrast is button-side only/);
  assert.match(helper,/focus:ratio\(style.outlineColor,style.backgroundColor\)/);
  assert.doesNotMatch(helper,/adjacentSurface|adjacentFocus|outer\.backgroundImage/,'do not reject the supported ancestor gradient or infer its pixels');
  assert.match(helper,/Number\(outer.opacity\)!==1/,'ancestor transparency still invalidates the opaque-color model');
});

// Both community-work pagination leaves share the palette contract, not a new
// component/session API. TaskBoard retains its independent loading lane tests.
test('TaskBoard pagination owns its exact style without changing filter, loading or composition guards',()=>{
  const taskBoard=readFileSync(new URL('../../apps/portal-web/src/modules/TaskBoardPanel.tsx',import.meta.url),'utf8');
  assert.match(taskBoard,/import ['"]\.\/TaskBoardPanel\.css['"]/);
  assert.equal((taskBoard.match(/task-board-load-more/g)??[]).length,1);
  assert.match(taskBoard,/className="btn btn-secondary btn-small task-board-load-more" disabled=\{loading\|\|loadingMore\|\|composing\} onClick=\{loadMore\}/);
  const css=readCss('modules/TaskBoardPanel.css'),selector='.task-board-load-more.btn-secondary';
  const rule=css.match(/\.task-board-load-more\.btn-secondary\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);assert.match(rule,/background:\s*var\(--bg-elev\)/);assert.match(rule,/color:\s*var\(--ink\)/);
  assert.match(rule,/border:\s*1px solid var\(--line\)/);
  assert.ok(css.includes(selector+':hover:not(:disabled)'));assert.ok(css.includes(selector+':focus-visible'));
  assert.match(css,/outline:\s*2px solid var\(--focus\)/);
  for(const match of css.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{/g))assert.ok(match[1].split(',').every(value=>value.trim().startsWith(selector)));
  assert.doesNotMatch(css,/min-height|padding|font-size|opacity|pointer-events/);
});
