import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildSync} from 'esbuild';
import type {MemberCardData} from '../../apps/portal-web/src/modules/Membership';
import {PortalClient,ApiError} from '../../apps/portal-web/src/api';
import {performModuleMutation} from '../../apps/portal-web/src/modules/shared';
import type {SharingMutationState} from '../../apps/portal-web/src/modules/authoring-drafts';

// Execute the real component graph with React SSR. CSS is excluded here, so
// these assertions are not geometry, keyboard or three-theme browser evidence.
const compiled=buildSync({entryPoints:['apps/portal-web/src/modules/GuildMemberCard.tsx'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},logLevel:'silent'}).outputFiles[0].text;
const entry={exports:{} as {GuildMemberCard:typeof import('../../apps/portal-web/src/modules/GuildMemberCard').GuildMemberCard}};
new Function('require','module','exports',compiled)(createRequire(import.meta.url),entry,entry.exports);
const member:MemberCardData={user_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',nickname:'合成夥伴',positioning_title:'活動協作者',primary_guild:null,secondary_guilds:[],capabilities:['python'],custom_capabilities:['燈光'],equipment:[],contacts:{discord:'permitted-only'},is_self:false,friendship:{state:'none'},is_online:true,last_seen_at:'2026-10-30T10:00:00Z'};
const render=(patch:Partial<MemberCardData>={})=>renderToStaticMarkup(createElement(entry.exports.GuildMemberCard,{member:{...member,...patch},guildKey:'guild_event_space',guildName:'活動與空間公會',labels:{python:'Python'},client:new PortalClient()},createElement('span',{className:'guild-member-tier-full'},'正式成員')));

test('guild card foregrounds real identity/expertise and valid profile route without presence or inferred achievements',()=>{
 const html=render();assert.match(html,/合成夥伴/);assert.match(html,/Python/);assert.match(html,/燈光/);assert.match(html,/正式成員/);assert.match(html,/#profile\?member=aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/);
 for(const forbidden of ['2026-10-30T10:00:00Z','在線','上線','XP','排行榜','已驗收','contribution-outcomes'])assert.equal(html.includes(forbidden),false,forbidden);
 assert.match(html,/<details[^>]*><summary>專長、裝備與聯絡資料<\/summary>/);assert.match(html,/permitted-only/);assert.equal(html.includes('email'),false);
});
test('self belonging and honest missing data do not invent expertise, works or completed participation',()=>{
 const html=render({is_self:true,positioning_title:null,capabilities:[],custom_capabilities:[],contacts:{}});
 assert.match(html,/這裡也有你的位置/);assert.match(html,/尚未填寫專長/);assert.match(html,/沒有對你公開的聯絡方式/);assert.match(html,/href="#profile"/);assert.match(html,/前往我的個人空間/);assert.equal(html.includes('正式認證'),false);
});
test('malformed identifiers have no invented destination and user text/avatar URLs remain safe',()=>{
 const html=render({user_id:'legacy-id',nickname:'<script>bad</script>',custom_capabilities:['<img src=x>'],avatar_url:'https://tracker.invalid/me.png'});
 assert.equal(html.includes('href='),false);assert.match(html,/個人頁連結暫時不可用/);assert.match(html,/&lt;script&gt;/);assert.equal(html.includes('<script>'),false);assert.equal(html.includes('tracker.invalid'),false);
});
test('an explicit empty spotlight is respected and repeated specialties are not duplicated',()=>{
 const html=render({featured_capabilities:[]});assert.match(html,/尚未選擇展示專長/);
 const unique=render({featured_capabilities:['python','python','custom:燈光']});assert.equal((unique.match(/>Python<\/span>/g)??[]).length,2,'one spotlight and one details entry');
});
test('guild wrapper keeps existing operation lifetime/version gates and does not fetch outcome summaries per card',()=>{
 const source=readFileSync('apps/portal-web/src/modules/GuildMembers.tsx','utf8');
 assert.match(source,/currentMemberOperation\(epoch\)/);assert.match(source,/client.sessionGeneration === operationSession/);assert.match(source,/roster.aggregate_version/);assert.match(source,/roster.expert_aggregate_version/);
 assert.equal(source.includes('DirectoryMemberRow'),false);assert.equal(source.includes('contribution-outcomes'),false);assert.match(source,/role="group" aria-label=\{`管理\$\{member.nickname\}`\}/);
});
test('the existing admin mutation retains exact key/body/version for an immediate unknown-result retry',async t=>{
 const client=new PortalClient(),calls:{path:string;body:unknown;options:unknown}[]=[];
 const state:SharingMutationState={keys:new Map(),snapshot:{busy:false,error:null,lastFailureUnknown:false},listeners:new Set(),live:()=>true};
 t.mock.method(client,'post',async(path:string,body:unknown,options:unknown)=>{calls.push({path,body,options});if(calls.length===1)throw new ApiError({message:'unknown fixture',network:true});return {changed:true};});
 const path=`/guilds/guild_event_space/members/${member.user_id}/tier`,body={member_tier:'full'};
 assert.equal(await performModuleMutation(client,state,path,body,3),undefined);assert.equal(state.snapshot.lastFailureUnknown,true);
 assert.deepEqual(await performModuleMutation(client,state,path,body,3),{changed:true});assert.deepEqual(calls[1],calls[0]);assert.equal(state.keys.size,0);
});

test('self-provided identity and only the known current-guild date remain visible',()=>{
 const html=render({identity_label:'alien',joined_at:'2019-01-01T00:00:00Z',primary_guild:{guild_key:'guild_other',name:'其他',joined_at:'2020-01-01T00:00:00Z'},joined_guilds:[{guild_key:'guild_event_space',name:'活動與空間公會',joined_at:'2025-03-04T00:00:00Z'}]});
 assert.match(html,/自我介紹：外星人/);assert.match(html,/dateTime="2025-03-04T00:00:00Z"/);assert.match(html,/加入本公會/);assert.equal(html.includes('2019-01-01'),false);assert.equal(html.includes('2020-01-01'),false);
 assert.equal(render({joined_guilds:[{guild_key:'guild_event_space',name:'活動與空間公會',joined_at:'invalid'}]}).includes('加入本公會'),false);
});
test('real platform outcome and social-link components are only mounted by their own opened disclosure',()=>{
 const source=readFileSync('apps/portal-web/src/modules/GuildMemberCard.tsx','utf8'),html=render();
 assert.match(source,/outcomesOpen&&[\s\S]*MemberContributionOutcomes client=\{client\} memberId=\{member.user_id\}/);assert.match(source,/SocialLinksList client=\{client\} memberId=\{member.user_id\}/);
 assert.match(source,/平台合作成果（非本公會貢獻統計）/);assert.equal(html.includes('class="contribution-outcomes'),false);assert.equal(html.includes('class="member-social-display'),false);
});
