import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COMMUNITY_GROUPS, COMMUNITY_WORK, communityLinks, groupsByPlatform, pendingLinks, isSafeInviteUrl} from '../../modules/community-hub/index.js';
import {interfaceMessages} from '../../apps/portal-web/src/interface-messages.js';

const tabs=[...readFileSync('apps/portal-web/src/types.ts','utf8').match(/export type TabId = ([^\n]+)/)![1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
test('community-hub: invite URLs are null or safe, TODOs never contain URLs',()=>{
  for(const group of COMMUNITY_GROUPS){
    assert.ok(group.url===null||isSafeInviteUrl(group.url),group.id);
    assert.ok(group.source.trim(),group.id);
    if(group.status==='TODO')assert.equal(group.url,null,group.id);
    else assert.notEqual(group.url,null,group.id);
  }
  assert.equal(pendingLinks(),4);
  for(const url of ['http://line.me/test','https://line.me.evil.test/x','javascript:alert(1)','https://discord.gg@evil.test/x','https://user:pass@facebook.com/x','https://discord.gg:8443/x','//line.me/x'])assert.equal(isSafeInviteUrl(url),false,url);
  for(const host of ['line.me','discord.gg','discord.com','facebook.com'])assert.equal(isSafeInviteUrl(`https://${host}/invite`),true,host);
});
test('community-hub: known invites share the footer source and keep the supplied URLs',()=>{
  assert.deepEqual(communityLinks.map(link=>link.url),[
    'https://discord.gg/MtccYqJxCx',
    'https://line.me/ti/g2/DPTQR_XE6IYP8c5lBxsbRwsvEUsxI-70p1jWoA',
    'https://line.me/ti/g2/qwiG-IhXAyEBMzVNt6J-I1ryqj6dKhNoyCTr2A',
    'https://line.me/ti/g2/83dpd53WEvKWbgDROTV2t0z5hXnNSZTUTq17tg',
  ]);
  assert.deepEqual(new Set(COMMUNITY_GROUPS.flatMap(group=>group.url?[group.url]:[])),new Set(communityLinks.map(link=>link.url)));
  const footer=readFileSync('apps/portal-web/src/modules/Community.tsx','utf8');
  assert.match(footer,/import \{communityLinks\} from ['"]\.\.\/\.\.\/\.\.\/\.\.\/modules\/community-hub\/index['"]/);
  assert.match(footer,/communityLinks\.map/);
});
test('community-hub: all four LINE groups and all platform groups are present',()=>{
  assert.deepEqual(COMMUNITY_GROUPS.filter(group=>group.platform==='LINE').map(group=>group.name),['Claude Code 台灣交流討論區','Codex 台灣交流討論區','xAI Grok 台灣交流討論區','Meta Muse AI 台灣交流討論區']);
  assert.deepEqual(groupsByPlatform().map(({platform,groups})=>[platform,groups.length]),[['LINE',4],['Discord',2],['Facebook',2]]);
  assert.equal(groupsByPlatform([]).flatMap(item=>item.groups).length,0);
  assert.equal(pendingLinks([]),0);
});
test('community-hub: unique IDs, existing work TabIds and complete five-language messages',()=>{
  const ids=[...COMMUNITY_GROUPS,...COMMUNITY_WORK].map(item=>item.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const item of COMMUNITY_WORK){assert.ok(tabs.includes(item.tab),item.id);assert.ok(interfaceMessages[item.descriptionKey]);}
  for(const [key,values] of Object.entries(interfaceMessages).filter(([key])=>key==='nav.community-hub'||key.startsWith('communityHub.'))){assert.equal(values.length,5,key);assert.ok(values.every(value=>value.trim()),key);}
});
