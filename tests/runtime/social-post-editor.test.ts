import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {transformSync} from 'esbuild';
import {ApiError} from '../../apps/portal-web/src/api';

// Execute the whole real component: hooks retain state across close/reopen and
// scope changes, while the transport stays deferred. No copied save algorithm.
const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialPostEditor.tsx',import.meta.url),'utf8');
const compiled=transformSync(source,{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
type Node={type:string;props:any};
function find(tree:any,predicate:(node:Node)=>boolean):Node|undefined{
  if(!tree||typeof tree!=='object')return;
  if(predicate(tree))return tree;
  for(const child of [tree.props?.children].flat(Infinity)){const found=find(child,predicate);if(found)return found;}
}
function harness(kind:'note'|'link'='note'){
  const hooks:any[]=[],effects:(()=>void)[]=[],requests:any[]=[],saved:any[]=[];let index=0,closed=0;
  const client={sessionGeneration:1,post:(path:string,body:unknown,options:unknown)=>new Promise((resolve,reject)=>requests.push({path,body,options,resolve,reject}))};
  const original={post_id:'post-a',kind,revision:1,title:'before',note:kind==='note'?'before':null};
  const props:any={client,post:original,onClose(){closed++;},onSaved(value:unknown){saved.push(value);}};
  const react={useId:()=> 'editor',useRef:(value:unknown)=>{const i=index++;return hooks[i]??(hooks[i]={current:value});},
    useState:(value:unknown)=>{const i=index++;if(!(i in hooks))hooks[i]=typeof value==='function'?value():value;return [hooks[i],(v:any)=>{hooks[i]=typeof v==='function'?v(hooks[i]):v;}];},
    useEffect:(fn:()=>unknown,deps:unknown[])=>{const i=index++;if(!hooks[i]||deps.some((v,n)=>v!==hooks[i].deps[n])){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=fn();});}}};
  const jsx=(type:string,props:unknown)=>({type,props}),module={exports:{} as any};
  runInNewContext(compiled,{module,exports:module.exports,crypto:webcrypto,require:(name:string)=>{
    if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};if(name==='../api')return {ApiError};throw Error(name);
  }});
  const dialog={open:false,showModal(){this.open=true;},close(){this.open=false;}};
  function render(){index=0;const tree=module.exports.SocialPostEditor(props);tree.props.ref.current=dialog;while(effects.length)effects.shift()!();return tree;}
  function view(){render();return render();}
  function edit(value:string){const tree=view();find(tree,n=>n.type===(kind==='note'?'textarea':'input'))!.props.onChange({target:{value}});}
  function submit(){find(view(),n=>n.type==='form')!.props.onSubmit({preventDefault(){}});}
  function ack(request:any){return {...original,post_id:request.path.split('/')[2],revision:request.options.ifMatch+1,...('text' in request.body?{note:request.body.text}:request.body)};}
  return {props,client,original,requests,saved,view,edit,submit,ack,get closed(){return closed;}};
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const unknown=()=>new ApiError({message:'response lost',network:true});
const failure=(status:number,code:string)=>new ApiError({message:code,status,code});

for(const kind of ['note','link'] as const)test(`unknown ${kind} edit retries the original key/body/revision after close and another post`,async()=>{
  const h=harness(kind);h.edit('after');h.submit();assert.equal(h.requests.length,1);
  const first=h.requests[0];assert.equal(typeof first.options.idempotencyKey,'string');
  h.submit();assert.equal(h.requests.length,1,'in-flight lock includes repeated submission');
  first.reject(unknown());await settle();
  let tree=h.view();assert.equal(find(tree,n=>n.type===(kind==='note'?'textarea':'input'))!.props.disabled,true);
  assert.ok(find(tree,n=>n.type==='button'&&n.props.children==='確認上次儲存'));
  h.props.post=null;h.view();h.props.post={...h.original,post_id:'post-b'};h.edit('another draft');
  h.props.post={...h.original,revision:7,title:'new read',note:'new read'};tree=h.view();
  assert.equal(find(tree,n=>n.type===(kind==='note'?'textarea':'input'))!.props.value,'after');
  h.submit();const retry=h.requests[1];assert.deepEqual(retry.options,first.options);assert.deepEqual(retry.body,first.body);assert.equal(retry.path,first.path);
  retry.resolve(h.ack(retry));await settle();assert.equal(h.saved.length,0,'old replay must not replace the newer revision already read');assert.equal(h.closed,0);
  tree=h.view();assert.equal(find(tree,n=>n.type===(kind==='note'?'textarea':'input'))!.props.value,'new read');
  assert.ok(find(tree,n=>n.props.role==='status'&&n.props.children==='上次儲存已確認，目前已有較新版本。'));
  assert.equal(find(tree,n=>n.type==='button'&&n.props.children==='儲存變更')!.props.disabled,true);
});
for(const [status,code] of [[403,'author_required'],[404,'not_found'],[412,'version_conflict']] as const)test(`unknown edit remains sticky after later ${status}`,async()=>{
  const h=harness();h.edit('after');h.submit();h.requests[0].reject(unknown());await settle();
  h.submit();h.requests[1].reject(failure(status,code));await settle();h.submit();
  assert.deepEqual(h.requests[2].options,h.requests[0].options);assert.deepEqual(h.requests[2].body,h.requests[0].body);assert.equal(h.saved.length,0);assert.equal(h.closed,0);
  h.requests[2].resolve(h.ack(h.requests[2]));await settle();
});
test('first route validation rejection permits correction but unclassified 403 does not discard a command',async()=>{
  const h=harness();h.edit('invalid');h.submit();h.requests[0].reject(failure(422,'validation_failed'));await settle();
  assert.equal(find(h.view(),n=>n.type==='textarea')!.props.disabled,false);h.edit('corrected');h.submit();
  assert.notEqual(h.requests[1].options.idempotencyKey,h.requests[0].options.idempotencyKey);
  assert.equal(h.requests[1].body.text,'corrected');h.requests[1].reject(failure(403,'onboarding_required'));await settle();
  h.submit();assert.deepEqual(h.requests[2].options,h.requests[1].options);h.requests[2].resolve(h.ack(h.requests[2]));await settle();
});
for(const change of ['session','client','post'] as const)test(`late edit ACK cannot clear a newer ${change} editor`,async()=>{
  const h=harness();h.edit('after');h.submit();
  if(change==='session')h.client.sessionGeneration++;
  if(change==='client')h.props.client={...h.client};
  if(change==='post')h.props.post={...h.original,post_id:'post-b'};
  h.view();h.requests[0].resolve(h.ack(h.requests[0]));await settle();assert.equal(h.saved.length,0);assert.equal(h.closed,0);
  if(change!=='post')assert.equal(find(h.view(),n=>n.type==='textarea')!.props.disabled,false);
});
test('malformed success remains unconfirmed and retains its original tuple',async()=>{
  const h=harness();h.edit('after');h.submit();h.requests[0].resolve({...h.original,revision:2,note:'wrong text'});await settle();
  assert.equal(h.saved.length,0);assert.equal(h.closed,0);h.submit();assert.deepEqual(h.requests[1].options,h.requests[0].options);h.requests[1].resolve(h.ack(h.requests[1]));await settle();
});

test('current successful edit updates its post once and closes the dialog',async()=>{
  const h=harness();h.edit('after');h.submit();h.requests[0].resolve(h.ack(h.requests[0]));await settle();
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].note,'after');assert.equal(h.closed,1);
});

test('closing and reopening an unknown edit confirms the same revision and updates once',async()=>{
  const h=harness();h.edit('after');h.submit();h.requests[0].reject(unknown());await settle();
  h.props.post=null;h.view();h.props.post=h.original;h.submit();
  assert.deepEqual(h.requests[1].options,h.requests[0].options);assert.deepEqual(h.requests[1].body,h.requests[0].body);
  h.requests[1].resolve(h.ack(h.requests[1]));await settle();assert.equal(h.saved.length,1);assert.equal(h.closed,1);
});
test('two uncertain posts retain independent commands until each is confirmed',async()=>{
  const h=harness();h.edit('draft a');h.submit();h.requests[0].reject(unknown());await settle();
  const second={...h.original,post_id:'post-b'};h.props.post=second;h.edit('draft b');h.submit();h.requests[1].reject(unknown());await settle();
  h.props.post=h.original;h.submit();assert.deepEqual(h.requests[2].options,h.requests[0].options);assert.equal(h.requests[2].body.text,'draft a');
  h.requests[2].resolve(h.ack(h.requests[2]));await settle();
  h.props.post=second;h.submit();assert.deepEqual(h.requests[3].options,h.requests[1].options);assert.equal(h.requests[3].body.text,'draft b');
  h.requests[3].resolve(h.ack(h.requests[3]));await settle();assert.equal(h.saved.length,2);
});
