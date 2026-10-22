import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../apps/portal-web/public/social-post.js',import.meta.url),'utf8');
const postId='17c80987-1d06-4eb3-9cc4-5cc03a4987ec';
const relatedId='4c80966b-af02-4173-93d3-943fda1c9242';

async function pageClient(domPostId:string,domRelatedId:string){
  const requests:string[]=[];
  const login={href:'/initial',textContent:''};
  const related={
    href:'/initial' as string|null,textContent:'',
    getAttribute:(name:string)=>name==='data-related-post'?domRelatedId:null,
    removeAttribute(name:string){if(name==='href')this.href=null;},
  };
  const article={getAttribute:(name:string)=>name==='data-public-post'?domPostId:'test-projection-version'};
  const document={
    documentElement:{dataset:{}},
    querySelector:(selector:string)=>selector==='[data-public-post]'?article:selector==='[data-post-login]'?login:null,
    querySelectorAll:(selector:string)=>selector==='[data-related-post]'?[related]:[],
    addEventListener() {},
  };
  const fetch=async(path:string)=>{
    requests.push(path);
    return {
      ok:true,status:200,
      json:async()=>path==='/api/v1/session'?{user:{user_id:'synthetic-member'}}:{registration_enabled:true},
    };
  };
  runInNewContext(source,{
    document,window:{addEventListener(){}},location:{reload(){}},
    localStorage:{getItem(){return null;}},fetch,
    AbortController,setTimeout,clearTimeout,
  });
  await new Promise<void>(resolve=>setTimeout(resolve,0));
  return {requests,login,related};
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
});
