import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {transformSync} from 'esbuild';

// Execute the actual load/focus closures with the stale render snapshot React
// supplies when the earlier platform effect starts its replacement request.
const source=readFileSync(new URL('../../apps/portal-web/src/modules/SocialZone.tsx',import.meta.url),'utf8');
function callback(start:string,end:string){
  const from=source.indexOf(start);assert.ok(from>=0,start);
  const to=source.indexOf(end,from);assert.ok(to>from,end);
  return source.slice(from+start.length,to);
}

// The Short feed has its own quiet revalidation closure. Execute that source,
// including its pagination and ownership checks, rather than a copied model.
function shortRefreshHarness(){
  const start=source.indexOf('const refreshShorts = useCallback(');
  const end=source.indexOf('\n  useEffect(()=>{\n    const changed=',start);
  assert.ok(start>=0&&end>start);
  const wrapped=source.slice(start+'const refreshShorts = useCallback('.length,end).trim();
  const closure=wrapped.slice(0,wrapped.lastIndexOf(', ['));
  const requests:{path:string;resolve:(value:unknown)=>void;reject:(cause:unknown)=>void}[]=[],writes:string[]=[];
  const client={sessionGeneration:1,get:(path:string)=>new Promise((resolve,reject)=>requests.push({path,resolve,reject}))};
  const state:{items:unknown;cursor:unknown;canHide:unknown}={items:['current-feed'],cursor:'current-cursor',canHide:false};
  const context:any={URLSearchParams,client,currentClient:{current:client},feedSession:1,tag:'work',
    feedScope:{current:{client,session:1,platform:'shorts',tag:'work',directPost:null}},
    loadSequence:{current:7},refreshSequence:{current:0},confirmedWrites:{current:0},
    setItems(value:unknown){writes.push('items');state.items=value;},
    setCursor(value:unknown){writes.push('cursor');state.cursor=value;},
    setCanHide(value:unknown){writes.push('canHide');state.canHide=value;},
  };
  runInNewContext(transformSync(`globalThis.refresh=${closure}`,{loader:'ts',format:'cjs'}).code,context);
  return {context,client,requests,writes,state};
}
const staleShortScopes={
  'same client signs in again':(h:ReturnType<typeof shortRefreshHarness>)=>{h.client.sessionGeneration++;},
  'client object replaced':(h:ReturnType<typeof shortRefreshHarness>)=>{h.context.currentClient.current={sessionGeneration:1};},
  'feed category replaced':(h:ReturnType<typeof shortRefreshHarness>)=>{h.context.feedScope.current.platform='note';},
  'hashtag replaced':(h:ReturnType<typeof shortRefreshHarness>)=>{h.context.feedScope.current.tag='new-tag';},
  'direct post opened':(h:ReturnType<typeof shortRefreshHarness>)=>{h.context.feedScope.current.directPost='another-post';},
};
for(const [name,change] of Object.entries(staleShortScopes)){
  test(`Short revalidation drops a late response when ${name}`,async()=>{
    const h=shortRefreshHarness(),pending=h.context.refresh(1);assert.equal(h.requests.length,1);
    change(h);h.requests[0].resolve({items:[{post_id:'old-session-post'}],next_cursor:'stale-next',can_hide:true});
    assert.equal(await pending,null);assert.deepEqual(h.writes,[]);assert.equal(h.requests.length,1,'no stale next page');
    assert.deepEqual(h.state,{items:['current-feed'],cursor:'current-cursor',canHide:false});
  });
  test(`captured Short refresh cannot start after ${name}`,async()=>{
    const h=shortRefreshHarness();change(h);const pending=h.context.refresh(1);
    // Resolve any unexpected read so a regression fails rather than hanging.
    for(const request of h.requests)request.resolve({items:[],next_cursor:null,can_hide:true});
    assert.equal(await pending,null);assert.equal(h.requests.length,0);assert.deepEqual(h.writes,[]);
  });
}
test('current Short revalidation retains pagination, deduplication and failure semantics',async()=>{
  const h=shortRefreshHarness(),pending=h.context.refresh(2);
  assert.equal(h.requests[0].path,'/social-posts?platform=youtube&tag=work');
  h.requests[0].resolve({items:[{post_id:'a'}],next_cursor:'page2',can_hide:false});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.requests[1].path,'/social-posts?platform=youtube&tag=work&cursor=page2');
  h.requests[1].resolve({items:[{post_id:'a'},{post_id:'b'}],next_cursor:'page3',can_hide:true});
  assert.deepEqual(Array.from(await pending),['a','b']);assert.deepEqual(h.writes,['items','cursor','canHide']);
  assert.equal(h.state.cursor,'page3');assert.equal(h.state.canHide,true);
  const failed=shortRefreshHarness(),request=failed.context.refresh(1);failed.requests[0].reject(Error('read failed'));
  assert.equal(await request,null,'current failures must reach the player as unconfirmed');assert.deepEqual(failed.writes,[]);
});
test('Short revalidation cannot undo a local removal or a newer quiet refresh',async()=>{
  const removed=shortRefreshHarness(),old=removed.context.refresh(1);removed.context.loadSequence.current++;
  removed.requests[0].resolve({items:[{post_id:'removed'}],next_cursor:null,can_hide:true});assert.equal(await old,null);assert.deepEqual(removed.writes,[]);
  const h=shortRefreshHarness(),first=h.context.refresh(1),second=h.context.refresh(1);
  h.requests[1].resolve({items:[{post_id:'new'}],next_cursor:null,can_hide:false});assert.deepEqual(Array.from(await second),['new']);
  h.requests[0].resolve({items:[{post_id:'old'}],next_cursor:'old',can_hide:true});assert.equal(await first,null);
  assert.deepEqual(h.writes,['items','cursor','canHide']);assert.equal(h.state.cursor,null);
});
for(const oldCursor of [null,'old-filter-cursor'])for(const sessionChanged of [false,true]){
  test(`notification focus waits for the exact-post lookup, stale cursor=${oldCursor}, session changed=${sessionChanged}`,async()=>{
    let resolve!:(value:unknown)=>void;
    const pending=new Promise(resolveValue=>{resolve=resolveValue;});
    const requests:string[]=[],notices:string[]=[],actions:string[]=[];
    const target='00000000-0000-4000-8000-000000000001';
    const focusing={current:target as string|null};
    let visible=false;
    const client={sessionGeneration:1,get:(path:string)=>{requests.push(path);return pending;}};
    const writes:string[]=[];
    const context:any={URLSearchParams,loadSequence:{current:0},confirmedWrites:{current:0},pendingFeedLoad:{current:false},newPosts:{current:[]},
      client,currentClient:{current:client},feedSession:1,
      feedScope:{current:{client,session:1,platform:'',tag:'',directPost:target}},activeFeedLoad:{current:null},failedFeedLoad:{current:null},
      setLoading(){writes.push('loading');},setMore(){writes.push('more');},setError(){writes.push('error');},setItems(){writes.push('items');},setCursor(){writes.push('cursor');},setCanHide(){writes.push('canHide');},
      focusing,directPost:target,loading:false,more:false,platform:'',tag:'',cursor:oldCursor,setNotice:(value:string)=>notices.push(value),
      document:{getElementById:(id:string)=>{assert.equal(id,`social-post-${target}`);return visible?{scrollIntoView:()=>actions.push('scroll'),focus:()=>actions.push('focus')}:null;}},
    };
    const load=callback('const load = useCallback(', ', [client,feedSession,tag,directPost]);');
    const focus=callback('const target = focusing.current;', '}, [items, loading, more, directPost]);');
    runInNewContext(transformSync(`globalThis.load=${load};globalThis.focus=()=>{const target=focusing.current;${focus}}`,{loader:'ts',format:'cjs'}).code,context);
    const request=context.load(''); // earlier useEffect starts the exact-post replacement
    context.focus(); // later useEffect still sees loading=false and the old cursor
    assert.deepEqual(requests,[`/social-posts?post_id=${target}`]);
    assert.deepEqual(notices,[]);
    assert.deepEqual(actions,[]);assert.equal(context.pendingFeedLoad.current,true);
    assert.equal(focusing.current,target);
    if(sessionChanged){
      // Model a new login generation, not the production validity algorithm.
      client.sessionGeneration=2;
      context.feedScope.current={...context.feedScope.current,session:2};
      const before=writes.length;
      resolve({items:[{post_id:target}],next_cursor:'stale-result',can_hide:true});await request;
      visible=true;context.focus();context.focus();await context.load('');
      assert.equal(writes.length,before,'old response cannot commit data or loading state');
      assert.deepEqual(actions,[],'old lookup cannot focus content for the new session');
      assert.deepEqual(notices,[]);
      assert.deepEqual(requests,[`/social-posts?post_id=${target}`],'captured old handler cannot read for the new session');
      return;
    }
    resolve({items:[],next_cursor:null,can_hide:false});await request;
    visible=true;context.focus();context.focus();
    assert.deepEqual(actions,['scroll','focus']);assert.equal(focusing.current,null);
    assert.equal(context.pendingFeedLoad.current,false);
    assert.deepEqual(requests,[`/social-posts?post_id=${target}`],'focus must not request extra pagination');
  });
}
