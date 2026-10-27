import {test} from 'node:test';
import assert from 'node:assert/strict';
import {platformContentSecurityPolicy} from '../../apps/platform-api/src/platform-app.js';
import {SHORT_VIDEO_EMBED_ORIGIN,inlineVideoEmbedUrl,isShortsLink,playableShortVideos,playerCommand,shortVideoEmbedUrl,youtubeLinkHint,youtubeLinkKind} from '../../apps/portal-web/src/modules/short-video-embed.js';

const post=(id:string,url:string|null,platform='youtube',kind:'link'|'note'='link')=>({post_id:id,url,platform,kind});

test('the player address is built from the video id alone on the allowed origin',()=>{
  const url=shortVideoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ?si=tracking&feature=share')!;
  assert.ok(url.startsWith(`${SHORT_VIDEO_EMBED_ORIGIN}/embed/dQw4w9WgXcQ?`));
  assert.ok(!url.includes('tracking'));
  const query=new URL(url).searchParams;
  assert.equal(query.get('mute'),'1');
  assert.equal(query.get('controls'),'0');
  assert.equal(query.get('loop'),'1');
  assert.equal(query.get('playlist'),'dQw4w9WgXcQ');
  assert.equal(query.get('enablejsapi'),'1');
  assert.equal(query.has('autoplay'),false);
});

test('anything that is not a clean https YouTube video link has no player',()=>{
  for(const bad of ['http://www.youtube.com/watch?v=dQw4w9WgXcQ','https://evil.example/watch?v=dQw4w9WgXcQ','https://youtube.com.evil.example/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short','javascript:alert(1)','not a url','https://www.youtube.com/@channel','']){
    assert.equal(shortVideoEmbedUrl(bad),null,bad);
  }
  assert.equal(shortVideoEmbedUrl(null),null);
});

test('only vertical Shorts links become slides, one per video; watch, youtu.be and embed links never do',()=>{
  const posts=[
    post('a','https://www.youtube.com/shorts/dQw4w9WgXcQ'),
    post('b','https://youtu.be/dQw4w9WgXcQ'),
    post('c','https://www.instagram.com/reel/abc/','instagram'),
    post('d','https://www.youtube.com/shorts/short'),
    post('e',null,'youtube','note'),
    post('f','https://www.youtube.com/watch?v=aaaaaaaaaaa'),
    post('g','https://www.youtube.com/embed/bbbbbbbbbbb'),
    post('h','https://m.youtube.com/shorts/cccccccccc_?feature=share'),
    post('i','https://www.youtube.com/shorts/dQw4w9WgXcQ?si=again'),
  ];
  assert.deepEqual(playableShortVideos(posts).map(item=>item.post_id),['a','h']);
});

test('a Shorts link is recognised by host and path only',()=>{
  assert.equal(isShortsLink('https://www.youtube.com/shorts/dQw4w9WgXcQ'),true);
  assert.equal(isShortsLink('https://youtube.com/shorts/dQw4w9WgXcQ'),true);
  for(const no of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ','https://evil.example/shorts/dQw4w9WgXcQ',
    'https://youtube.com.evil.example/shorts/dQw4w9WgXcQ','http://www.youtube.com/shorts/dQw4w9WgXcQ','',null]){
    assert.equal(isShortsLink(no),false,String(no));
  }
});

test('player commands are plain JSON for the YouTube postMessage API',()=>{
  assert.deepEqual(JSON.parse(playerCommand('playVideo')),{event:'command',func:'playVideo',args:[]});
  assert.deepEqual(JSON.parse(playerCommand('unMute')),{event:'command',func:'unMute',args:[]});
});

test('aiSNS is confined to the home page and Short keeps its existing path restrictions',()=>{
  const frames=(path:string,enabled=false)=>platformContentSecurityPolicy(path,undefined,undefined,enabled).split(';').map(part=>part.trim()).filter(part=>part.startsWith('frame-src '));
  assert.deepEqual(frames('/'),["frame-src https://aisns.evitina.tw"]);
  assert.deepEqual(frames('/',true),["frame-src https://aisns.evitina.tw "+SHORT_VIDEO_EMBED_ORIGIN]);
  for(const path of ['/journal','/journal/manage','/api/v1/site','/login']){
    assert.deepEqual(frames(path),[]);
    assert.deepEqual(frames(path,true),['frame-src '+SHORT_VIDEO_EMBED_ORIGIN]);
  }
  for(const path of ['/admin','/admin/','/admin/github/callback','/pay/ecpay/'+ 'A'.repeat(43)]){
    assert.deepEqual(frames(path),[]);assert.deepEqual(frames(path,true),[]);
  }
  assert.ok(platformContentSecurityPolicy('/',undefined,undefined,true).includes("frame-ancestors 'none'"));
});

test('a link is classified by its address alone: short, other single video, or neither',()=>{
  assert.equal(youtubeLinkKind('https://www.youtube.com/shorts/dQw4w9WgXcQ'),'short');
  for(const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ'])assert.equal(youtubeLinkKind(url),'video');
  for(const url of ['https://www.youtube.com/@channel','https://www.youtube.com/watch?v=short','http://www.youtube.com/watch?v=dQw4w9WgXcQ','https://evil.example/watch?v=dQw4w9WgXcQ','https://www.youtube.com.evil.example/shorts/dQw4w9WgXcQ',null,''])assert.equal(youtubeLinkKind(url as string|null),null);
});

test('the in-card player is rebuilt from the id on the one allowed origin and ignores everything else in the pasted address',()=>{
  const url=inlineVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLx&t=99&si=tracking')!;
  assert.ok(url.startsWith(`${SHORT_VIDEO_EMBED_ORIGIN}/embed/dQw4w9WgXcQ?`));
  const query=new URL(url).searchParams;
  assert.deepEqual([...query.keys()].sort(),['autoplay','modestbranding','playsinline','rel']);
  assert.ok(!url.includes('tracking')&&!url.includes('PLx'));
  assert.equal(inlineVideoEmbedUrl('https://www.youtube.com/@channel'),null);
  assert.equal(inlineVideoEmbedUrl(null),null);
});

test('the composer hint names what was recognised and only promises playback when the host enabled it',()=>{
  assert.match(youtubeLinkHint('https://www.youtube.com/shorts/dQw4w9WgXcQ',true)!,/Short 動態/);
  assert.equal(youtubeLinkHint('https://www.youtube.com/shorts/dQw4w9WgXcQ',false),'這是 YouTube Short 連結。');
  assert.match(youtubeLinkHint('https://youtu.be/dQw4w9WgXcQ',true)!,/直接播放/);
  assert.equal(youtubeLinkHint('https://youtu.be/dQw4w9WgXcQ',false),'這是 YouTube 影片連結。');
  assert.match(youtubeLinkHint('https://www.youtube.com/@channel',true)!,/不是單支影片/);
  for(const raw of ['','https://','not a url','https://example.com/watch?v=dQw4w9WgXcQ'])assert.equal(youtubeLinkHint(raw,true),null);
});
