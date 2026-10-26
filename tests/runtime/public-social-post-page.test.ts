import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicSocialPostHtml,unavailableSocialPostHtml} from '../../modules/community/public-social-post-page.js';
import type {PublicSocialPostPage} from '../../modules/community/public-social-posts.js';
import {anonymousSharedPost,memberPostReturn,publicPostReturn} from '../../apps/portal-web/src/modules/public-post-return.js';

const id='17c80987-1d06-4eb3-9cc4-5cc03a4987ec';
const other='4c80966b-af02-4173-93d3-943fda1c9242';

test('post return accepts one UUID and keeps public reading, legacy member intent and other journeys distinct',()=>{
  assert.equal(publicPostReturn('?post_return='+id),'/posts/'+id);
  assert.equal(publicPostReturn('?post_return='+id.toUpperCase()+'&join=1'),'/posts/'+id);
  assert.equal(memberPostReturn('?social-post='+id,'#account'),'/?social-post='+id+'#social');
  assert.equal(anonymousSharedPost('?social-post='+id,'#social'),'/posts/'+id);
  assert.equal(anonymousSharedPost('?social-post='+id,'#account'),null);
  assert.equal(memberPostReturn('?social-post='+id,'#social'),null);
  for(const value of ['',id+'\n',id+'\r',id+' ',id+'/../other','//elsewhere.test','https://elsewhere.test/',id+'?x=1',id+'#social','00000000-0000-0000-0000-000000000000']){
    assert.equal(publicPostReturn('?post_return='+encodeURIComponent(value)),null,value);
    assert.equal(memberPostReturn('?social-post='+encodeURIComponent(value),'#account'),null,value);
    assert.equal(anonymousSharedPost('?social-post='+encodeURIComponent(value),'#social'),null,value);
  }
  for(const suffix of ['&post_return='+id,'&post_return='+other,'&social-post='+other,'&return_to=%2Fshops%2Fsample%2Fcheckout','&return_to=%2Fevents%2F'+other,'&skill_acquisition=1'])assert.equal(publicPostReturn('?post_return='+id+suffix),null,suffix);
  assert.equal(memberPostReturn('?social-post='+id+'&social-post='+id,'#account'),null);
  assert.equal(memberPostReturn('?social-post='+id+'&return_to=%2Fshops%2Fsample%2Fcheckout','#account'),null);
});

function page():PublicSocialPostPage{
  return {version:'a'.repeat(64),post:{post_id:id,kind:'note',title:'A "title" <tag>',note:'完整內文\n<script>alert(1)</script>\n'+('持續閱讀。'.repeat(120)),url:null,created_at:'2026-10-22T00:00:00.000Z',edited_at:null,author:{display_name:'作者 <img src=x>'},image_url:'/api/v1/public/shared-posts/'+id+'/image'},related:[{post_id:other,title:'另一則 <title>',summary:'這是公開摘要 <script>',author:{display_name:'另一位作者'},path:'/posts/'+other}]};
}

test('server HTML provides complete escaped content, real same-origin login paths, public OG and external scripts without JavaScript',()=>{
  const source=page(),html=publicSocialPostHtml(source,'https://freetwai.com',true);
  assert.ok(html.includes('data-public-post="'+id+'"'));assert.ok(html.includes('data-public-version="'+source.version+'"'));
  assert.ok(html.includes('持續閱讀。'.repeat(120)));assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert'));assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('href="/?post_return='+id+'#account"'));assert.ok(html.includes('href="/?post_return='+other+'#account"'));
  assert.ok(html.includes('href="/?post_return='+id+'&amp;join=1#account"'));
  assert.ok(html.includes('content="https://freetwai.com/posts/'+id+'"'));
  assert.ok(html.includes('content="https://freetwai.com/api/v1/public/shared-posts/'+id+'/image"'));
  assert.ok(html.includes('src="/public-revalidation.js"'));assert.ok(html.includes('src="/social-post.js"'));
  assert.ok(!/<script(?![^>]*src=)/.test(html));assert.ok(!html.includes('<style'));
  assert.ok(!publicSocialPostHtml(source,'https://freetwai.com',false).includes('join=1'));
});

test('unavailable pages discard public content and OG and offer only a validated legacy member destination',()=>{
  const html=unavailableSocialPostHtml(id);
  assert.ok(html.includes('href="/?social-post='+id+'#account"'));
  assert.ok(!html.includes('data-public-post'));assert.ok(!html.includes('property="og:'));assert.ok(!html.includes('/shared-posts/'));
  for(const invalid of ['<script>alert(1)</script>',id+'\n','https://elsewhere.test']){
    const missing=unavailableSocialPostHtml(invalid);
    assert.ok(!missing.includes(invalid));assert.ok(!missing.includes('social-post='));assert.ok(!missing.includes('property="og:'));
  }
});

// Execute the actual E2E transition, without launching a browser or duplicating
// its wait/ACK logic. The two contexts can otherwise race a publication commit.
const publicJourney=readFileSync(new URL('../e2e/public-social-posts.spec.ts',import.meta.url),'utf8');
const reopenJourney=publicJourney.slice(publicJourney.indexOf("test('PUBLIC-POST-07"),publicJourney.indexOf("test('PUBLIC-POST-08"));
const reopenTransition=reopenJourney.slice(reopenJourney.indexOf('  const dialog='),reopenJourney.indexOf('  await page.goto(publicPath(post.post_id));await expect(publicArticle(page)).toContainText(changed)'));
const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function reopenHarness(source=reopenTransition){
  const response=deferred<unknown>(),body=deferred<unknown>(),events:string[]=[];
  const path='/api/v1/social-posts/'+id+'/public-sharing';
  const locator={getByRole:()=>locator,getByLabel:()=>locator,click:async()=>{events.push('click');}};
  const author={page:{getByRole:()=>locator,waitForResponse:(match:(value:unknown)=>boolean)=>{
    const candidate=(method:string,pathname:string)=>({request:()=>({method:()=>method}),url:()=>`https://example.test${pathname}`});
    assert.equal(match(candidate('GET',path)),false);
    assert.equal(match(candidate('POST',path+'/other')),false);
    assert.equal(match(candidate('POST',path.replace(id,other))),false);
    assert.equal(match(candidate('POST',path)),true);
    events.push('response-listener');return response.promise;
  }}};
  const expect=(actual:unknown)=>({
    toBe:(expected:unknown)=>assert.equal(actual,expected),
    toMatchObject:(expected:Record<string,unknown>)=>{for(const [key,value] of Object.entries(expected))assert.deepEqual((actual as Record<string,unknown>)[key],value);events.push('ack');},
    toHaveValue:async(expected:string)=>{assert.equal(expected,'https://example.test/posts/'+id);events.push('public-link');},
    // Invalidated consent keeps the close control visible even while saving.
    toBeVisible:async()=>{events.push('visible');},
  });
  const run=new AsyncFunction('author','post','expect','publicPath','e2eOrigin',source);
  const complete=run(author,{post_id:id,revision:1},expect,(value:string)=>'/posts/'+value,()=> 'https://example.test').then(()=>{events.push('visitor-navigation');});
  return {response,body,events,complete,ack:{enabled:true,available:true,post_revision:2,public_path:'/posts/'+id}};
}
const flushReopen=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('reopen journey waits for its exact POST and complete ACK before public navigation',async()=>{
  const h=reopenHarness();await flushReopen();
  assert.deepEqual(h.events,['response-listener','click']);
  h.response.resolve({status:()=>200,json:()=>h.body.promise});await flushReopen();
  assert.deepEqual(h.events,['response-listener','click']);
  h.body.resolve(h.ack);await h.complete;
  assert.deepEqual(h.events,['response-listener','click','ack','public-link','visible','visitor-navigation']);
});

test('reopen journey rejects incomplete or unavailable ACKs before visiting public content',async()=>{
  for(const ack of [{},{enabled:true,available:false,post_revision:2,public_path:null},{enabled:true,available:true,post_revision:1,public_path:'/posts/'+id},{enabled:true,available:true,post_revision:2,public_path:'/posts/'+other}]){
    const h=reopenHarness(),rejected=assert.rejects(h.complete);
    h.response.resolve({status:()=>200,json:async()=>ack});await rejected;
    assert.ok(!h.events.includes('public-link'));assert.ok(!h.events.includes('visitor-navigation'));
  }
});

test('reopen journey rejects a non-200 response before reading its body or navigating',async()=>{
  const h=reopenHarness(),rejected=assert.rejects(h.complete);
  h.response.resolve({status:()=>409,json:async()=>{assert.fail('rejected response must not confirm publication');}});
  await rejected;assert.ok(!h.events.includes('ack'));assert.ok(!h.events.includes('visitor-navigation'));
});
