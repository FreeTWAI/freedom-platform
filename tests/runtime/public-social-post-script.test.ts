import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../apps/portal-web/public/social-post.js',import.meta.url),'utf8');
const postId='17c80987-1d06-4eb3-9cc4-5cc03a4987ec';
const relatedId='4c80966b-af02-4173-93d3-943fda1c9242';

async function pageClient(domPostId:string,domRelatedId:string,options:{member?:boolean;registration?:boolean;publicStatus?:number}={}){
  const requests:string[]=[];
  const listeners=new Map<string,()=>void>(),description={textContent:''},join={hidden:false},status={textContent:''};
  let removed=false,reloaded=false,metadataRemoved=false;
  const login={href:'/initial',textContent:''};
  const related={
    href:'/initial' as string|null,textContent:'',
    getAttribute:(name:string)=>name==='data-related-post'?domRelatedId:null,
    removeAttribute(name:string){if(name==='href')this.href=null;},
  };
  const article={getAttribute:(name:string)=>name==='data-public-post'?domPostId:'test-projection-version'};
  const document={
    title:'公開分享',visibilityState:'visible',body:{replaceChildren(){removed=true;}},
    documentElement:{dataset:{}},
    querySelector:(selector:string)=>selector==='[data-public-post]'?article:selector==='[data-post-login]'?login:selector==='[data-invite-description]'?description:selector==='[data-post-join]'?join:selector==='[data-reading-status]'?status:null,
    querySelectorAll:(selector:string)=>selector==='[data-related-post]'?[related]:selector.startsWith('meta[')?[{remove(){metadataRemoved=true;}}]:[],
    addEventListener(event:string,listener:()=>void){listeners.set(event,listener);},
  };
  const fetch=async(path:string)=>{
    requests.push(path);
    return {
      ok:!path.includes('/shared-posts/')||options.publicStatus!==404,status:path.includes('/shared-posts/')?(options.publicStatus??200):200,
      json:async()=>path==='/api/v1/session'?(options.member===false?{}:{user:{user_id:'synthetic-member'}}):path==='/api/v1/site'?{registration_enabled:options.registration!==false}:{version:'test-projection-version'},
    };
  };
  runInNewContext(source,{
    document,window:{addEventListener(event:string,listener:()=>void){listeners.set(event,listener);}},location:{reload(){reloaded=true;}},
    localStorage:{getItem(){return null;}},fetch,
    AbortController,setTimeout,clearTimeout,
  });
  await new Promise<void>(resolve=>setTimeout(resolve,0));
  return {requests,login,related,description,join,status,document,
    async dispatch(event:string){listeners.get(event)?.();await new Promise<void>(resolve=>setTimeout(resolve,0));},
    cleared:()=>({removed,reloaded,metadataRemoved}),
  };
}

test('untrusted root post attribute never starts capabilities or public requests',async()=>{
  for(const value of [
    '',postId+'<img src=x onerror=alert(1)>','javascript:alert(1)',
    '/posts/'+postId,postId+'?x=1',postId+'/../secret',postId+'%2fsecret',
    'https://elsewhere.test/',postId+'\\n',
  ]){
    const state=await pageClient(value,relatedId);
    assert.deepEqual(state.requests,[],value);
    assert.equal(state.login.href,'/initial',value);
    assert.equal(state.related.href,'/initial',value);
  }
});

test('untrusted related post attribute cannot construct a link or external destination',async()=>{
  for(const value of [
    '',relatedId+'<script>','javascript:alert(1)','//elsewhere.test',
    relatedId+'/../secret',relatedId+'%2f..',relatedId+'?post_return=x',
  ]){
    const state=await pageClient(postId,value);
    assert.equal(state.related.href,null,value);
    assert.equal(state.related.textContent,'這則分享暫時無法開啟');
    assert.deepEqual(state.requests.sort(),['/api/v1/session','/api/v1/site'],value);
  }
});

test('valid UUID attributes continue to use only canonical same-origin routes',async()=>{
  const state=await pageClient(postId.toUpperCase(),relatedId.toUpperCase());
  assert.equal(state.login.href,'/?social-post='+postId+'#social');
  assert.equal(state.related.href,'/posts/'+relatedId);
  assert.deepEqual(state.requests.sort(),['/api/v1/session','/api/v1/site']);
  assert.equal(state.login.textContent,'回原貼文提問與分享心得');
  assert.ok(state.description.textContent.includes('留言依原有會員資格開放'));
  assert.equal(state.join.hidden,true);
});

test('anonymous and registration-paused readers keep the exact post return without resource, member-feed or write requests',async()=>{
  for(const registration of [true,false]){
    const state=await pageClient(postId,relatedId,{member:false,registration});
    assert.equal(state.login.href,'/?post_return='+postId+'#account');
    assert.equal(state.login.textContent,'登入回原貼文交流');
    assert.equal(state.join.hidden,!registration);
    assert.ok(state.description.textContent.includes('回到這則貼文'));
    await state.dispatch('focus');
    assert.deepEqual(state.requests,['/api/v1/session','/api/v1/site','/api/v1/public/shared-posts/'+postId,'/api/v1/session','/api/v1/site']);
    await state.dispatch('pagehide');await state.dispatch('focus');
    assert.equal(state.requests.length,5,'leaving must not start further work');
  }
});

test('withdrawal clears the entire resource-bearing document and metadata before reload, with no capability refresh',async()=>{
  const state=await pageClient(postId,relatedId,{publicStatus:404});
  await state.dispatch('visibilitychange');
  assert.deepEqual(state.cleared(),{removed:true,reloaded:true,metadataRemoved:true});
  assert.equal(state.document.title,'自由工坊');
  assert.deepEqual(state.requests,['/api/v1/session','/api/v1/site','/api/v1/public/shared-posts/'+postId]);
});
