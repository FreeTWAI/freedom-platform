import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
import {ApiError} from '../../apps/portal-web/src/api';
const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialPostShare.tsx',import.meta.url),'utf8');
const actionSource=readFileSync(new URL('../../apps/portal-web/src/useLocalAction.ts',import.meta.url),'utf8');
type Node={type:string;props:any};
function all(tree:any):Node[]{return !tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(all)];}
function harness(mine=true){
  const hooks:any[]=[],effects:(()=>void)[]=[],reads:any[]=[],writes:any[]=[],copies:string[]=[],shares:any[]=[];let index=0;
  const client={sessionGeneration:1,get:(path:string)=>new Promise((resolve,reject)=>reads.push({path,resolve,reject})),post:(path:string,body:unknown,options:unknown)=>new Promise((resolve,reject)=>writes.push({path,body,options,resolve,reject}))};
  const post={post_id:'post-a',mine,kind:'note',revision:1,note:'完整私人正文',author:{display_name:'作者'}};const props:any={client,post};
  const effect=(fn:()=>unknown,deps:unknown[])=>{const i=index++;if(!hooks[i]||deps.some((v,n)=>v!==hooks[i].deps[n])){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn();});}};
  const react={useId:()=> 'share',useRef:(value:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},useCallback:(fn:any)=>fn,useLayoutEffect:effect,useEffect:effect,useState:(value:any)=>{const i=index++;if(!(i in hooks))hooks[i]=value;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];}};
  const navigator={share:async(data:any)=>{shares.push(data);throw Object.assign(new Error('cancel'),{name:'AbortError'});},clipboard:{writeText:async(url:string)=>{copies.push(url);}}};
  const elements=new Map<any,any>();
  const jsx=(type:string,p:any)=>{if(p?.ref){if(!elements.has(p.ref))elements.set(p.ref,{open:false,focused:false,selected:false,showModal(){this.open=true;},close(){this.open=false;},focus(){this.focused=true;},select(){this.selected=true;}});p.ref.current=elements.get(p.ref);}return {type,props:p};};
  const actionModule={exports:{} as any};runInNewContext(transformSync(actionSource,{loader:'ts',format:'cjs'}).code,{module:actionModule,exports:actionModule.exports,require:()=>react});
  const module={exports:{} as any};runInNewContext(transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code,{module,exports:module.exports,crypto:webcrypto,URL,AbortController,window:{location:{origin:'https://workshop.example.test'}},navigator,require:(name:string)=>{if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};if(name==='../useLocalAction')return actionModule.exports;if(name==='../portal-session')return {describeError:(e:any)=>({message:e.message})};if(name==='./SocialTools')return {SocialIcon:'icon'};throw Error(name);}});
  const render=()=>{index=0;const tree=module.exports.SocialPostShare(props);while(effects.length)effects.shift()!();return tree;};const view=()=>{render();return render();};
  const node=(predicate:(n:Node)=>boolean)=>all(view()).find(predicate)!;
  const button=(label:string)=>node(n=>n.type==='button'&&(n.props.children===label||n.props['aria-label']===label));
  const click=(label:string)=>{const n=button(label);assert.ok(n,label);assert.ok(!n.props.disabled,label+' enabled');return n.props.onClick();};
  const state={enabled:false,available:false,post_revision:1,media_version:'1',version:'1',public_path:null,image_url:null};
  const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
  const open=async()=>{click('分享貼文連結');view();reads.at(-1).resolve(mine?state:{});await settle();view();};
  return {client,props,reads,writes,copies,shares,navigator,state,view,node,button,click,open,settle};
}
test('restricted link is directly shareable/copyable; preview and raw URL are folded and neither action publishes',async()=>{
  const h=harness();await h.open();const nodes=all(h.view());
  assert.equal(h.node(n=>n.props.className==='social-sharing-consent').props.open,undefined);
  assert.ok(nodes.indexOf(h.button('複製貼文連結'))<nodes.findIndex(n=>n.props.className==='social-sharing-consent'));
  await h.click('複製貼文連結');await h.settle();assert.match(h.copies[0],/\?social-post=post-a#social$/);
  await h.click('系統分享');await h.settle();assert.equal(h.shares.length,1);assert.equal(h.writes.length,0);
  assert.equal(all(h.view()).some(n=>n.props.children==='系統分享暫時無法使用，可以複製貼文連結。'),false);
});
test('clipboard denial opens/selects fallback and close returns focus without publishing',async()=>{
  const h=harness();await h.open();h.navigator.clipboard.writeText=async()=>{throw Error('denied');};await h.click('複製貼文連結');await h.settle();
  assert.equal(h.node(n=>n.props.className==='social-share-link').props.ref.current.open,true);
  const field=h.node(n=>n.type==='input').props.ref.current;assert.equal(field.focused,true);assert.equal(field.selected,true);
  h.click('關閉分享');assert.equal(h.button('分享貼文連結').props.ref.current.focused,true);assert.equal(h.writes.length,0);
});
test('non-owner never receives publication controls',async()=>{const h=harness(false);await h.open();assert.equal(h.button('開放免登入閱讀'),undefined);await h.click('複製貼文連結');assert.equal(h.writes.length,0);});
test('unknown publication keeps same tuple and disabled sharing; successful retry reveals public URL',async()=>{
  const h=harness();await h.open();h.click('開放免登入閱讀');h.view();assert.equal(h.button('複製貼文連結').props.disabled,true);
  const first=h.writes[0];first.resolve({});await h.settle();assert.equal(h.node(n=>n.props.className==='social-sharing-consent').props.ref.current.open,true);
  assert.equal(h.button('複製貼文連結').props.disabled,true);h.click('確認上次設定');assert.deepEqual(h.writes[1].body,first.body);assert.deepEqual(h.writes[1].options,first.options);
  h.writes[1].resolve({...h.state,enabled:true,available:true,version:'2',public_path:'/posts/post-a'});await h.settle();await h.click('複製貼文連結');assert.equal(h.copies.at(-1),'https://workshop.example.test/posts/post-a');
});
for(const change of ['session','post','client'])test(`late publication acknowledgement cannot alter replacement ${change}`,async()=>{
  const h=harness();await h.open();h.click('開放免登入閱讀');if(change==='session')h.client.sessionGeneration++;if(change==='post')h.props.post={...h.props.post,post_id:'post-b'};if(change==='client')h.props.client={...h.client};h.view();
  h.writes[0].resolve({...h.state,enabled:true,available:true,version:'2',public_path:'/posts/post-a'});await h.settle();assert.equal(h.node(n=>n.type==='input').props.value.includes('/posts/post-a'),false);
});
test('unreviewed media and stale revision remain disabled instead of bypassing consent',async()=>{
  for(const state of [{image_url:'/api/v1/social-posts/post-a/thumbnail?v=1'},{post_revision:2}]){const h=harness();h.click('分享貼文連結');h.view();h.reads[0].resolve({...h.state,...state});await h.settle();assert.equal(h.button('開放免登入閱讀').props.disabled,true);assert.equal(h.writes.length,0);}
});
