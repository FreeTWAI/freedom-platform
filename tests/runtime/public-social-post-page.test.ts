import {test} from 'node:test';
import assert from 'node:assert/strict';
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
