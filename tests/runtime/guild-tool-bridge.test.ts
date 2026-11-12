import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ToolHost} from '../../apps/portal-web/src/frame-tools/host.js';
import {DeviceState} from '../../apps/portal-web/src/frame-tools/device-state.js';
import {BRIDGE_VERSION,SCOPES,parseRequest,type ToolRecord} from '../../modules/guild-tools/contract.js';
const tool:ToolRecord={id:randomUUID(),tool_id:'test',guild_key:'guild_games',title:'測試',entry_url:'https://tool.example/',origin:'https://tool.example',profile:'sandboxed',bridge_version:BRIDGE_VERSION,scopes:[...SCOPES],permissions:[],state:'enabled',revision:1};
const operations={'context.get':{},'share.compose':{text:'hello'},'device-state.get':{key:'mine'},'device-state.put':{key:'mine',value:'saved'},'ui.open':{panel:'game-upload'},navigate:{action:'tools'},resize:{height:500}};
test('hostile frame cannot change window, origin, nonce, tool, guild, schema, scope or size',async()=>{
 const sent:any[]=[],called:string[]=[],frame={postMessage:(m:any,o:string)=>sent.push({m,o})} as unknown as Window;
 const h=new ToolHost(()=>frame,tool,{execute:async op=>{called.push(op);return{};},ready(){},failure(){}});h.init();
 const message=(operation='context.get',payload:unknown={})=>({version:BRIDGE_VERSION,type:'request',tool_id:tool.tool_id,guild_key:tool.guild_key,nonce:sent[0].m.nonce,request_id:randomUUID(),operation,payload});
 for(const [operation,payload] of Object.entries(operations))await h.receive({source:frame,origin:'null',data:message(operation,payload)});
 assert.equal(called.length,7);assert.ok(sent.every(r=>r.o==='*'));
 for(const data of [{...message(),nonce:randomUUID()},{...message(),tool_id:'other'},{...message(),guild_key:'guild_ar'},{...message(),version:'v1'},{...message(),extra:1},message('device-state.get',{key:'mine',tool_id:'other'}),message('share.compose',{credit:100}),message('resize',{height:1e8}),message('device-state.put',{key:'x',value:'x'.repeat(1400001)}),null])await h.receive({source:frame,origin:'null',data});
 await h.receive({source:{} as Window,origin:'null',data:message()});await h.receive({source:frame,origin:tool.origin,data:message()});assert.equal(called.length,7);
 assert.equal(parseRequest(message('navigate',{action:'https://evil.example'})),null);
 h.dispose();await h.receive({source:frame,origin:'null',data:message()});assert.equal(called.length,7);
});
test('reload drops delayed responses; replay IDs and rate floods never repeat an operation',async()=>{
 const sent:any[]=[],frame={postMessage:(m:any)=>sent.push(m)} as unknown as Window;let done!:(v:unknown)=>void,calls=0;
 const h=new ToolHost(()=>frame,tool,{execute:()=>{calls++;return new Promise(r=>{done=r;});},ready(){},failure(){}});h.init();const data={version:BRIDGE_VERSION,type:'request',tool_id:tool.tool_id,guild_key:tool.guild_key,nonce:sent[0].nonce,request_id:'same',operation:'context.get',payload:{}};
 const pending=h.receive({source:frame,origin:'null',data});await h.receive({source:frame,origin:'null',data});assert.equal(calls,1);h.init();done({private:'old'});await pending;assert.equal(sent.length,2);
 await h.receive({source:frame,origin:'null',data});assert.equal(calls,1);
 for(let i=0;i<130;i++)await h.receive({source:frame,origin:'null',data:{bad:i}});
 await h.receive({source:frame,origin:'null',data:{...data,nonce:sent[1].nonce,request_id:'fresh'}});assert.equal(calls,1);
});
test('device state isolates tools and enforces UTF8 value and total quotas without other storage reads',()=>{
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)} as Pick<Storage,'getItem'|'setItem'>;
 const a=new DeviceState(storage,'a'),b=new DeviceState(storage,'b');a.put('save','one');assert.equal(b.get('save'),null);assert.equal(a.get('save'),'one');assert.throws(()=>a.put('huge','中'.repeat(500000)));a.put('x','a'.repeat(1300000));assert.throws(()=>a.put('last','a'.repeat(800000)));assert.equal(a.get('last'),null);a.put('save',null);assert.equal(a.get('save'),null);
});

test('only valid five legacy arcade values migrate, originals remain and newer tool saves win',async()=>{
 const {importArcadeState,LEGACY_ARCADE_KEYS}=await import('../../apps/portal-web/src/frame-tools/legacy-arcade.js');
 const original=JSON.stringify({version:1,savedAt:Date.now()-1000,favorites:[],best:{}}),newer=JSON.stringify({version:1,savedAt:Date.now(),favorites:[],best:{}});
 const reads:string[]=[],backing=new Map<string,string>();const own={getItem:(k:string)=>backing.get(k)??null,setItem:(k:string,v:string)=>{backing.set(k,v);}},state=new DeviceState(own,'arcade');
 const legacy={getItem:(k:string)=>{reads.push(k);return k.includes('cookbook')?original:'invalid';}};importArcadeState(state,legacy,legacy);assert.equal(state.get(LEGACY_ARCADE_KEYS[0]),original);assert.deepEqual(reads,[...LEGACY_ARCADE_KEYS]);assert.equal(state.get(LEGACY_ARCADE_KEYS[2]),null);
 state.put(LEGACY_ARCADE_KEYS[0],newer);importArcadeState(state,legacy,legacy);assert.equal(state.get(LEGACY_ARCADE_KEYS[0]),newer);assert.equal(legacy.getItem(LEGACY_ARCADE_KEYS[0]),original);
});
test('only verified-origin profile dispatches exchange; every reply targets exact origin; reload aborts effects',async()=>{
 for(const profile of ['sandboxed','origin'] as const){const sent:any[]=[],frame={postMessage:(m:any,target:string)=>sent.push({m,target})} as unknown as Window;let called=0,signal:AbortSignal|undefined;const t={...tool,profile};const host=new ToolHost(()=>frame,t,{execute:async(_op,_p,s)=>{signal=s;called++;return {token:'synthetic-response'};},ready(){},failure(){}});host.init();const data={version:BRIDGE_VERSION,type:'request',tool_id:t.tool_id,guild_key:t.guild_key,nonce:sent[0].m.nonce,request_id:'exchange',operation:'session.exchange',payload:{}};
 await host.receive({source:frame,origin:profile==='origin'?'null':t.origin,data});assert.equal(called,0);
 await host.receive({source:frame,origin:profile==='origin'?t.origin:'null',data});assert.equal(called,profile==='origin'?1:0);assert.equal(sent.at(-1).m.ok,profile==='origin');assert.ok(sent.every(x=>x.target===(profile==='origin'?t.origin:'*')));host.init();if(signal)assert.equal(signal.aborted,true);host.dispose();}
});
test('guest share draft roundtrips bounded image bytes, preserves source and expires without publishing',async()=>{
 const {saveToolShare,readToolShare,clearToolShare}=await import('../../apps/portal-web/src/frame-tools/pending-share.js');const entries=new Map<string,string>();const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 await saveToolShare(storage,tool,{text:'draft',image:new Blob([new Uint8Array([1,2,3])],{type:'image/png'})},'#guilds/guild_games/tools/test');const draft=readToolShare(storage);assert.equal(draft?.id,tool.id);assert.equal(draft?.request.text,'draft');assert.deepEqual(new Uint8Array(await draft!.request.image!.arrayBuffer()),new Uint8Array([1,2,3]));
 const [key,raw]=[...entries][0];entries.set(key,JSON.stringify({...JSON.parse(raw),created:Date.now()-86400001}));assert.equal(readToolShare(storage),null);clearToolShare(storage);assert.equal(entries.size,0);
 const controller=new AbortController();controller.abort();await assert.rejects(saveToolShare(storage,tool,{text:'old'},'#guilds/guild_games/tools/test',controller.signal));assert.equal(entries.size,0);
});
