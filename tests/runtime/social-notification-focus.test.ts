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
for(const oldCursor of [null,'old-filter-cursor']){
  test(`notification focus waits for the exact-post lookup, stale cursor=${oldCursor}`,async()=>{
    let resolve!:(value:unknown)=>void;
    const pending=new Promise(resolveValue=>{resolve=resolveValue;});
    const requests:string[]=[],notices:string[]=[],actions:string[]=[];
    const target='00000000-0000-4000-8000-000000000001';
    const focusing={current:target as string|null};
    let visible=false;
    const context:any={URLSearchParams,loadSequence:{current:0},pendingFeedLoad:{current:false},newPosts:{current:[]},
      client:{get:(path:string)=>{requests.push(path);return pending;}},
      setLoading(){},setMore(){},setError(){},setItems(){},setCursor(){},setCanHide(){},
      focusing,directPost:target,loading:false,more:false,platform:'',tag:'',cursor:oldCursor,setNotice:(value:string)=>notices.push(value),
      document:{getElementById:(id:string)=>{assert.equal(id,`social-post-${target}`);return visible?{scrollIntoView:()=>actions.push('scroll'),focus:()=>actions.push('focus')}:null;}},
    };
    const load=callback('const load = useCallback(', ', [client,tag,directPost]);');
    const focus=callback('const target = focusing.current;', '}, [items, loading, more, directPost]);');
    runInNewContext(transformSync(`globalThis.load=${load};globalThis.focus=()=>{const target=focusing.current;${focus}}`,{loader:'ts',format:'cjs'}).code,context);
    const request=context.load(''); // earlier useEffect starts the exact-post replacement
    context.focus(); // later useEffect still sees loading=false and the old cursor
    assert.deepEqual(requests,[`/social-posts?post_id=${target}`]);
    assert.deepEqual(notices,[]);
    assert.deepEqual(actions,[]);assert.equal(context.pendingFeedLoad.current,true);
    assert.equal(focusing.current,target);
    resolve({items:[],next_cursor:null,can_hide:false});await request;
    visible=true;context.focus();context.focus();
    assert.deepEqual(actions,['scroll','focus']);assert.equal(focusing.current,null);
    assert.equal(context.pendingFeedLoad.current,false);
    assert.deepEqual(requests,[`/social-posts?post_id=${target}`],'focus must not request extra pagination');
  });
}
